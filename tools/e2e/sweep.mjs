// Ends the apps that dead e2e runs left behind, before a new run starts. A run that SIGKILL ended skips its own stop, and its labwc and apps keep running.
// Stands in for DesertFox's sweep_dead_sessions and sweep_orphan_compositors. It reuses reap.mjs, which finds process groups by the run dir on their command line.
// Only dirs named `desertbird-e2e-*` in the temp dir are looked at, so the owner's Betterbird and ~/.thunderbird/<profile> never match.
// A run dir named by E2E_DIR is not found here. Its owner chose the path, and no prefix says it belongs to a run.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reap_piece_dir } from "./reap.mjs";
import { process_start_ticks } from "./run_dir.mjs";

export const RUN_DIR_PREFIX = "desertbird-e2e-";

// A run is live while the pid in its lock runs with the start time the lock recorded. A dir with no readable lock has no live run:
// open_run_dir takes the lock before any app starts, so no app can belong to a dir without one.
function run_is_live(run_dir) {
  try {
    const [pid, ticks] = readFileSync(join(run_dir, "run.lock"), "utf8").trim().split(" ");
    return /^\d+$/.test(pid) && process_start_ticks(Number(pid)) === ticks;
  } catch {
    return false;
  }
}

// Kills the process groups that name a dead run's dir and returns { run_dir, groups } for each dir that had any. A live run is never touched.
// The dirs stay: a kept dir is the evidence of a failed run.
export function sweep_dead_runs(tmp_root = tmpdir()) {
  if (!existsSync(tmp_root)) return [];
  const swept = [];
  for (const entry of readdirSync(tmp_root)) {
    if (!entry.startsWith(RUN_DIR_PREFIX)) continue;
    const run_dir = join(tmp_root, entry);
    if (run_is_live(run_dir)) continue;
    const groups = reap_piece_dir(run_dir);
    if (groups.length > 0) swept.push({ run_dir, groups });
  }
  return swept;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  for (const { run_dir, groups } of sweep_dead_runs()) console.log(`e2e sweep: killed ${groups.length} process group(s) of dead run ${run_dir}`);
}
