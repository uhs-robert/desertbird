// Wall-time and memory accounting for the e2e run. Memory comes from ps and /proc, one sample per process group.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// RSS in kB of every process of one process group (the app and its content processes), and the Pss of the same processes.
// Pss splits shared pages between the processes that map them, so it adds up across apps where RSS counts shared pages in each.
export function group_memory(pgid) {
  let table;
  try {
    table = execFileSync("ps", ["-eo", "pid=,pgid=,rss="], { encoding: "utf8" });
  } catch {
    return { processes: 0, rss_kb: 0, pss_kb: 0 };
  }
  let processes = 0;
  let rss_kb = 0;
  let pss_kb = 0;
  for (const line of table.trim().split("\n")) {
    const [pid, group, rss] = line.trim().split(/\s+/).map(Number);
    if (group !== pgid) continue;
    processes++;
    rss_kb += rss;
    try {
      pss_kb += Number(/^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"))?.[1] ?? 0);
    } catch {}
  }
  return { processes, rss_kb, pss_kb };
}

// Samples the groups named by `groups()` every `interval_ms` and keeps the peak of each figure. `groups` returns { name: pgid }.
export function start_memory_sampler(groups, interval_ms = 1000) {
  const peaks = {};
  const sample = () => {
    for (const [name, pgid] of Object.entries(groups())) {
      const now = group_memory(pgid);
      const peak = (peaks[name] ??= { processes: 0, rss_kb: 0, pss_kb: 0 });
      for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], now[key]);
    }
  };
  sample();
  const timer = setInterval(sample, interval_ms);
  return { peaks, stop: () => { clearInterval(timer); sample(); } };
}

export function create_timings(file) {
  const started_at = Date.now();
  const kinds = [];
  const sections = [];
  return {
    // Runs `action` and charges its wall time to a section of one (app, kind).
    async section(app, kind, name, action) {
      const begun = Date.now();
      try {
        return await action();
      } finally {
        sections.push({ app, kind, section: name, wall_ms: Date.now() - begun });
      }
    },
    // One entry per app start that ran a kind: its wall time from before start_app to after stop, plus what the instance measured.
    add_kind(entry) { kinds.push(entry); },
    write() {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ total_ms: Date.now() - started_at, kinds, sections }, null, 2)}\n`);
    },
  };
}
