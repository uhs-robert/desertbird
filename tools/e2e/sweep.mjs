// Ends the apps that dead e2e runs left behind, before a new run starts. A run that SIGKILL ended skips its own stop, and its labwc and apps keep running.
// Stands in for DesertFox's sweep_dead_sessions and sweep_orphan_compositors. It reuses reap.mjs, which finds process groups by the run dir on their command line.
// A session's keyboard holder names no dir on its command line, so it is found by its XDG_RUNTIME_DIR, which reap_piece_dir also reads.
// Only dirs named `desertbird-e2e-*` in the temp dir are looked at, so the owner's Betterbird and ~/.thunderbird/<profile> never match.
// A run dir named by E2E_DIR is not found here. Its owner chose the path, and no prefix says it belongs to a run.
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reap_piece_dir } from "./reap.mjs";
import { acquire_lock } from "./run_dir.mjs";

export const RUN_DIR_PREFIX = "desertbird-e2e-";

// What a run starts: the app with `-profile <dir>/...` and labwc with `-C <dir>/...`. A command line that only names a path in the dir, such as
// `less <dir>/app.log` or `rg x <dir>`, is a reader of the kept evidence and stays alive.
function started_by_run(args, prefix) {
  return args.some((arg, at) => (arg === "-profile" || arg === "-C") && (args[at + 1] ?? "").startsWith(prefix));
}

// Kills the process groups that a dead run's apps hold and returns { run_dir, groups } for each dir that had any. The dirs stay: a kept dir is the evidence of a failed run.
// Each dir is locked while it is reaped, so a run that reuses it through E2E_DIR cannot start mid-reap. acquire_lock takes over a dead lock or a missing one and refuses a live run.
export function sweep_dead_runs(tmp_root = tmpdir()) {
  if (!existsSync(tmp_root)) return [];
  const swept = [];
  for (const entry of readdirSync(tmp_root)) {
    if (!entry.startsWith(RUN_DIR_PREFIX)) continue;
    const run_dir = join(tmp_root, entry);
    let release;
    try {
      release = acquire_lock(run_dir);
    } catch {
      continue;
    }
    try {
      const groups = reap_piece_dir(run_dir, started_by_run);
      if (groups.length > 0) swept.push({ run_dir, groups });
    } finally {
      release();
    }
  }
  return swept;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  for (const { run_dir, groups } of sweep_dead_runs()) console.log(`e2e sweep: killed ${groups.length} process group(s) of dead run ${run_dir}`);
}
