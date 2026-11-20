import { is_plain_stage, is_strictly_inside, is_unredirected, unit_name, type WindowPaths } from "./paths.ts";
import { read_state, remove_state } from "./state.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type RunningApp = { pid: number; start_ticks: number };

// Everything that touches the system, so tests can fake it.
export type CloseDeps = {
  read_start_ticks: (pid: number) => number | null;
  signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  // The other processes of the process group the pid leads (the app starts detached, so it leads its own), each with its start ticks. Taken while the leader still runs, so a pid recycled later is told apart by its ticks. Empty when the pid does not lead a group.
  group_members: (pid: number) => RunningApp[];
  // True when the command line of the pid holds `-profile <profile>`: the proof that a recorded pid is this window's app and not another app of the user.
  names_profile: (pid: number, profile: string) => boolean;
  sleep: (ms: number) => Promise<void>;
  // The main process of an app started with exactly this profile folder, or null.
  find_app_by_profile: (profile: string) => RunningApp | null;
  // Stops a systemd unit, clears a failed one, and says whether it is confirmed gone. Always called with the unit derived from the worktree key, never a name from the state file.
  stop_unit: (unit: string) => boolean;
  remove_window_dir: (window_dir: string) => void;
  // Deletes a stage folder left by a build. Called only with the derived, plain stage folder of the window.
  remove_stage_dir: (stage_dir: string) => void;
  grace_ms?: number;
  // How long to wait for the process to be gone after SIGKILL.
  kill_wait_ms?: number;
};

// `closed` means a window was closed by this call. `complete` means nothing of the window is left running, so a new one may start.
export type CloseResult = { lines: string[]; closed: boolean; complete: boolean };

const POLL_MS = 100;
const MAX_LOOKUPS = 5;

// SIGTERM, wait, SIGKILL, and re-read the start ticks before each signal, so a pid recycled in between is never hit. The command line must name this profile too: start ticks prove the pid was not reused, not that the process is ours, and a hand-edited state file can name any pid. The members of the app's process group (content processes) are listed while the leader runs, and each that outlives it gets SIGKILL, again checked by its ticks. No group signal is sent, so nothing outside the group can be reached. Returns false when something still runs after that and a bounded wait: the caller then keeps the folder and state.
export async function stop_process(label: string, pid: number, start_ticks: number, profile: string, deps: CloseDeps, lines: string[]): Promise<boolean> {
  const alive = (target: RunningApp) => deps.read_start_ticks(target.pid) === target.start_ticks;
  const still_ours = () => start_ticks > 0 && deps.read_start_ticks(pid) === start_ticks;
  const wait_until = async (limit_ms: number, running: () => boolean) => {
    for (let waited = 0; waited < limit_ms && running(); waited += POLL_MS) await deps.sleep(POLL_MS);
  };
  if (pid <= 1 || start_ticks <= 0) {
    lines.push(`${label}: never started`);
    return true;
  }
  if (!still_ours()) {
    lines.push(deps.read_start_ticks(pid) === null ? `${label}: already gone` : `${label}: pid ${pid} now belongs to another process, left alone`);
    return true;
  }
  if (!deps.names_profile(pid, profile)) {
    lines.push(`${label}: pid ${pid} does not run with this window's profile, left alone`);
    return true;
  }
  const members = new Map<number, RunningApp>();
  const note_members = () => { for (const member of deps.group_members(pid)) members.set(member.pid, member); };
  note_members();
  deps.signal(pid, "SIGTERM");
  await wait_until(deps.grace_ms ?? 5000, still_ours);
  let outcome = "stopped";
  if (still_ours()) {
    note_members();
    deps.signal(pid, "SIGKILL");
    await wait_until(deps.kill_wait_ms ?? 3000, still_ours);
    outcome = "killed";
  }
  if (still_ours()) {
    lines.push(`${label}: still running after SIGKILL`);
    return false;
  }
  const left = () => [...members.values()].filter(alive);
  if (left().length > 0) {
    await wait_until(deps.grace_ms ?? 5000, () => left().length > 0);
    for (const member of left()) deps.signal(member.pid, "SIGKILL");
    await wait_until(deps.kill_wait_ms ?? 3000, () => left().length > 0);
    if (left().length > 0) {
      lines.push(`${label}: processes of its group still run after SIGKILL`);
      return false;
    }
  }
  lines.push(`${label}: ${outcome}`);
  return true;
}

// A record belongs to the caller only when its worktree and profile are the ones the caller's key maps to. Two keys never share a profile: a record that names another one is refused whole.
export function is_own_record(record: { worktree: string; profile: string; unit?: string | null }, paths: WindowPaths): boolean {
  const unit_is_ours = record.unit === undefined || record.unit === null || record.unit === unit_name(paths.key);
  return resolve(record.worktree) === paths.worktree && resolve(record.profile) === paths.profile_dir && unit_is_ours;
}

