// Balancing for the sharded e2e run: piece weights, the order of the queue, the ledger of handed-out pieces, the exit rules and the run settings.
// It holds no session and starts no app, so its unit tests need neither. `npm run e2e:weights [timings file]` rewrites piece_seconds.json.
// Copied from DesertFox's test/key/shards.mjs. Departures:
// - a piece id is the full `<app>/<kind>/<section>` everywhere (queue, weights, ledger, timings). DesertFox's piece_name_of takes a file's basename, which here would fold every piece into `main` or its section and merge the two apps;
// - no pick_debug_ports: DesertBird has no debugger port, and each sink binds port 0;
// - classify_exit takes the piece a deadline cut off, and the ledger finishes a piece as done, timed_out or died;
// - unweighted_warnings names a piece with no weight, which DesertFox leaves silent;
// - read_setup holds the settings and their checks, so they are testable without a run.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMITTED_WEIGHTS_PATH = join(import.meta.dirname, "piece_seconds.json");
export const DEFAULT_SHARDS = 1;
// The least run deadline an unset E2E_DEADLINE_S derives (derive_deadline_s), so a short filtered run keeps room for a slow start.
export const DEADLINE_FLOOR_S = 900;
export const DEFAULT_PIECE_DEADLINE_S = 120;

export const piece_id = (app, piece) => `${app}/${piece.name}`;
// The app ends at the first slash. The rest is the registry name `<kind>/<section>`.
export function parse_piece_id(id) {
  const at = id.indexOf("/");
  return { app: id.slice(0, at), name: id.slice(at + 1) };
}

// An entry the coordinator wrote for a piece it cut off (run deadline, piece deadline, worker death) holds a time that says nothing about the piece's length.
const cut_short = (entry) => entry.in_flight || entry.timed_out || entry.died;

// Seconds per piece id from a timings file, at least 1, so the stale-weight check does not flag a piece for a fraction of a second.
export function weights_from_report(report) {
  const weights = {};
  for (const entry of report.pieces ?? []) {
    if (cut_short(entry)) continue;
    weights[entry.name] = (weights[entry.name] ?? 0) + Math.max(1, Math.round(entry.wall_ms / 1000));
  }
  return weights;
}

// A sharded run's merged file lists its workers. A serial run's file has no `workers`.
const is_sharded = (report) => (report.workers?.length ?? 0) > 1;

// The newest e2e-timings file in logs_dir that lists pieces of an unfiltered run, or undefined. The `.report.json` beside each one holds checks, not times.
// `serial_only` skips the files of sharded runs, whose pieces ran slower under the load of the other workers.
export function newest_timings_file(logs_dir, { serial_only = false } = {}) {
  let names;
  try {
    names = readdirSync(logs_dir).filter((name) => /^e2e-timings-.*\.json$/.test(name) && !name.endsWith(".report.json"));
  } catch {
    return undefined;
  }
  const by_age = names.map((name) => join(logs_dir, name)).map((path) => ({ path, mtime_ms: statSync(path).mtimeMs })).sort((left, right) => right.mtime_ms - left.mtime_ms);
  for (const { path, mtime_ms } of by_age) {
    try {
      const report = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(report.pieces) && report.pieces.length > 0 && !report.filter && !(serial_only && is_sharded(report))) return { path, mtime_ms, report };
    } catch {
      // A file cut off by a kill mid-write is skipped.
    }
  }
  return undefined;
}

// The committed weights, overridden piece by piece by a newer local timings file or by the file the caller names.
// A fresh worktree has no .logs, so the committed file is the base. The queue only needs the order, so a stale weight costs little.
export function load_weights({ committed_path = COMMITTED_WEIGHTS_PATH, logs_dir, chosen_file } = {}) {
  const committed = JSON.parse(readFileSync(committed_path, "utf8"));
  if (chosen_file) return { weights: { ...committed, ...weights_from_report(JSON.parse(readFileSync(chosen_file, "utf8"))) }, source: chosen_file };
  const local = logs_dir ? newest_timings_file(logs_dir) : undefined;
  if (local && local.mtime_ms > statSync(committed_path).mtimeMs) return { weights: { ...committed, ...weights_from_report(local.report) }, source: local.path };
  return { weights: committed, source: committed_path };
}

const exit_text = ({ code, signal }) => (signal ? `signal ${signal}` : `exit ${code}`);

