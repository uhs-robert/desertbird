// The three actions, with everything that touches the machine passed in, so tests drive them with fakes. cli.ts supplies the real deps. The caller holds the per-worktree lock for the whole call.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { close_window, is_own_record, stop_window, type CloseDeps } from "./close.ts";
import { APPS, type App } from "./launch.ts";
import { refusal_reason, unit_name, type WindowPaths } from "./paths.ts";
import { Refusal } from "./refusal.ts";
import { read_state, write_state, type WindowState } from "./state.ts";

export type LifecycleDeps = {
  close: CloseDeps;
  // Builds the worktree and writes the stamped xpi to paths.staged_xpi. Returns the stamp.
  build_stamped_xpi: (worktree: string, paths: WindowPaths) => string;
  remove_stage: (paths: WindowPaths) => void;
  // Builds the profile and installs the staged xpi. Returns the add-on id.
  build_profile: (paths: WindowPaths) => Promise<string>;
  install_staged_xpi: (paths: WindowPaths) => Promise<string>;
  start_app: (argv: string[], env: NodeJS.ProcessEnv, cwd: string, log_file: string, unit: string) => { unit: string | null; pid: number };
  launch_argv: (binary: string, profile_dir: string) => string[];
  launch_env: (env: NodeJS.ProcessEnv, home_dir: string) => NodeJS.ProcessEnv;
  // True once the app runs and its own record lists the add-on as active.
  wait_for_start: (state: WindowState, addon_id: string) => Promise<boolean>;
  installed_stamp: (profile_dir: string, addon_id: string) => string | null;
  // The app's own record lists the add-on as active with an update date no older than its xpi.
  is_loaded: (profile_dir: string, addon_id: string) => boolean;
  // The `is-active` word of a unit, or null when systemd cannot say.
  unit_state: (unit: string) => string | null;
  binary_exists: (binary: string) => boolean;
  // The binary an app gets with no override.
  default_binary: (app: App) => string;
  // Throws a Refusal when the folder is not a DesertBird checkout, before any build runs in it.
  check_worktree: (worktree: string) => void;
  log_tail: (log_file: string) => string;
  // Throws a Refusal when there is no display to open a window on.
  check_display: () => void;
  env: NodeJS.ProcessEnv;
  homes: string[];
  say: (line: string) => void;
};

export type Request = { worktree: string; paths: WindowPaths };

function fail(message: string): never {
  throw new Refusal(message);
}

// Runs before every action, so open and reload cannot write or delete through a path that close would refuse.
function check_paths(paths: WindowPaths, deps: LifecycleDeps): void {
  const reason = refusal_reason(paths, deps.homes);
  if (reason !== null) fail(`refusing: ${reason}`);
}

async function close_and_say(paths: WindowPaths, deps: LifecycleDeps, keep_stage = false): Promise<boolean> {
  const result = await close_window(paths, deps.close, keep_stage);
  for (const line of result.lines) deps.say(line);
  return result.complete;
}

function launch(state: WindowState, paths: WindowPaths, deps: LifecycleDeps): void {
  // A stale or failed unit of this name, left by a crash, would make the start fail. The name comes from the key, so this reaches no other unit.
  deps.close.stop_unit(unit_name(paths.key));
  const started = deps.start_app(deps.launch_argv(state.binary, paths.profile_dir), deps.launch_env(deps.env, paths.home_dir), paths.window_dir, paths.log_file, unit_name(paths.key));
  state.unit = started.unit;
  state.app_pid = started.pid;
  state.app_start_ticks = deps.close.read_start_ticks(started.pid) ?? 0;
  write_state(paths.state_file, state);
}

function report(state: WindowState, heading: string, deps: LifecycleDeps, hints: string[] = []): void {
  if (hints.length > 0) deps.say(`Change on the options page before the check:\n${hints.map((hint) => `  ${hint}`).join("\n")}`);
  for (const line of [heading, `build: ${state.stamp}`, `app: ${state.app}`, `profile: ${state.profile}`, `log: ${state.log}`, `Reload after a rebuild: just owner-test-reload ${state.worktree}`, `Status: just owner-test-status ${state.worktree}`, `Close with: just owner-test-close ${state.worktree}`]) deps.say(line);
}