// Stops what the state records, then every main process that runs with this exact profile folder. The second look covers a state written before the spawn (pid 0), a lost state file and an app that outlived a crashed open. A process is never matched by name. The loop is bounded, so a lookup that keeps finding a process cannot spin.
export async function stop_app(recorded: RunningApp | null, paths: WindowPaths, deps: CloseDeps, lines: string[]): Promise<boolean> {
  if (recorded !== null && !(await stop_process("app", recorded.pid, recorded.start_ticks, paths.profile_dir, deps, lines))) return false;
  for (let round = 0; round < MAX_LOOKUPS; round++) {
    const found = deps.find_app_by_profile(paths.profile_dir);
    if (found === null) return true;
    if (!(await stop_process("app (found by profile)", found.pid, found.start_ticks, paths.profile_dir, deps, lines))) return false;
  }
  return deps.find_app_by_profile(paths.profile_dir) === null;
}

// Deletes only paths.window_dir, which is derived from the caller's worktree, never from the state file. A bad or foreign state file therefore deletes nothing.
// Stops the window's unit first, so forked children and processes that left the process group die with it, then whatever the checks by start ticks and profile still find (the detached fallback). The unit name comes from the key. Confirmation is required only when the state records a unit: with no systemd at all, nothing proves a stop and a detached window has no unit to prove.
export async function stop_window(recorded: RunningApp | null, recorded_unit: string | null, paths: WindowPaths, deps: CloseDeps, lines: string[]): Promise<boolean> {
  const confirmed = deps.stop_unit(unit_name(paths.key));
  if (recorded_unit !== null && !confirmed) {
    lines.push("the systemd unit is not confirmed stopped");
    return false;
  }
  return stop_app(recorded, paths, deps, lines);
}

// A build that crashed leaves its stage folder. It is removed under the same checks as the window folder.
function clear_stage(paths: WindowPaths, deps: CloseDeps, lines: string[]): void {
  if (!is_strictly_inside(paths.cache_root, paths.stage_dir) || !is_plain_stage(paths)) return void lines.push(`stage folder: ${paths.stage_dir} is not the plain folder derived under ${paths.cache_root}, left alone`);
  if (existsSync(paths.stage_dir)) deps.remove_stage_dir(paths.stage_dir);
}

// `keep_stage` is for open, which closes the old window after it has built the next one into the stage folder.
export async function close_window(paths: WindowPaths, deps: CloseDeps, keep_stage = false): Promise<CloseResult> {
  const read = read_state(paths.state_file);
  const lines: string[] = [];
  let recorded: RunningApp | null = null;
  let unit: string | null = null;
  if (read.kind === "none") {
    // A unit can outlive a lost state file, and a failed one would block the next start.
    deps.stop_unit(unit_name(paths.key));
    // No state does not mean no app: a state file deleted by hand leaves one running on the profile.
    if (deps.find_app_by_profile(paths.profile_dir) === null) {
      if (!keep_stage) clear_stage(paths, deps, lines);
      return { lines: ["nothing open", ...lines], closed: false, complete: true };
    }
    lines.push("no state file, but an app runs with this profile");
  }
  if (read.kind === "corrupt") {
    lines.push(`state file was unreadable (${read.reason}); looking for the app by its profile folder instead`);
  } else if (read.kind === "ok") {
    if (!is_own_record(read.state, paths)) {
      return { lines: [`the state file names another worktree or profile (${read.state.worktree}), so nothing was signalled or deleted. Remove ${paths.state_file} by hand if it is stale.`], closed: false, complete: false };
    }
    recorded = { pid: read.state.app_pid, start_ticks: read.state.app_start_ticks };
    unit = read.state.unit;
  }
  if (!(await stop_window(recorded, unit, paths, deps, lines))) {
    lines.push("close is incomplete: the app or its unit still runs, so the folder and state are kept. Run close again.");
    return { lines, closed: false, complete: false };
  }
  if (!is_strictly_inside(paths.cache_root, paths.window_dir) || !is_unredirected(paths)) {
    lines.push(`folder: ${paths.window_dir} is not the plain folder derived under ${paths.cache_root}, left alone`);
    return { lines, closed: false, complete: false };
  }
  if (!keep_stage) clear_stage(paths, deps, lines);
  deps.remove_window_dir(paths.window_dir);
  lines.push(`folder: deleted ${paths.window_dir}`);
  remove_state(paths.state_file);
  lines.push("closed");
  return { lines, closed: true, complete: true };
}
