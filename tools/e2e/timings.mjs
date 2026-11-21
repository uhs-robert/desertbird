// Wall-time and memory accounting for the e2e run. Memory comes from ps and /proc, one sample per process group.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

// The report has the shape of the DesertFox key-test report (pieces, cases, categories, outside_cases), so its weights and merge code read it.
// A piece is "<app>/<kind>/<section>", which is what a run starts. A piece that still runs several sections of one profile (the default kind) holds their `section` entries inside its wall time. startups and peak_memory_kb are extra fields of the run's piece.
// With no file, write() does nothing: a worker hands its entries to the coordinator, which writes the one file.
// `filter` names the setting that narrowed the run, so the weights never come from a run that skipped pieces or checks.
export function create_timings(file, { filter } = {}) {
  const started_at = Date.now();
  const pieces = [];
  const report = () => ({ total_ms: Date.now() - started_at, cases_ms: 0, outside_cases_ms: 0, categories: {}, outside_cases: {}, pieces, tab_samples: [], lost_key_suspects: [], cases: [], ...(filter ? { filter } : {}) });
  return {
    // Runs `action` and charges its wall time to a section of one (app, kind).
    async section(app, kind, name, action) {
      const begun = Date.now();
      try {
        return await action();
      } finally {
        pieces.push({ name: `${app}/${kind}/${name}`, wall_ms: Date.now() - begun });
      }
    },
    // One piece per piece run: its wall time from before its first app start to after stop, plus what the instance measured.
    // `reference_apps` is one { startups, peak_memory_kb } per extra app the piece started (the mode label reference app). It is left out when the piece started none.
    add_piece({ app, kind, section, wall_ms, startups, peak_memory_kb, reference_apps = [] }) { pieces.push({ name: `${app}/${kind}/${section}`, wall_ms, startups, peak_memory_kb, ...(reference_apps.length ? { reference_apps } : {}) }); },
    report,
    write() {
      if (!file) return;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(report(), null, 2)}\n`);
    },
  };
}

// Timings and report outlive the run dir, which is scratch and goes after a pass. Like DesertFox's default_timings_path, they go under <repo>/.logs, and E2E_TIMINGS_FILE overrides.
export function default_timings_path(repo_dir, env = process.env) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return env.E2E_TIMINGS_FILE || join(repo_dir, ".logs", `e2e-timings-${stamp}-${process.pid}.json`);
}
export const report_path_of = (timings_path) => timings_path.replace(/\.json$/, "") + ".report.json";

// The settings that narrowed a run, or undefined for a full run. A run with no xpi only starts each app, so its times are no weights either.
export function filter_of(env, { xpi_path }) {
  const set = ["E2E_KINDS", "E2E_ONLY", "E2E_SCALE"].filter((name) => env[name]).map((name) => `${name}=${env[name]}`);
  if (!xpi_path) set.push("no --xpi");
  return set.length ? set.join(" ") : undefined;
}

// One report from the pieces of several workers, in the shape create_timings writes. Copied from DesertFox's merge_reports.
// Departures: only `pieces` is summed, since the case, category, tab and lost-key keys stay empty here; there is no Firefox version.
// `worker_reports` is [{ worker, report }], and every piece entry gains its worker. `workers` is one summary per worker (see the coordinator).
export function merge_reports(worker_reports, { total_ms, workers = [], incomplete, filter }) {
  const merged = { total_ms, cases_ms: 0, outside_cases_ms: 0, categories: {}, outside_cases: {}, pieces: [], tab_samples: [], lost_key_suspects: [], cases: [] };
  for (const { worker, report } of worker_reports) {
    if (!report) continue;
    merged.pieces.push(...(report.pieces ?? []).map((entry) => ({ ...entry, worker })));
  }
  merged.workers = workers;
  merged.critical_worker = workers.filter((entry) => entry.finished_ms !== undefined).sort((left, right) => right.finished_ms - left.finished_ms)[0]?.worker;
  if (incomplete) merged.incomplete = incomplete;
  if (filter) merged.filter = filter;
  return merged;
}

// The checks, shots and notes of every piece, in `order` (apps outer, pieces inner, as the serial run prints them), so two runs diff cleanly whatever order the workers finished in.
// `results` is [{ id, worker, report }]. Each entry gains its piece id and worker.
export function merge_check_reports(results, order) {
  const merged = { checks: [], shots: [], notes: [] };
  const rank = (id) => { const at = order.indexOf(id); return at < 0 ? order.length : at; };
  for (const { id, worker, report } of [...results].sort((left, right) => rank(left.id) - rank(right.id))) {
    for (const key of Object.keys(merged)) merged[key].push(...(report?.[key] ?? []).map((entry) => ({ ...entry, piece: id, worker })));
  }
  return merged;
}

const SLOWEST_SHOWN = 15;
const seconds = (ms) => (ms / 1000).toFixed(1).padStart(7);
const peak_rss_kb = (entry) => Object.values(entry.peak_memory_kb ?? {}).reduce((sum, group) => sum + (group?.rss_kb ?? 0), 0);

// The summary a sharded run prints. Copied from DesertFox's summary_text without the category, case, tab and lost-key tables, which are empty here.
// It adds the idle time and the summed peak RSS of each worker, and the failed checks grouped by piece.
export function summary_text(merged) {
  const lines = [`e2e timings: ${seconds(merged.total_ms).trim()} s total, ${merged.pieces.filter((entry) => !entry.in_flight).length} pieces`];
  lines.push(`workers (w${merged.critical_worker ?? "?"} finished last):`);
  for (const worker of merged.workers ?? []) {
    const rss_mb = Math.round(merged.pieces.filter((entry) => entry.worker === worker.worker).reduce((sum, entry) => sum + peak_rss_kb(entry), 0) / 1024);
    lines.push(`  w${worker.worker}  ${seconds(worker.busy_ms)} s busy  ${seconds(worker.idle_ms ?? 0)} s idle  ${String(worker.pieces.length).padStart(2)} pieces  peak RSS sum ${rss_mb} MB  ${worker.pieces.join(", ")}`);
  }
  lines.push(`slowest ${SLOWEST_SHOWN} pieces:`);
  for (const entry of [...merged.pieces].sort((left, right) => right.wall_ms - left.wall_ms).slice(0, SLOWEST_SHOWN)) {
    const marks = [entry.timed_out && "timed out", entry.in_flight && "in flight", entry.died && "worker died"].filter(Boolean);
    lines.push(`  ${seconds(entry.wall_ms)} s  w${entry.worker}  ${entry.name}  ${entry.startups?.length ?? 0} startups${marks.length ? `  (${marks.join(", ")})` : ""}`);
  }
  const failed = merged.failed_checks ?? [];
  if (failed.length) {
    lines.push("failed checks:");
    for (const id of new Set(failed.map((entry) => entry.piece))) {
      const of_piece = failed.filter((entry) => entry.piece === id);
      lines.push(`  ${id} (w${of_piece[0].worker})`);
      for (const entry of of_piece) lines.push(`    ${entry.name}${entry.detail ? `: ${entry.detail}` : ""}`);
    }
  }
  for (const failure of merged.failures ?? []) lines.push(`FAIL ${failure}`);
  if (merged.incomplete) lines.push(`e2e incomplete (${merged.incomplete.reason}): in flight ${merged.incomplete.in_flight.join(", ") || "none"}; not started ${merged.incomplete.not_started.join(", ") || "none"}`);
  return lines.join("\n");
}
