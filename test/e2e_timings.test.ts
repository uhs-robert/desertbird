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
