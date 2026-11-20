// usage: node --no-warnings tools/owner_test/cli.ts <open|reload|close> [worktree] [--app betterbird|thunderbird] [--binary path]
// Opens a visible Betterbird or Thunderbird window with a worktree's build in a throwaway profile. See README.md.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { close_window, is_own_record, stop_app } from "./close.ts";
import { APPS, app_binary, build_owner_profile, build_stamped_xpi, check_display, check_worktree, installed_stamp, is_addon_loaded, launch_argv, launch_env, real_close_deps, sleep, start_app, type App } from "./launch.ts";
import { canonical_worktree, default_roots, unsafe_reason, window_paths, type WindowPaths } from "./paths.ts";
import { is_same_process, read_start_ticks } from "./process_guard.ts";
import { flock_argv, LOCK_BUSY_EXIT, LOCK_HELD_ENV } from "./lock.ts";
import { Refusal } from "./refusal.ts";
import { read_state, write_state, type WindowState } from "./state.ts";
import { join } from "node:path";

const START_TIMEOUT_MS = 60_000;

function fail(message: string): never {
  throw new Refusal(message);
}

async function close(paths: WindowPaths): Promise<boolean> {
  const result = await close_window(paths, real_close_deps());
  for (const line of result.lines) console.log(line);
  return result.complete;
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

function tail_of(log_file: string): string {
  return existsSync(log_file) ? readFileSync(log_file, "utf8").split("\n").slice(-40).join("\n") : "(no log)";
}

function launch(state: WindowState, paths: WindowPaths, binary: string): void {
  const started = start_app(launch_argv(binary, paths.profile_dir), launch_env(process.env, paths.home_dir), paths.window_dir, paths.log_file);
  state.unit = started.unit;
  state.app_pid = started.pid;
  state.app_start_ticks = read_start_ticks(started.pid) ?? 0;
  write_state(paths.state_file, state);
}

function print_report(state: WindowState, heading: string): void {
  console.log(heading);
  console.log(`build: ${state.stamp}`);
  console.log(`app: ${state.app}`);
  console.log(`profile: ${state.profile}`);
  console.log(`log: ${state.log}`);
  console.log(`Reload after a rebuild: just owner-test-reload ${state.worktree}`);
  console.log(`Close with: just owner-test-close ${state.worktree}`);
}

async function open(worktree: string, paths: WindowPaths, app: App, binary: string): Promise<void> {
  check_display(process.env);
  check_worktree(worktree);
  if (!existsSync(binary)) fail(`no ${app} binary at ${binary}. Thunderbird comes from tools/measure/fetch_thunderbird.sh.`);
  // A second open on this worktree replaces its window. Other worktrees keep theirs: the state file and window folder are keyed by worktree.
  if (existsSync(paths.state_file) && !(await close(paths))) fail("the old window of this worktree is not closed, so no new one is opened over its profile. Fix that first, then run again.");
  mkdirSync(paths.window_dir, { recursive: true, mode: 0o700 });
  const state: WindowState = { worktree, profile: paths.profile_dir, log: paths.log_file, stamp: "", app, started: new Date().toISOString(), unit: null, app_pid: 0, app_start_ticks: 0 };
  // Written before anything starts, so a crash from here on leaves a record that close cleans.
  write_state(paths.state_file, state);
  let addon_id = "";
  try {
    state.stamp = build_stamped_xpi(worktree, paths.xpi_file, join(paths.window_dir, "stage"));
    addon_id = await build_owner_profile(paths, paths.xpi_file);
  } catch (error) {
    await close(paths);
    throw error;
  }
  launch(state, paths, binary);
  if (state.app_pid === 0) {
    await close(paths);
    fail("the spawn returned no process id, so no window started. Run again.");
  }
  if (!(await wait_for_start(state, addon_id))) {
    const log_tail = tail_of(paths.log_file);
    await close(paths);
    fail(`${app} did not start with the add-on loaded. Last lines of its log:\n${log_tail}`);
  }
  if (installed_stamp(paths.profile_dir, addon_id) !== state.stamp) fail(`WRONG BUILD: the add-on file in the profile does not carry the stamp ${state.stamp}. The window is still open. Close it with: just owner-test-close ${worktree}`);
  print_report(state, "test window open");
}

async function reload(worktree: string, paths: WindowPaths, binary: string): Promise<void> {
  check_display(process.env);
  const read = read_state(paths.state_file);
  if (read.kind !== "ok") fail(read.kind === "none" ? "no test window is open for this worktree. Run just owner-test first." : `the state file is unreadable: ${read.reason}`);
  const state = read.state;
  if (!is_own_record(state, paths)) fail(`the state file names another worktree or profile (${state.worktree}). Nothing was changed.`);
  // The build runs first, so a failed build leaves the open window alone.
  state.stamp = build_stamped_xpi(worktree, paths.xpi_file, join(paths.window_dir, "stage"));
  const lines: string[] = [];
  const stopped = await stop_app({ pid: state.app_pid, start_ticks: state.app_start_ticks }, paths, real_close_deps(), lines);
  for (const line of lines) console.log(line);
  if (!stopped) fail("the app still runs, so it was not restarted. Run close, then open.");
  // The profile is kept, so the window state and the add-on's storage survive. Only the xpi file changes.
  const { install_xpi } = await import(join(import.meta.dirname, "..", "e2e", "profile.mjs"));
  const addon_id = install_xpi(paths.profile_dir, paths.xpi_file) as string;
  launch(state, paths, binary);
  if (!(await wait_for_start(state, addon_id))) fail(`${state.app} did not restart with the add-on loaded. Last lines of its log:\n${tail_of(paths.log_file)}`);
  if (installed_stamp(paths.profile_dir, addon_id) !== state.stamp) fail("WRONG BUILD: the add-on file in the profile does not carry the new stamp.");
  print_report(state, "test window reloaded");
}

const { positionals, values } = parseArgs({ allowPositionals: true, options: { app: { type: "string", default: "betterbird" }, binary: { type: "string" } } });
const [action = "open", worktree_arg = "."] = positionals;

// open, reload and close run one at a time per worktree: the cli runs itself again under flock(1), which the kernel releases when that run ends.
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
  const app = APPS.find((name) => name === values.app) ?? fail(`unknown app ${values.app}. Use betterbird or thunderbird.`);
  const worktree = existsSync(worktree_arg) ? canonical_worktree(worktree_arg) : fail(`${worktree_arg} does not exist`);
  const paths = window_paths(worktree, default_roots(process.env, homedir()));
  const unsafe = unsafe_reason(paths, homedir());
  if (unsafe !== null) fail(`refusing: ${unsafe}`);
  const locked = action === "open" || action === "reload" || action === "close";
  if (locked && process.env[LOCK_HELD_ENV] !== "1") rerun_under_lock(paths.lock_file);
  const binary = app_binary(app, process.env, values.binary);
  if (action === "open") await open(worktree, paths, app, binary);
  else if (action === "reload") await reload(worktree, paths, binary);
  else if (action === "close") process.exitCode = (await close(paths)) ? 0 : 1;
  else fail(`unknown action ${action}. Use open, reload or close.`);
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`owner-test: ${error.message}`);
  process.exit(1);
}
process.exit(process.exitCode ?? 0);