// The build comes first and the old window is closed only after it succeeded, so a build error leaves the open window alone. The state file is written before anything starts, so a crash from there on leaves a record that close cleans.
export async function open_window(request: Request, app: App, binary: string, deps: LifecycleDeps, hints: string[] = []): Promise<void> {
  const { worktree, paths } = request;
  check_paths(paths, deps);
  deps.check_display();
  deps.check_worktree(worktree);
  if (!deps.binary_exists(binary)) fail(`no ${app} binary at ${binary}. Thunderbird comes from tools/measure/fetch_thunderbird.sh.`);
  let stamp: string;
  try {
    stamp = deps.build_stamped_xpi(worktree, paths);
  } catch (error) {
    deps.remove_stage(paths);
    throw error;
  }
  try {
    // A second open on this worktree replaces its window. This also stops an app that runs on the profile with no state file, before the profile is wiped under it.
    if (!(await close_and_say(paths, deps, true))) fail("the old window of this worktree is not closed, so no new one is opened over its profile. Fix that first, then run again.");
    mkdirSync(paths.window_dir, { recursive: true, mode: 0o700 });
    const state: WindowState = { worktree, profile: paths.profile_dir, log: paths.log_file, stamp, addon_id: "", app, binary, started: new Date().toISOString(), unit: null, app_pid: 0, app_start_ticks: 0 };
    write_state(paths.state_file, state);
    let addon_id: string;
    try {
      addon_id = await deps.build_profile(paths);
    } catch (error) {
      await close_and_say(paths, deps, true);
      throw error;
    }
    state.addon_id = addon_id;
    write_state(paths.state_file, state);
    launch(state, paths, deps);
    if (state.app_pid === 0) {
      await close_and_say(paths, deps, true);
      fail("the spawn returned no process id, so no window started. Run again.");
    }
    if (!(await deps.wait_for_start(state, addon_id))) {
      const tail = deps.log_tail(paths.log_file);
      await close_and_say(paths, deps, true);
      fail(`${app} did not start with the add-on loaded. Last lines of its log:\n${tail}`);
    }
    if (deps.installed_stamp(paths.profile_dir, addon_id) !== stamp) fail(`WRONG BUILD: the add-on file in the profile does not carry the stamp ${stamp}. The window is still open. Close it with: just owner-test-close ${worktree}`);
    report(state, "test window open", deps, hints);
  } finally {
    deps.remove_stage(paths);
  }
}