// What a worker's exit means. failure is the line to report, if any. clean_exit says the worker stopped on request with nothing left to reap.
// After stop_reason is set the exits are the stop itself, never failures. A piece the piece deadline cut off already has its failure, so the kill that followed is not a second one.
export function classify_exit({ exit, state, in_flight_piece, timed_out_piece, startup_ms, startup_failure, last_lines, stop_reason, worker }) {
  const clean_exit = exit.code === 0 && state === "stopping";
  if (stop_reason || timed_out_piece) return { failure: undefined, clean_exit };
  if (in_flight_piece) return { failure: `${in_flight_piece}: worker w${worker} died (${exit_text(exit)}) while running it`, clean_exit };
  if (startup_ms === undefined) return { failure: `worker w${worker} startup: ${startup_failure ?? `${exit_text(exit)}: ${last_lines.join(" | ")}`}`, clean_exit };
  if (!clean_exit) return { failure: `worker w${worker} exited (${exit_text(exit)}) between pieces`, clean_exit };
  return { failure: undefined, clean_exit };
}

// The record of a run that stopped before its queue was done, or undefined when every piece finished.
export function build_incomplete({ stop_reason, in_flight, not_started }) {
  if (in_flight.length + not_started.length === 0) return undefined;
  return { reason: stop_reason ?? "every worker exited before the queue was empty", in_flight, not_started };
}

// 0 only for a run that passed and was not stopped. A stop picks its own code (130, 143, or 1 for the deadline).
export function final_exit_code({ failed_check_count, failure_count, incomplete, stop_reason, stop_exit_code }) {
  const passed = failed_check_count === 0 && failure_count === 0 && !incomplete && !stop_reason;
  return passed ? 0 : (stop_exit_code ?? 1);
}

// Longest first, so the long pieces start early and the short ones fill the gaps at the end.
// A piece with no weight goes first: a new piece of unknown length placed last can stretch the run by its whole length.
export function queue_order(ids, weights) {
  const weight_of = (id) => weights[id] ?? Number.POSITIVE_INFINITY;
  return [...ids].sort((left, right) => weight_of(right) - weight_of(left) || left.localeCompare(right));
}

// The coordinator's record of which worker holds which piece. A worker killed with SIGKILL writes nothing, so this is what names the in-flight pieces of a dead run.
// `outcome` is "done", "timed_out" (the piece deadline cut it off) or "died" (its worker died). Each one ends the piece, so it is no longer in flight.
export function create_ledger(queue) {
  const waiting = [...queue];
  const entries = new Map();
  return {
    take(worker, at_ms) {
      const id = waiting.shift();
      if (id !== undefined) entries.set(id, { id, worker, handed_at_ms: at_ms, done_at_ms: undefined, outcome: undefined });
      return id;
    },
    finish(id, at_ms, outcome = "done") {
      const entry = entries.get(id);
      if (entry && entry.done_at_ms === undefined) Object.assign(entry, { done_at_ms: at_ms, outcome });
    },
    in_flight: () => [...entries.values()].filter((entry) => entry.done_at_ms === undefined).map((entry) => entry.id),
    in_flight_of: (worker) => [...entries.values()].find((entry) => entry.worker === worker && entry.done_at_ms === undefined)?.id,
    outcome_of: (id) => entries.get(id)?.outcome,
    not_started: () => [...waiting],
    sequence_of: (worker) => [...entries.values()].filter((entry) => entry.worker === worker).map((entry) => entry.id),
    busy_ms_of: (worker, now_ms) => [...entries.values()].filter((entry) => entry.worker === worker).reduce((sum, entry) => sum + (entry.done_at_ms ?? now_ms) - entry.handed_at_ms, 0),
  };
}

// A piece that ran more than twice its weight, or more than 10 s over it, has a stale weight or was slowed by load.
export function stale_weight_warnings(pieces, weights) {
  const warnings = [];
  for (const entry of pieces) {
    if (cut_short(entry)) continue;
    const weight = weights[entry.name];
    if (weight === undefined) continue;
    const seconds = entry.wall_ms / 1000;
    if (seconds > weight * 2 || seconds > weight + 10) warnings.push(`${entry.name} ran ${seconds.toFixed(1)} s against a weight of ${weight} s`);
  }
  return warnings;
}

// A piece with no weight runs first and says nothing about its length, so a run names it.
export const unweighted_warnings = (ids, weights) => ids.filter((id) => weights[id] === undefined).map((id) => `${id} has no weight, so it runs first`);

