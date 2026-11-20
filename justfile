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
