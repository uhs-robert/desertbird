import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { alert_reasons, fold_batch, summary_lines } = await import(join(import.meta.dirname, "..", "tools", "e2e", "flakes.mjs"));

const meta = { commit: "abc1234", at: "2026-11-21T03:00:00.000Z" };
const clean = () => ({ exit_code: 0, failures: [], failed_checks: [] });
const piece = "thunderbird/default/keys";
const failing = (name = "dd on the last row") => ({ exit_code: 1, failures: [], failed_checks: [{ piece, worker: 1, name, detail: "no" }] });

test("a batch of clean runs lists no cases and raises no alert", () => {
  const line = fold_batch(Array.from({ length: 3 }, clean), meta);
  assert.deepEqual(line, { ...meta, runs: 3, clean_runs: 3, run_errors: 0, too_thin: false, cases: [] });
  assert.deepEqual(alert_reasons(line), []);
});

test("a case counts its failing runs under its full piece id", () => {
  const line = fold_batch([failing(), clean(), failing(), clean()], meta);
  assert.equal(line.clean_runs, 2);
  assert.deepEqual(line.cases, [{ piece, case: "dd on the last row", fail: 2 }]);
  assert.equal(summary_lines(line)[1], `${piece}  "dd on the last row"  failed 2/4`);
});

test("one failing run is below the alert threshold, two is at it", () => {
  assert.deepEqual(alert_reasons(fold_batch([failing(), clean(), clean()], meta)), []);
  const reasons = alert_reasons(fold_batch([failing(), failing(), clean()], meta));
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /failed in 2 of 3 runs/);
});

test("a check that fails in every run is called broken, not flaky", () => {
  assert.match(alert_reasons(fold_batch([failing(), failing()], meta))[0], /every run \(broken, not flaky\)/);
});

test("a check failing twice in one run counts once", () => {
  const twice = { exit_code: 1, failures: [], failed_checks: [...failing().failed_checks, ...failing().failed_checks] };
  assert.equal(fold_batch([twice, clean()], meta).cases[0].fail, 1);
});

test("a run failure makes the run unclean without naming a case", () => {
  const line = fold_batch([{ ...clean(), exit_code: 1, failures: ["worker 1 lost"] }, clean()], meta);
  assert.equal(line.clean_runs, 1);
  assert.deepEqual(line.cases, []);
});

test("run errors are counted apart from failures and alert at three", () => {
  const two = fold_batch([undefined, undefined, ...Array.from({ length: 8 }, clean)], meta);
  assert.equal(two.run_errors, 2);
  assert.deepEqual(alert_reasons(two), []);
  const three = fold_batch([undefined, undefined, undefined, ...Array.from({ length: 7 }, clean)], meta);
  assert.match(alert_reasons(three)[0], /3 of 10 runs errored/);
});

test("a batch with fewer than half its runs completed is too thin to read", () => {
  const thin = fold_batch([clean(), undefined, undefined], meta);
  assert.equal(thin.too_thin, true);
  assert.match(summary_lines(thin)[1], /too thin to read/);
  assert.equal(fold_batch([clean(), undefined], meta).too_thin, false);
});