// Reload keeps the app the window was opened with. An explicit --app that differs is refused: a profile written by one app must not be started by the other.
export async function reload_window(request: Request, requested_app: string | undefined, requested_binary: string | undefined, deps: LifecycleDeps): Promise<void> {
  const { worktree, paths } = request;
  check_paths(paths, deps);
  deps.check_display();
  deps.check_worktree(worktree);
  const read = read_state(paths.state_file);
  if (read.kind !== "ok") fail(read.kind === "none" ? "no test window is open for this worktree. Run just owner-test first." : `the state file is unreadable: ${read.reason}`);
  const state = read.state;
  if (!is_own_record(state, paths)) fail(`the state file names another worktree or profile (${state.worktree}). Nothing was changed.`);
  if (!APPS.some((name) => name === state.app)) fail(`the state file names an unknown app (${state.app}). Close the window and open a new one.`);
  if (requested_app !== undefined && requested_app !== state.app) fail(`this window was opened with ${state.app}, so it cannot be reloaded as ${requested_app}. Close it and open a new one with --app ${requested_app}.`);
  // The binary is the app's default, or one the maintainer named at open. A state file alone never picks a program to run: a binary that is not the default must be named again with --binary, and must match the state.
  if (requested_binary !== undefined && requested_binary !== state.binary) fail(`this window was opened with the binary ${state.binary}, so it cannot be reloaded with ${requested_binary}.`);
  if (state.binary !== deps.default_binary(state.app as App) && requested_binary === undefined) fail(`this window was opened with the binary ${state.binary}, which is not the default for ${state.app}. Pass it again: --binary ${state.binary}`);
  if (!deps.binary_exists(state.binary)) fail(`no ${state.app} binary at ${state.binary}.`);
  try {
    // The build runs first, so a failed build leaves the open window alone.
    state.stamp = deps.build_stamped_xpi(worktree, paths);
    const lines: string[] = [];
    const stopped = await stop_window({ pid: state.app_pid, start_ticks: state.app_start_ticks }, state.unit, paths, deps.close, lines);
    for (const line of lines) deps.say(line);
    if (!stopped) fail("the app or its unit still runs, so it was not restarted. Run close, then open.");
    // The profile is kept, so the window state and the add-on's storage survive. Only the xpi file changes.
    const addon_id = await deps.install_staged_xpi(paths);
    state.addon_id = addon_id;
    launch(state, paths, deps);
    const hint = `The window may still run. Close it with: just owner-test-close ${worktree}`;
    if (state.app_pid === 0) fail(`the spawn returned no process id, so no window started. ${hint}`);
    if (!(await deps.wait_for_start(state, addon_id))) fail(`${state.app} did not restart with the add-on loaded. ${hint}\nLast lines of its log:\n${deps.log_tail(paths.log_file)}`);
    if (deps.installed_stamp(paths.profile_dir, addon_id) !== state.stamp) fail(`WRONG BUILD: the add-on file in the profile does not carry the new stamp. ${hint}`);
    report(state, "test window reloaded", deps);
  } finally {
    deps.remove_stage(paths);
  }
}

export async function close_action(request: Request, deps: LifecycleDeps): Promise<boolean> {
  check_paths(request.paths, deps);
  return close_and_say(request.paths, deps);
}


export function tail_of(log_file: string): string {
  return existsSync(log_file) ? readFileSync(log_file, "utf8").split("\n").slice(-40).join("\n") : "(no log)";
}

// What is open, read only: no lock, no build, nothing written. The exit code is 0 only for a running window whose loaded add-on carries the stamp the state records.
export async function status_window(request: Request, deps: LifecycleDeps): Promise<boolean> {
  const { paths } = request;
  check_paths(paths, deps);
  const read = read_state(paths.state_file);
  if (read.kind === "none") {
    const orphan = deps.close.find_app_by_profile(paths.profile_dir);
    deps.say(orphan === null ? "nothing open" : `no state file, but an app runs with this profile (pid ${orphan.pid}). Close cleans it.`);
    return false;
  }
  if (read.kind === "corrupt") {
    deps.say(`state file is unreadable: ${read.reason}. Close cleans it.`);
    return false;
  }
  const { state } = read;
  if (!is_own_record(state, paths)) {
    deps.say(`the state file names another worktree or profile (${state.worktree}). Nothing was changed.`);
    return false;
  }
  const alive = state.app_pid > 1 && deps.close.read_start_ticks(state.app_pid) === state.app_start_ticks && deps.close.names_profile(state.app_pid, state.profile);
  const unit = state.unit === null ? "none (detached)" : `${state.unit} (${deps.unit_state(state.unit) ?? "unknown"})`;
  for (const line of [`app: ${state.app}`, `build: ${state.stamp}`, `profile: ${state.profile}`, `unit: ${unit}`, `pid: ${state.app_pid}`]) deps.say(line);
  if (!alive) {
    deps.say("stale: its process is gone. Close cleans it.");
    return false;
  }
  if (state.addon_id === "" || !deps.is_loaded(state.profile, state.addon_id)) {
    deps.say("WRONG BUILD: the app runs but its record does not list the add-on as loaded.");
    return false;
  }
  if (deps.installed_stamp(state.profile, state.addon_id) !== state.stamp) {
    deps.say(`WRONG BUILD: the add-on file in the profile does not carry the stamp ${state.stamp}.`);
    return false;
  }
  deps.say(`open, loaded build matches: ${state.stamp}`);
  return true;
}
