import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { alert_reasons, fold_batch, run_child, shards_error, summary_lines } = await import(join(import.meta.dirname, "..", "tools", "e2e", "flakes.mjs"));

const meta = { commit: "abc1234", at: "2026-11-21T03:00:00.000Z" };
const clean = () => ({ exit_code: 0, failures: [], failed_checks: [] });
const piece = "thunderbird/default/keys";
const failing = (name = "dd on the last row") => ({ exit_code: 1, failures: [], failed_checks: [{ piece, worker: 1, name, detail: "no" }] });

test("a batch of clean runs lists no cases and raises no alert", () => {
  const line = fold_batch(Array.from({ length: 3 }, clean), meta);
  assert.deepEqual(line, { ...meta, runs: 3, clean_runs: 3, run_errors: 0, too_thin: false, cases: [], retries: [] });
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
  assert.match(alert_reasons(fold_batch([failing(), failing()], meta))[0], /every run that completed \(broken, not flaky\)/);
});

test("a check failing twice in one run counts once", () => {
  const twice = { exit_code: 1, failures: [], failed_checks: [...failing().failed_checks, ...failing().failed_checks] };
  assert.equal(fold_batch([twice, clean()], meta).cases[0].fail, 1);
});

test("a run failure makes the run unclean and is one case of the run", () => {
  const line = fold_batch([{ ...clean(), exit_code: 1, failures: ["worker 1 lost"] }, clean()], meta);
  assert.equal(line.clean_runs, 1);
  assert.deepEqual(line.cases, [{ piece: "(run)", case: "worker 1 lost", fail: 1 }]);
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

test("a piece that dies in every run is a case under its piece id and alerts", () => {
  const died = () => ({ exit_code: 1, failures: ["thunderbird/web/main: no result within 120 s (piece deadline)"], failed_checks: [] });
  const line = fold_batch([died(), died(), clean()], meta);
  assert.deepEqual(line.cases, [{ piece: "thunderbird/web/main", case: "(piece failure)", fail: 2 }]);
  assert.match(alert_reasons(line)[0], /thunderbird\/web\/main "\(piece failure\)" failed in 2 of 3 runs/);
});

test("a failure with no piece id is one case of the run", () => {
  const line = fold_batch([{ exit_code: 1, failures: ["worker 2 lost"], failed_checks: [] }, clean()], meta);
  assert.deepEqual(line.cases, [{ piece: "(run)", case: "worker 2 lost", fail: 1 }]);
});

test("a run error is not a run the check could pass", () => {
  const line = fold_batch([failing(), failing(), undefined], meta);
  assert.match(alert_reasons(line)[0], /every run that completed \(broken, not flaky\)/);
  assert.match(alert_reasons(fold_batch([failing(), failing(), clean()], meta))[0], /failed in 2 of 3 runs/);
});

test("E2E_SHARDS below 2 or not a number is refused", () => {
  for (const bad of ["1", "0", "abc", "", "2x", "-3"]) assert.ok(shards_error(bad), bad);
  for (const good of ["2", "3", "10"]) assert.equal(shards_error(good), null, good);
});

// A fake child that answers a SIGTERM only after a pause, as a run that stops its apps first.
const slow_stopper = ["-e", "process.on('SIGTERM', () => setTimeout(() => process.exit(143), 200)); console.log('up'); setInterval(() => {}, 1000)"];

test("a signal to the batch goes to the child, and the wait ends when the child has exited", async () => {
  const signals = new EventEmitter();
  const started = Date.now();
  const pending = run_child(process.execPath, slow_stopper, { stdio: ["ignore", "pipe", "inherit"] }, signals);
  await new Promise((resolve) => setTimeout(resolve, 300));
  signals.emit("SIGTERM");
  const result = await pending;
  assert.deepEqual(result, { status: 143, signal: "SIGTERM" });
  assert.ok(Date.now() - started >= 400, "the wait outlasted the child's stop");
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("a child that ends alone reports its status and no signal", async () => {
  const signals = new EventEmitter();
  assert.deepEqual(await run_child(process.execPath, ["-e", "process.exit(3)"], { stdio: "ignore" }, signals), { status: 3, signal: null });
  assert.equal(signals.listenerCount("SIGINT"), 0);
});

test("a key retry note is counted per piece and tab and raises no alert", () => {
  const name = "g ? drew no key list in the calendar tab";
  const retried = { ...clean(), key_retries: [{ piece, name }] };
  const line = fold_batch([retried, clean(), retried, retried], meta);
  assert.deepEqual(line.retries, [{ piece, case: name, retried: 3 }]);
  assert.equal(line.clean_runs, 4);
  assert.deepEqual(alert_reasons(line), []);
  assert.equal(summary_lines(line)[1], `${piece}  "${name}"  retried 3 times`);
});
