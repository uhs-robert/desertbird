import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const shards = await import(join(import.meta.dirname, "..", "tools", "e2e", "shards.mjs"));
const { build_incomplete, classify_exit, create_ledger, deadline_s_of, derive_deadline_s, DEADLINE_FLOOR_S, final_exit_code, load_weights, newest_timings_file, parse_piece_id, piece_id, queue_order, read_setup, stale_weight_warnings, unweighted_warnings, weights_from_report, write_weights } = shards;

function in_tmp(body: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-shards-test-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const write_json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const set_age = (path: string, seconds_ago: number) => {
  const at = new Date(Date.now() - seconds_ago * 1000);
  utimesSync(path, at, at);
};

test("a piece id is the app plus the registry name, and parses back at the first slash", () => {
  const id = piece_id("betterbird", { name: "compose_editor_html_top/main" });
  assert.equal(id, "betterbird/compose_editor_html_top/main");
  assert.deepEqual(parse_piece_id(id), { app: "betterbird", name: "compose_editor_html_top/main" });
});

test("the queue runs the heaviest first, an unweighted piece before all, and ties by name", () => {
  const weights = { "betterbird/message/main": 163, "thunderbird/message/main": 160, "betterbird/zoom/main": 73, "thunderbird/zoom/main": 73 };
  const ids = ["thunderbird/zoom/main", "betterbird/zoom/main", "thunderbird/message/main", "betterbird/new/main", "betterbird/message/main"];
  assert.deepEqual(queue_order(ids, weights), ["betterbird/new/main", "betterbird/message/main", "thunderbird/message/main", "betterbird/zoom/main", "thunderbird/zoom/main"]);
});

test("the same section under two apps stays two pieces with their own weights (the basename trap)", () => {
  const report = { pieces: [
    { name: "thunderbird/message/main", wall_ms: 160_000 },
    { name: "betterbird/message/main", wall_ms: 163_000 },
    { name: "betterbird/web/main", wall_ms: 132_000 },
    { name: "betterbird/default/hud", wall_ms: 35_000 },
  ] };
  const weights = weights_from_report(report);
  assert.deepEqual(weights, { "thunderbird/message/main": 160, "betterbird/message/main": 163, "betterbird/web/main": 132, "betterbird/default/hud": 35 });
  assert.equal(Object.keys(weights).length, report.pieces.length, "one weight per piece, none merged");
  for (const key of ["main", "hud", "message", "message/main"]) assert.ok(!(key in weights), `no weight keyed ${key}`);
  assert.deepEqual(queue_order(Object.keys(weights), weights).length, 4);
});

test("weights skip the entries of pieces the coordinator cut off, and round up to 1 s", () => {
  const report = { pieces: [
    { name: "a/b/c", wall_ms: 200 },
    { name: "a/b/d", wall_ms: 5000, in_flight: true },
    { name: "a/b/e", wall_ms: 5000, timed_out: true },
    { name: "a/b/f", wall_ms: 5000, died: true },
  ] };
  assert.deepEqual(weights_from_report(report), { "a/b/c": 1 });
});

test("the ledger hands out in order and tracks each worker's piece", () => {
  const ledger = create_ledger(["p1", "p2", "p3"]);
  assert.equal(ledger.take(1, 0), "p1");
  assert.equal(ledger.take(2, 10), "p2");
  assert.deepEqual(ledger.in_flight(), ["p1", "p2"]);
  assert.equal(ledger.in_flight_of(2), "p2");
  assert.deepEqual(ledger.not_started(), ["p3"]);
  // Worker 2 finishes before worker 1: the order of finishing changes nothing in the record.
  ledger.finish("p2", 30);
  assert.equal(ledger.take(2, 30), "p3");
  ledger.finish("p3", 50, "timed_out");
  assert.equal(ledger.outcome_of("p3"), "timed_out");
  assert.equal(ledger.in_flight_of(2), undefined, "a timed-out piece is no longer in flight");
  ledger.finish("p1", 100, "died");
  ledger.finish("p1", 200);
  assert.equal(ledger.outcome_of("p1"), "died", "the first outcome stays");
  assert.deepEqual(ledger.in_flight(), []);
  assert.equal(ledger.take(1, 100), undefined, "an empty queue hands out nothing");
  assert.deepEqual(ledger.sequence_of(2), ["p2", "p3"]);
  assert.equal(ledger.busy_ms_of(2, 999), 20 + 20);
  assert.equal(ledger.busy_ms_of(1, 999), 100);
});

test("classify_exit names each kind of exit", () => {
  const base = { state: "busy", in_flight_piece: undefined, timed_out_piece: undefined, startup_ms: 10, startup_failure: undefined, last_lines: ["a", "b"], stop_reason: undefined, worker: 3 };
  assert.deepEqual(classify_exit({ ...base, exit: { code: 0, signal: null }, state: "stopping" }), { failure: undefined, clean_exit: true });
  assert.deepEqual(classify_exit({ ...base, exit: { code: null, signal: "SIGTERM" }, in_flight_piece: "p", stop_reason: "received SIGINT" }), { failure: undefined, clean_exit: false });
  assert.equal(classify_exit({ ...base, exit: { code: 3, signal: null }, in_flight_piece: "a/b/c" }).failure, "a/b/c: worker w3 died (exit 3) while running it");
  assert.equal(classify_exit({ ...base, exit: { code: null, signal: "SIGKILL" }, in_flight_piece: "a/b/c" }).failure, "a/b/c: worker w3 died (signal SIGKILL) while running it");
  assert.deepEqual(classify_exit({ ...base, exit: { code: null, signal: "SIGKILL" }, timed_out_piece: "a/b/c", state: "killing" }), { failure: undefined, clean_exit: false }, "the piece deadline already reported it");
  assert.equal(classify_exit({ ...base, exit: { code: 1, signal: null }, startup_ms: undefined, startup_failure: "no pieces" }).failure, "worker w3 startup: no pieces");
  assert.equal(classify_exit({ ...base, exit: { code: 1, signal: null }, startup_ms: undefined }).failure, "worker w3 startup: exit 1: a | b");
  assert.equal(classify_exit({ ...base, exit: { code: 1, signal: null }, state: "idle" }).failure, "worker w3 exited (exit 1) between pieces");
});

test("build_incomplete and final_exit_code", () => {
  assert.equal(build_incomplete({ stop_reason: undefined, in_flight: [], not_started: [] }), undefined);
  assert.deepEqual(build_incomplete({ stop_reason: undefined, in_flight: [], not_started: ["x"] }), { reason: "every worker exited before the queue was empty", in_flight: [], not_started: ["x"] });
  assert.deepEqual(build_incomplete({ stop_reason: "deadline", in_flight: ["y"], not_started: [] }), { reason: "deadline", in_flight: ["y"], not_started: [] });
  const clean = { failed_check_count: 0, failure_count: 0, incomplete: undefined, stop_reason: undefined, stop_exit_code: undefined };
  assert.equal(final_exit_code(clean), 0);
  assert.equal(final_exit_code({ ...clean, failed_check_count: 1 }), 1);
  assert.equal(final_exit_code({ ...clean, failure_count: 1 }), 1);
  assert.equal(final_exit_code({ ...clean, incomplete: { reason: "x" } }), 1);
  assert.equal(final_exit_code({ ...clean, stop_reason: "deadline", stop_exit_code: 1 }), 1);
  assert.equal(final_exit_code({ ...clean, stop_reason: "received SIGINT", stop_exit_code: 130 }), 130);
  assert.equal(final_exit_code({ ...clean, stop_reason: "received SIGTERM", stop_exit_code: 143 }), 143);
});

test("the committed weights apply when the checkout has no timings file", () => in_tmp((dir) => {
  const committed = join(dir, "piece_seconds.json");
  write_json(committed, { "a/b/c": 5 });
  assert.deepEqual(load_weights({ committed_path: committed, logs_dir: join(dir, "missing") }), { weights: { "a/b/c": 5 }, source: committed });
}));

test("a newer unfiltered local file overrides piece by piece, and the .report.json beside it is skipped", () => in_tmp((dir) => {
  const committed = join(dir, "piece_seconds.json");
  write_json(committed, { "a/b/c": 5, "a/b/d": 7 });
  set_age(committed, 100);
  const logs = join(dir, "logs");
  mkdirSync(logs);
  write_json(join(logs, "e2e-timings-1.json"), { pieces: [{ name: "a/b/c", wall_ms: 9000 }] });
  set_age(join(logs, "e2e-timings-1.json"), 50);
  write_json(join(logs, "e2e-timings-2.json"), { filter: "E2E_KINDS=web", pieces: [{ name: "a/b/c", wall_ms: 1000 }] });
  write_json(join(logs, "e2e-timings-2.report.json"), { checks: [] });
  const loaded = load_weights({ committed_path: committed, logs_dir: logs });
  assert.deepEqual(loaded, { weights: { "a/b/c": 9, "a/b/d": 7 }, source: join(logs, "e2e-timings-1.json") });
  assert.equal(newest_timings_file(logs).path, join(logs, "e2e-timings-1.json"));
  const chosen = join(dir, "chosen.json");
  write_json(chosen, { pieces: [{ name: "a/b/d", wall_ms: 2000 }] });
  assert.deepEqual(load_weights({ committed_path: committed, logs_dir: logs, chosen_file: chosen }).weights, { "a/b/c": 5, "a/b/d": 2 });
}));

test("write_weights refuses a filtered or incomplete file, keeps old weights and drops removed pieces", () => in_tmp((dir) => {
  const committed = join(dir, "piece_seconds.json");
  write_json(committed, { "a/b/c": 5, "a/b/gone": 3, "a/b/kept": 4 });
  const filtered = join(dir, "filtered.json");
  write_json(filtered, { filter: "E2E_ONLY=hud", pieces: [{ name: "a/b/c", wall_ms: 1000 }] });
  assert.throws(() => write_weights(filtered, { committed_path: committed, piece_ids: ["a/b/c"] }), /filtered by E2E_ONLY=hud/);
  const incomplete = join(dir, "incomplete.json");
  write_json(incomplete, { incomplete: { reason: "deadline" }, pieces: [{ name: "a/b/c", wall_ms: 1000 }] });
  assert.throws(() => write_weights(incomplete, { committed_path: committed, piece_ids: ["a/b/c"] }), /did not finish/);
  const full = join(dir, "full.json");
  write_json(full, { pieces: [{ name: "a/b/c", wall_ms: 12_000 }, { name: "a/b/cut", wall_ms: 1000, timed_out: true }] });
  const { updated } = write_weights(full, { committed_path: committed, piece_ids: ["a/b/kept", "a/b/c", "a/b/cut"] });
  assert.deepEqual(updated, ["a/b/c"]);
  assert.deepEqual(JSON.parse(readFileSync(committed, "utf8")), { "a/b/c": 12, "a/b/kept": 4 });
}));

test("a piece far over its weight warns, and a piece with no weight warns", () => {
  const weights = { "a/b/c": 10, "a/b/d": 100 };
  const pieces = [{ name: "a/b/c", wall_ms: 25_000 }, { name: "a/b/d", wall_ms: 105_000 }, { name: "a/b/e", wall_ms: 1000 }, { name: "a/b/c", wall_ms: 60_000, in_flight: true }];
  assert.deepEqual(stale_weight_warnings(pieces, weights), ["a/b/c ran 25.0 s against a weight of 10 s"]);
  assert.deepEqual(unweighted_warnings(["a/b/c", "a/b/e"], weights), ["a/b/e has no weight, so it runs first"]);
});

test("read_setup defaults to one worker and checks every setting", () => {
  assert.deepEqual(read_setup({}, { queue_length: 10 }), { shard_count: 1, deadline_s: undefined, piece_deadline_s: 120 });
  assert.equal(read_setup({ E2E_SHARDS: "6" }, { queue_length: 4 }).shard_count, 4, "capped at the queue");
  assert.equal(read_setup({ E2E_SHARDS: "3", E2E_DEADLINE_S: "300", E2E_PIECE_DEADLINE_S: "60" }, { queue_length: 10 }).deadline_s, 300);
  for (const [name, value] of [["E2E_SHARDS", "0"], ["E2E_SHARDS", "abc"], ["E2E_SHARDS", "-1"], ["E2E_DEADLINE_S", "1.5"], ["E2E_PIECE_DEADLINE_S", "0"]]) {
    assert.throws(() => read_setup({ [name as string]: value }, { queue_length: 10 }), new RegExp(`${name} must be a whole number above 0`));
  }
});

test("a piece's own deadline wins over the run's default", () => {
  assert.equal(deadline_s_of({ deadline_s: 250 }, 60), 250);
  assert.equal(deadline_s_of({}, 60), 60);
});

test("an unset run deadline is 1.5 times the larger of a worker's share and the heaviest piece, plus 60 s, and at least the floor", () => {
  assert.equal(DEADLINE_FLOOR_S, 900);
  const piece_deadline_of = () => 120;
  const ids = ["a/b/1", "a/b/2", "a/b/3", "a/b/4"];
  const weights = { "a/b/1": 900, "a/b/2": 900, "a/b/3": 900, "a/b/4": 900 };
  assert.equal(derive_deadline_s({ ids, weights, shard_count: 3, piece_deadline_of }), 1860, "share 1200 s");
  assert.equal(derive_deadline_s({ ids, weights: { ...weights, "a/b/1": 1500 }, shard_count: 4, piece_deadline_of }), 2310, "heaviest 1500 s beats the share");
  assert.equal(derive_deadline_s({ ids: ["a/b/1"], weights: { "a/b/1": 30 }, shard_count: 3, piece_deadline_of }), 900, "the floor");
  assert.equal(derive_deadline_s({ ids: ["a/b/new"], weights: {}, shard_count: 1, piece_deadline_of: () => 1000 }), 1560, "no weight counts as its piece deadline");
});

test("the committed weights give a full run of both apps on 3 workers a deadline over its measured 1,290 s", () => {
  const committed = JSON.parse(readFileSync(join(import.meta.dirname, "..", "tools", "e2e", "piece_seconds.json"), "utf8"));
  assert.ok(derive_deadline_s({ ids: Object.keys(committed), weights: committed, shard_count: 3, piece_deadline_of: () => 120 }) > 1290);
});

test("write_weights refuses the file of a run on several workers, and the newest serial file is the default", () => in_tmp((dir) => {
  const committed = join(dir, "piece_seconds.json");
  write_json(committed, { "a/b/c": 5 });
  const logs = join(dir, "logs");
  mkdirSync(logs);
  const serial = join(logs, "e2e-timings-1.json");
  write_json(serial, { pieces: [{ name: "a/b/c", wall_ms: 7000 }] });
  set_age(serial, 60);
  const sharded = join(logs, "e2e-timings-2.json");
  write_json(sharded, { workers: [{ worker: 1 }, { worker: 2 }, { worker: 3 }], pieces: [{ name: "a/b/c", wall_ms: 12_000, worker: 1 }] });
  assert.throws(() => write_weights(sharded, { committed_path: committed, piece_ids: ["a/b/c"] }), /on 3 workers/);
  assert.deepEqual(JSON.parse(readFileSync(committed, "utf8")), { "a/b/c": 5 }, "the weights are unchanged");
  assert.equal(newest_timings_file(logs).path, sharded, "the queue order still reads the newest file");
  assert.equal(newest_timings_file(logs, { serial_only: true }).path, serial);
}));
