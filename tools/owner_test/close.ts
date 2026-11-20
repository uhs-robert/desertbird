import { is_strictly_inside, is_unredirected, type WindowPaths } from "./paths.ts";
import { read_state, remove_state } from "./state.ts";
import { resolve } from "node:path";

export type RunningApp = { pid: number; start_ticks: number };

// Everything that touches the system, so tests can fake it.
export type CloseDeps = {
  read_start_ticks: (pid: number) => number | null;
  signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  sleep: (ms: number) => Promise<void>;
  // The main process of an app started with exactly this profile folder, or null.
  find_app_by_profile: (profile: string) => RunningApp | null;
  // Stops a systemd unit and says whether it is gone now. Called only for a state that names a unit.
  stop_unit: (unit: string) => boolean;
  remove_window_dir: (window_dir: string) => void;
  grace_ms?: number;
  // How long to wait for the process to be gone after SIGKILL.
  kill_wait_ms?: number;
};

// `closed` means a window was closed by this call. `complete` means nothing of the window is left running, so a new one may start.
export type CloseResult = { lines: string[]; closed: boolean; complete: boolean };

const POLL_MS = 100;

// SIGTERM, wait, SIGKILL, and re-read the start ticks before each signal, so a pid recycled in between is never hit. Returns false when the process still runs after SIGKILL and a bounded wait: the caller then keeps the folder and state.
export async function stop_process(label: string, pid: number, start_ticks: number, deps: CloseDeps, lines: string[]): Promise<boolean> {
  const still_ours = () => start_ticks > 0 && deps.read_start_ticks(pid) === start_ticks;
  const wait_until_gone = async (limit_ms: number) => {
    for (let waited = 0; waited < limit_ms && still_ours(); waited += POLL_MS) await deps.sleep(POLL_MS);
  };
  if (pid <= 1 || start_ticks <= 0) {
    lines.push(`${label}: never started`);
    return true;
  }
  if (!still_ours()) {
    lines.push(deps.read_start_ticks(pid) === null ? `${label}: already gone` : `${label}: pid ${pid} now belongs to another process, left alone`);
    return true;
  }
  deps.signal(pid, "SIGTERM");
  await wait_until_gone(deps.grace_ms ?? 5000);
  if (!still_ours()) {
    lines.push(`${label}: stopped`);
    return true;
  }
  deps.signal(pid, "SIGKILL");
  await wait_until_gone(deps.kill_wait_ms ?? 3000);
  lines.push(still_ours() ? `${label}: still running after SIGKILL` : `${label}: killed`);
  return !still_ours();
}

// A record belongs to the caller only when its worktree and profile are the ones the caller's key maps to. Two keys never share a profile: a record that names another one is refused whole.
export function is_own_record(record: { worktree: string; profile: string }, paths: WindowPaths): boolean {
  return resolve(record.worktree) === paths.worktree && resolve(record.profile) === paths.profile_dir;
}

// Stops what the state records, then whatever else runs with this exact profile folder. The second look covers a state written before the spawn (pid 0) and an app that outlived a crashed open. A process is never matched by name.
export async function stop_app(recorded: RunningApp | null, paths: WindowPaths, deps: CloseDeps, lines: string[]): Promise<boolean> {
  if (recorded !== null && !(await stop_process("app", recorded.pid, recorded.start_ticks, deps, lines))) return false;
  const found = deps.find_app_by_profile(paths.profile_dir);
  if (found === null) return true;
  return stop_process("app (found by profile)", found.pid, found.start_ticks, deps, lines);
}

// Deletes only paths.window_dir, which is derived from the caller's worktree, never from the state file. A bad or foreign state file therefore deletes nothing.
export async function close_window(paths: WindowPaths, deps: CloseDeps): Promise<CloseResult> {
  const read = read_state(paths.state_file);
  const lines: string[] = [];
  let recorded: RunningApp | null = null;
  let unit: string | null = null;
  if (read.kind === "none") return { lines: ["nothing open"], closed: false, complete: true };
  if (read.kind === "corrupt") {
    lines.push(`state file was unreadable (${read.reason}); looking for the app by its profile folder instead`);
  } else {
    if (!is_own_record(read.state, paths)) {
      return { lines: [`the state file names another worktree or profile (${read.state.worktree}), so nothing was signalled or deleted. Remove ${paths.state_file} by hand if it is stale.`], closed: false, complete: false };
    }
    recorded = { pid: read.state.app_pid, start_ticks: read.state.app_start_ticks };
    unit = read.state.unit;
  }
  if (unit !== null && !deps.stop_unit(unit)) {
    lines.push("close is incomplete: the systemd unit is not confirmed stopped, so the folder and state are kept. Run close again.");
    return { lines, closed: false, complete: false };
  }
  if (!(await stop_app(recorded, paths, deps, lines))) {
    lines.push("close is incomplete: the app still runs, so the folder and state are kept. Run close again.");
    return { lines, closed: false, complete: false };
  }
  if (!is_strictly_inside(paths.cache_root, paths.window_dir) || !is_unredirected(paths)) {
    lines.push(`folder: ${paths.window_dir} is not the plain folder derived under ${paths.cache_root}, left alone`);
    return { lines, closed: false, complete: false };
  }
  deps.remove_window_dir(paths.window_dir);
  lines.push(`folder: deleted ${paths.window_dir}`);
  remove_state(paths.state_file);
  lines.push("closed");
  return { lines, closed: true, complete: true };
}
