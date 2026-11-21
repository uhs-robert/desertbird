default:
    @just --list

# Typecheck, then bundle into dist/ (the same as `npm run build`).
build: install_deps
    npm run --silent build

# Regenerate the binding tables in docs/keymap.md from the default keymaps.
docs-gen: install_deps
    npm run --silent docs:gen

# Lint, typecheck and run the unit tests (`npm run check`) in a scratch TMPDIR, under a memory cap and a time limit when systemd is available.
test: install_deps
    #!/usr/bin/env bash
    set -euo pipefail
    # Each run owns one scratch dir, so a concurrent run in another session is never touched. It becomes TMPDIR for every test process. A run killed by SIGKILL skips the trap below, so the sweep removes such dirs once they are old.
    scratch_parent="${TMPDIR:-/tmp}"
    find "$scratch_parent" -maxdepth 1 -type d -name 'desertbird-test-run.*' -mmin +30 -exec rm -rf {} + 2>/dev/null || true
    run_dir=$(mktemp -d "$scratch_parent/desertbird-test-run.XXXXXX")
    trap 'rm -rf "$run_dir"' EXIT
    export TMPDIR="$run_dir"
    # Node keeps its module compile cache in TMPDIR by default, which the leak check would read as a leak. A stable dir outside the run dir keeps the cache.
    export NODE_COMPILE_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/desertbird/node-compile-cache"
    # Inside agents.slice, keep the scope there too: a bare scope lands in app.slice and escapes the slice CPU cap.
    slice_args=(); if grep -q /agents.slice/ /proc/self/cgroup 2>/dev/null; then slice_args=(--slice=agents.slice); fi
    scope_args=(systemd-run --user --scope "${slice_args[@]}" --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900)
    run_cmd=(npm run --silent check)
    if command -v systemd-run >/dev/null 2>&1 && "${scope_args[@]}" true >/dev/null 2>&1; then
        run_cmd=("${scope_args[@]}" "${run_cmd[@]}")
    else
        echo "test: no systemd user session, so this run has no memory cap or time limit." >&2
    fi
    # Not exec: exec would skip the trap and leave the run dir behind.
    status=0
    "${run_cmd[@]}" || status=$?
    # Every test removes its own scratch files, so anything left here is a leak. Fail before the trap deletes the evidence.
    leftovers=$(find "$run_dir" -mindepth 1 -maxdepth 1 -printf '%f\n')
    if [ -n "$leftovers" ]; then
        echo "test: the run left files in its scratch dir (TMPDIR). Each test must remove what it makes there. Left over:" >&2
        echo "$leftovers" | sed 's/^/  /' >&2
        [ "$status" -ne 0 ] || status=1
    fi
    exit "$status"

[private]
install_deps:
    #!/usr/bin/env bash
    set -euo pipefail
    # npm ci writes node_modules/.package-lock.json, so a lockfile newer than it means the install is stale.
    if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
        npm ci --no-audit --no-fund
    fi

# Compare the setting defaults with the DesertFox table at the pin. The checkout is the argument or DESERTFOX_DIR, and the check skips with a warning when neither is set.
settings-defaults checkout=env('DESERTFOX_DIR', ''):
    DESERTFOX_DIR={{quote(checkout)}} npm run --silent defaults:check

# Open a visible Betterbird (or Thunderbird with `--app thunderbird`) with a worktree's build in a throwaway profile. Each argument after the worktree is one `name value` setting hint, quoted, for example 'toast_ms 3000'. An agent runs it on the maintainer's display only for a hand check the maintainer asked for, and tests the tool only in a nested headless session.
[positional-arguments]
owner-test worktree="." *args:
    node --no-warnings tools/owner_test/cli.ts open "$@"

# Rebuild and restart the test window on the same profile.
[positional-arguments]
owner-test-reload worktree="." *args:
    node --no-warnings tools/owner_test/cli.ts reload "$@"

# Report what is open and whether the loaded build matches.
owner-test-status worktree=".":
    node --no-warnings tools/owner_test/cli.ts status {{quote(worktree)}}

# Stop the test window and delete its profile folder.
owner-test-close worktree=".":
    node --no-warnings tools/owner_test/cli.ts close {{quote(worktree)}}