// Rewrites the committed weights from a timings file. Pieces the file lacks keep their weight, and pieces that no longer exist are dropped.
export function write_weights(timings_path, { committed_path = COMMITTED_WEIGHTS_PATH, piece_ids }) {
  const report = JSON.parse(readFileSync(timings_path, "utf8"));
  if (report.incomplete) throw new Error(`${timings_path} is from a run that did not finish (${report.incomplete.reason}), so its pieces are cut short`);
  if (report.filter) throw new Error(`${timings_path} is from a run filtered by ${report.filter}, so its pieces may have skipped checks`);
  // The weights feed the piece deadline test (weight x 1.5), which assumes a piece alone on the machine. On several workers the pieces run up to twice as long.
  if (is_sharded(report)) throw new Error(`${timings_path} is from a run on ${report.workers.length} workers, so its pieces ran slower than alone. Name the timings file of a serial run (E2E_SHARDS=1)`);
  const fresh = weights_from_report(report);
  if (Object.keys(fresh).length === 0) throw new Error(`${timings_path} lists no finished piece`);
  const old = JSON.parse(readFileSync(committed_path, "utf8"));
  const merged = Object.fromEntries([...piece_ids].sort().map((id) => [id, fresh[id] ?? old[id]]).filter(([, seconds]) => seconds !== undefined));
  writeFileSync(committed_path, `${JSON.stringify(merged, null, 2)}\n`);
  return { merged, updated: Object.keys(fresh).filter((id) => piece_ids.includes(id)) };
}

function positive_integer_from_env(env, name, fallback) {
  const text = env[name];
  if (text === undefined || text === "") return fallback;
  if (!/^[1-9]\d*$/.test(text)) throw new Error(`${name} must be a whole number above 0, got "${text}"`);
  return Number(text);
}

// The run settings. Throws on a bad value, which the runner turns into exit 2. More workers than pieces would idle, so the count is capped at the queue.
export function read_setup(env, { queue_length }) {
  return {
    shard_count: Math.min(positive_integer_from_env(env, "E2E_SHARDS", DEFAULT_SHARDS), Math.max(1, queue_length)),
    // Undefined when unset: the runner derives it from the weights of the queue (derive_deadline_s).
    deadline_s: positive_integer_from_env(env, "E2E_DEADLINE_S", undefined),
    piece_deadline_s: positive_integer_from_env(env, "E2E_PIECE_DEADLINE_S", DEFAULT_PIECE_DEADLINE_S),
  };
}

// The larger of the piece's own deadline_s and the run's default. E2E_PIECE_DEADLINE_S never shortens a piece that is known to be long,
// and raising it raises every piece, so a loaded machine has one knob.
export const deadline_s_of = (piece, default_s) => Math.max(piece.deadline_s ?? 0, default_s);

// The run deadline when E2E_DEADLINE_S is unset: 1.5 times the longer of an even share of the queue's weight and its heaviest piece, plus 60 s for the
// worker starts, and never under DEADLINE_FLOOR_S. A piece with no weight counts as its piece deadline. The piece deadline already bounds a hang,
// so this only stops a queue that runs away, and a fixed 900 s stopped every full run of both apps on 3 workers (about 1,300 s).
export function derive_deadline_s({ ids, weights, shard_count, piece_deadline_of }) {
  const seconds = ids.map((id) => weights[id] ?? piece_deadline_of(id));
  const sum = seconds.reduce((total, value) => total + value, 0);
  return Math.max(DEADLINE_FLOOR_S, Math.ceil(1.5 * Math.max(sum / shard_count, ...seconds, 0)) + 60);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [verb, given_file] = process.argv.slice(2);
  if (verb !== "write-weights") {
    console.error("usage: node tools/e2e/shards.mjs write-weights [timings file]");
    process.exit(2);
  }
  const timings_path = given_file ?? newest_timings_file(join(import.meta.dirname, "..", "..", ".logs"), { serial_only: true })?.path;
  if (!timings_path) {
    console.error("e2e:weights: no unfiltered serial .logs/e2e-timings-*.json in this checkout. Run a full `npm run e2e -- --xpi dist/desertbird.xpi` first, or name a file.");
    process.exit(2);
  }
  const { load_pieces } = await import("./registry.mjs");
  const pieces = await load_pieces();
  const piece_ids = ["thunderbird", "betterbird"].flatMap((app) => pieces.map((piece) => piece_id(app, piece)));
  const { updated } = write_weights(timings_path, { piece_ids });
  console.log(`piece_seconds.json: ${updated.length} of ${piece_ids.length} pieces updated from ${timings_path}`);
}
