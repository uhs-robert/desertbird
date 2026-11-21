import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { create_timings, group_memory } = await import(join(import.meta.dirname, "..", "tools", "e2e", "timings.mjs"));

test("a section is recorded under <app>/<kind>/<section>, also when it throws", async () => {
  const timings = create_timings("/unused");
  assert.equal(await timings.section("thunderbird", "default", "hud", async () => 7), 7);
  await assert.rejects(timings.section("thunderbird", "default", "panes", async () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(timings.report().pieces.map((piece: { name: string }) => piece.name), ["thunderbird/default/hud", "thunderbird/default/panes"]);
});

test("the written report has the DesertFox shape and keeps the extra fields of a piece", () => {
  const dir = mkdtempSync(join(tmpdir(), "desertbird-timings-test-"));
  try {
    const file = join(dir, "nested", "timings.json");
    const timings = create_timings(file);
    timings.add_piece({ app: "betterbird", kind: "message", section: "main", wall_ms: 1500, startups: [{ enabled_ms: 1800 }], peak_memory_kb: { app: { rss_kb: 1 } } });
    timings.write();
    const report = JSON.parse(readFileSync(file, "utf8"));
    for (const key of ["total_ms", "cases_ms", "outside_cases_ms", "categories", "outside_cases", "pieces", "tab_samples", "lost_key_suspects", "cases"]) assert.ok(key in report, key);
    assert.deepEqual(report.pieces, [{ name: "betterbird/message/main", wall_ms: 1500, startups: [{ enabled_ms: 1800 }], peak_memory_kb: { app: { rss_kb: 1 } } }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("group_memory of a group with no process is zero", () => {
  assert.deepEqual(group_memory(2 ** 30), { processes: 0, rss_kb: 0, pss_kb: 0 });
});

const { default_timings_path, filter_of, merge_check_reports, merge_reports, report_path_of, summary_text } = await import(join(import.meta.dirname, "..", "tools", "e2e", "timings.mjs"));

test("a timings object with no file writes nothing, and a filter goes into the report", () => {
  const timings = create_timings(null, { filter: "E2E_KINDS=web" });
  timings.add_piece({ app: "a", kind: "k", section: "main", wall_ms: 1 });
  timings.write();
  assert.equal(timings.report().filter, "E2E_KINDS=web");
  assert.ok(!("filter" in create_timings(null).report()));
});

test("filter_of names the settings that narrowed a run, and a run with no xpi", () => {
  assert.equal(filter_of({}, { xpi_path: "x.xpi" }), undefined);
  assert.equal(filter_of({ E2E_KINDS: "web", E2E_ONLY: "web_hints" }, { xpi_path: "x.xpi" }), "E2E_KINDS=web E2E_ONLY=web_hints");
  assert.equal(filter_of({}, { xpi_path: null }), "no --xpi");
});

test("the timings path sits under <repo>/.logs unless E2E_TIMINGS_FILE names one, and the report goes beside it", () => {
  assert.match(default_timings_path("/repo", {}), /^\/repo\/\.logs\/e2e-timings-.*-\d+\.json$/);
  assert.equal(default_timings_path("/repo", { E2E_TIMINGS_FILE: "/x/t.json" }), "/x/t.json");
  assert.equal(report_path_of("/x/t.json"), "/x/t.report.json");
});

const worker_reports = [
  { worker: 1, report: { pieces: [{ name: "betterbird/message/main", wall_ms: 160_000, startups: [{}], peak_memory_kb: { app: { rss_kb: 2048 }, labwc: { rss_kb: 1024 } } }, { name: "thunderbird/web/main", wall_ms: 3000, timed_out: true }] } },
  { worker: 2, report: { pieces: [{ name: "betterbird/zoom/main", wall_ms: 70_000, startups: [{}] }, { name: "thunderbird/zoom/main", wall_ms: 1000, in_flight: true }] } },
  { worker: 3, report: undefined },
];
const workers = [
  { worker: 1, busy_ms: 163_000, idle_ms: 5000, finished_ms: 170_000, pieces: ["betterbird/message/main", "thunderbird/web/main"] },
  { worker: 2, busy_ms: 71_000, idle_ms: 0, finished_ms: 175_000, pieces: ["betterbird/zoom/main", "thunderbird/zoom/main"] },
  { worker: 3, busy_ms: 0, idle_ms: 175_000, finished_ms: undefined, pieces: [] },
];

test("merge_reports keeps the report shape, tags each piece with its worker and names the worker that finished last", () => {
  const incomplete = { reason: "received SIGINT", in_flight: ["thunderbird/zoom/main"], not_started: [] };
  const merged = merge_reports(worker_reports, { total_ms: 175_000, workers, incomplete, filter: "E2E_KINDS=zoom" });
  for (const key of ["total_ms", "cases_ms", "outside_cases_ms", "categories", "outside_cases", "pieces", "tab_samples", "lost_key_suspects", "cases"]) assert.ok(key in merged, key);
  assert.deepEqual(merged.pieces.map((entry: { name: string; worker: number }) => `${entry.worker} ${entry.name}`), ["1 betterbird/message/main", "1 thunderbird/web/main", "2 betterbird/zoom/main", "2 thunderbird/zoom/main"]);
  assert.equal(merged.critical_worker, 2);
  assert.deepEqual(merged.incomplete, incomplete);
  assert.equal(merged.filter, "E2E_KINDS=zoom");
  assert.ok(!("incomplete" in merge_reports([], { total_ms: 1 })));
});

test("merged checks follow the registry order whatever order the workers finished in, each tagged", () => {
  const order = ["thunderbird/a/main", "thunderbird/b/main", "betterbird/a/main"];
  const check = (name: string, ok = true) => ({ app: "x", kind: "y", name, ok, detail: "" });
  const results = [
    { id: "betterbird/a/main", worker: 2, report: { checks: [check("bb a")], shots: [{ path: "/s.png" }], notes: [] } },
    { id: "thunderbird/b/main", worker: 1, report: { checks: [check("tb b 1"), check("tb b 2", false)], shots: [], notes: [{ name: "n" }] } },
    { id: "thunderbird/a/main", worker: 3, report: { checks: [check("tb a")], shots: [], notes: [] } },
  ];
  const merged = merge_check_reports(results, order);
  assert.deepEqual(merged.checks.map((entry: { name: string }) => entry.name), ["tb a", "tb b 1", "tb b 2", "bb a"]);
  assert.deepEqual(merged.checks[0], { ...check("tb a"), piece: "thunderbird/a/main", worker: 3 });
  assert.deepEqual(merged.shots, [{ path: "/s.png", piece: "betterbird/a/main", worker: 2 }]);
  assert.deepEqual(merged.notes, [{ name: "n", piece: "thunderbird/b/main", worker: 1 }]);
});

test("the summary lists each worker, the slowest pieces, the failed checks and the incomplete line", () => {
  const merged = merge_reports(worker_reports, { total_ms: 175_000, workers, incomplete: { reason: "received SIGINT", in_flight: ["thunderbird/zoom/main"], not_started: ["x/y/z"] } });
  Object.assign(merged, { failed_checks: [{ piece: "betterbird/zoom/main", worker: 2, name: "zoom grows", detail: "same height" }], failures: ["thunderbird/web/main: no result within 120 s (piece deadline)"] });
  const text = summary_text(merged);
  assert.match(text, /175\.0 s total/);
  assert.match(text, /w2 finished last/);
  assert.match(text, /w1 +163\.0 s busy +5\.0 s idle +2 pieces +peak RSS sum 3 MB +betterbird\/message\/main, thunderbird\/web\/main/);
  assert.match(text, /w3 .* 0 pieces/);
  assert.match(text, /160\.0 s +w1 +betterbird\/message\/main +1 startups/);
  assert.match(text, /thunderbird\/web\/main +0 startups +\(timed out\)/);
  assert.match(text, /betterbird\/zoom\/main \(w2\)\n +zoom grows: same height/);
  assert.match(text, /FAIL thunderbird\/web\/main: no result within 120 s/);
  assert.match(text, /e2e incomplete \(received SIGINT\): in flight thunderbird\/zoom\/main; not started x\/y\/z/);
});
