// usage: node --no-warnings tools/owner_test/cli.ts <open|reload|status|close> [worktree] [hint]... [--app betterbird|thunderbird] [--binary path]
// Opens a visible Betterbird or Thunderbird window with a worktree's build in a throwaway profile. See README.md.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { check_hint } from "./hints.ts";
import { APPS, app_binary, build_owner_profile, build_stamped_xpi, check_display, check_worktree, install_staged_xpi, installed_stamp, is_addon_loaded, launch_argv, launch_env, real_close_deps, remove_stage, sleep, start_app, unit_state, type App } from "./launch.ts";
import { close_action, open_window, reload_window, status_window, tail_of, type LifecycleDeps } from "./lifecycle.ts";
import { canonical_worktree, default_roots, homes_to_guard, refusal_reason, window_paths } from "./paths.ts";
import { is_same_process } from "./process_guard.ts";
import { flock_argv, LOCK_BUSY_EXIT, LOCK_HELD_ENV } from "./lock.ts";
import { Refusal } from "./refusal.ts";
import type { WindowState } from "./state.ts";

const START_TIMEOUT_MS = 60_000;

function fail(message: string): never {
  throw new Refusal(message);
}

// The start counts when the app's own record says the add-on is active with an update date no older than the xpi file. A process that dies shows at once instead of after the whole timeout.
async function wait_for_start(state: WindowState, addon_id: string): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!is_same_process(state.app_pid, state.app_start_ticks)) return false;
    if (is_addon_loaded(state.profile, addon_id)) return true;
    await sleep(500);
  }
  return false;
}

const real_deps = (homes: string[]): LifecycleDeps => ({
  close: real_close_deps(),
  build_stamped_xpi,
  remove_stage,
  build_profile: build_owner_profile,
  install_staged_xpi,
  start_app,
  launch_argv,
  launch_env,
  wait_for_start,
  installed_stamp,
  is_loaded: is_addon_loaded,
  unit_state,
  binary_exists: (binary) => existsSync(binary),
  default_binary: (app) => app_binary(app, process.env, undefined),
  check_worktree,
  log_tail: tail_of,
  check_display: () => check_display(process.env),
  env: process.env,
  homes,
  say: (line) => console.log(line),
});

const { positionals, values } = parseArgs({ allowPositionals: true, options: { app: { type: "string" }, binary: { type: "string" } } });
const [action = "open", worktree_arg = ".", ...raw_hints] = positionals;
const hints = raw_hints.filter((hint) => hint.trim() !== "");

// open, reload and close run one at a time per worktree: the cli runs itself again under flock(1), which the kernel releases when that run ends. The lock covers the whole action, build included.
function rerun_under_lock(lock_file: string): never {
  const run = spawnSync("flock", flock_argv(lock_file, [process.execPath, ...process.execArgv, ...process.argv.slice(1)]), {
    stdio: "inherit",
    env: { ...process.env, [LOCK_HELD_ENV]: "1" },
  });
  if (run.status === LOCK_BUSY_EXIT) fail("another owner-test call on this worktree is still running");
  if (run.error) fail(`could not run flock: ${run.error.message}`);
  process.exit(run.status ?? 1);
}

try {
  if (!["open", "reload", "status", "close"].includes(action)) fail(`unknown action ${action}. Use open, reload, status or close.`);
  for (const hint of hints) {
    const checked = check_hint(hint);
    if (!checked.ok) fail(checked.error);
  }
  if (hints.length > 0 && action !== "open") fail("hints go with open only");
  const requested_app = values.app;
  if (requested_app !== undefined && !APPS.some((name) => name === requested_app)) fail(`unknown app ${requested_app}. Use betterbird or thunderbird.`);
  const worktree = existsSync(worktree_arg) ? canonical_worktree(worktree_arg) : fail(`${worktree_arg} does not exist`);
  const homes = homes_to_guard(homedir());
  if (homes.length === 0) fail("refusing: HOME is empty or not an absolute path");
  const paths = window_paths(worktree, default_roots(process.env, homedir()));
  // Before the lock: taking it creates a file under the state folder, so the folders must be checked first.
  const unsafe = refusal_reason(paths, homes);
  if (unsafe !== null) fail(`refusing: ${unsafe}`);
  // status only reads, so it takes no lock and never waits behind an open.
  if (action !== "status" && process.env[LOCK_HELD_ENV] !== "1") rerun_under_lock(paths.lock_file);
  const deps = real_deps(homes);
  const request = { worktree, paths };
  if (action === "open") {
    const app = (requested_app ?? "betterbird") as App;
    await open_window(request, app, app_binary(app, process.env, values.binary), deps, hints);
  } else if (action === "status") {
    process.exitCode = (await status_window(request, deps)) ? 0 : 1;
  } else if (action === "reload") {
    await reload_window(request, requested_app, values.binary, deps);
  } else {
    process.exitCode = (await close_action(request, deps)) ? 0 : 1;
  }
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`owner-test: ${error.message}`);
  process.exit(1);
}
process.exit(process.exitCode ?? 0);