# Run the e2e pieces on 3 workers at once (E2E_SHARDS, default 3 here) with the built xpi, in a capped systemd scope. A full run of both apps takes about 20 minutes. One run at a time per machine: a second waits up to 3600 s for the lock, and it builds only after it holds the lock. Arguments go to `npm run e2e`, for example `just e2e betterbird`. E2E_KINDS, E2E_ONLY and E2E_SCALE pick the pieces. Never wrap the recipe in `flock`.
[positional-arguments]
e2e *args:
    #!/usr/bin/env bash
    set -euo pipefail
    # One run at a time: two runs together break the memory budget. -o keeps the lock fd out of the run, so an app that outlives it does not hold the lock.
    lock_file=/tmp/desertbird-e2e.lock
    if ! flock -n -o "$lock_file" true; then
        echo "e2e: the lock $lock_file is busy, waiting up to 3600 s. Holders:" >&2
        for holder_pid in $(fuser "$lock_file" 2>/dev/null); do
            ps -o pid=,args= -p "$holder_pid" >&2 || true
        done
    fi
    # The build, the sweep and the run all sit under the lock: a build outside it would delete dist/ under a run that still reads the xpi.
    exec flock -o -w 3600 "$lock_file" just e2e_locked "$@"

# The body of `just e2e`, which holds the lock: install, sweep the apps of dead runs, build, then run in the scope.
[private]
[positional-arguments]
e2e_locked *args: install_deps
    #!/usr/bin/env bash
    set -euo pipefail
    # The sweep runs under the lock, so no other recipe run is alive while it kills. It spares a live `npm run e2e` started outside the recipe.
    node tools/e2e/sweep.mjs
    npm run --silent build
    # Fleet sessions run at most 3 apps at once. 3 workers ran a full two-app run in about 1215 s (db-fast-e2e measure.md, #135).
    export E2E_SHARDS="${E2E_SHARDS:-3}"
    if ! [[ "$E2E_SHARDS" =~ ^[1-9][0-9]*$ ]]; then echo "e2e: E2E_SHARDS must be a positive number, got $E2E_SHARDS" >&2; exit 2; fi
    run_args=(--xpi dist/desertbird.xpi "$@")
    # The runner prints the deadline it will use, so the limit follows it. A margin covers the stop grace and the report after the deadline. A run with no deadline (serial, or one piece) has no bound of its own, and a full serial run takes about an hour, so it gets 7200 s.
    deadline_s=$(node tools/e2e/run.mjs --print-deadline "${run_args[@]}")
    run_limit_s=7200
    if [ -n "$deadline_s" ]; then run_limit_s=$((deadline_s + 120)); fi
    # About 1 GB of app and 0.2 GB of labwc per worker by RSS (measure.md), plus the runner. 2 GB a worker and 2 GB over.
    memory_max_g=$((2 + 2 * E2E_SHARDS))
    # Inside agents.slice, keep the scope there too: a bare scope lands in app.slice and escapes the slice CPU cap.
    slice_args=(); if grep -q /agents.slice/ /proc/self/cgroup 2>/dev/null; then slice_args=(--slice=agents.slice); fi
    scope_args=(systemd-run --user --scope "${slice_args[@]}" --quiet -p MemoryMax=${memory_max_g}G -p MemoryHigh=$((memory_max_g - 1))G -p MemorySwapMax=0 -p TimeoutStopSec=20 -p RuntimeMaxSec=$run_limit_s)
    run_cmd=(npm run --silent e2e -- "${run_args[@]}")
    if command -v systemd-run >/dev/null 2>&1 && "${scope_args[@]}" true >/dev/null 2>&1; then
        run_cmd=("${scope_args[@]}" "${run_cmd[@]}")
    else
        echo "e2e: no systemd user session, so this run has no memory cap or time limit." >&2
    fi
    echo "e2e: ${E2E_SHARDS} worker(s), run limit ${run_limit_s} s, memory max ${memory_max_g} GB" >&2
    exec "${run_cmd[@]}"

# Run only the e2e pieces the change can affect, on Betterbird, against E2E_BASE (default origin/main: commits, working tree and new files). Takes the lock and scope of `just e2e`. Needs E2E_CHANGED in the registry (the changed-areas PR).
[positional-arguments]
e2e-changed *args:
    E2E_CHANGED=1 just e2e "$@"

# Kill the apps of dead e2e runs now, without starting a run. `just e2e` does this before each run. Only apps started with a -profile or -C path in a desertbird-e2e-* dir of the temp dir are matched, and a run that holds its lock is left alone.
e2e-sweep:
    node tools/e2e/sweep.mjs
