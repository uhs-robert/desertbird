// The coordinator of a sharded e2e run: it forks the workers, hands out pieces from one queue, enforces the run and piece deadlines,
// replaces a worker that died, merges the timings and checks into one report and returns the exit code.
// Copied from DesertFox's test/key/run.mjs. Departures:
// - run_sharded is a function with seams (worker_file, fork, reap, the clock), so tests drive it with a fake worker, and it returns the exit code where DesertFox exits;
// - the coordinator staggers the first hand-out of each worker (500 ms apart) and starts the piece timer at the hand-out, so the stagger never eats a piece's deadline;
// - a piece deadline: a piece with no result in time fails, its worker is stopped and its apps reaped;
// - a worker that dies or is killed while it holds a piece is replaced by a fresh fork while pieces wait, because workers hold no state. A death before `ready` is not replaced, so a bad setup cannot loop, and every other death burns its piece, so replacements are bounded by the piece count;
// - no debug ports and no session names: a worker that did not stop cleanly gets its piece dir reaped (reap.mjs);
// - workers share the coordinator's run dir and its one lock. Every piece already has its own dir, display, HOME and sink port.
import { fork as fork_process } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { reap_piece_dir } from "./reap.mjs";
import { build_incomplete, classify_exit, create_ledger, final_exit_code, queue_order, stale_weight_warnings, unweighted_warnings } from "./shards.mjs";
import { merge_check_reports, merge_reports, summary_text } from "./timings.mjs";

// Four apps started 500 ms apart measured no slowdown (measure_concurrent.mjs).
const STARTUP_STAGGER_MS = 500;
// A worker's own stop (its apps' kill grace is 3.5 s) gets this long after SIGTERM before it is killed.
const STOP_GRACE_MS = 10000;

const write_json = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

// setup: { ids, weights, shard_count, deadline_s, piece_deadline_of(id), init: { run_dir, xpi_path, binaries }, timings_path, report_path, filter, env }.
// `ids` are the piece ids in registry order (apps outer), which is the order of the merged checks. `report_path` is null for a run with no xpi.
// Returns { done, stop }. `done` resolves with { exit_code, merged, stop_reason } after every worker has exited and the files are written.
// `stop(reason, exit_code)` stops every worker. A signal handler awaits `done` after it.
export function run_sharded(setup) {
  const { ids, weights, shard_count, deadline_s, piece_deadline_of, init, timings_path, report_path, filter, env = process.env } = setup;
  const { worker_file = join(import.meta.dirname, "worker.mjs"), fork = fork_process, reap = reap_piece_dir, log = console.log, stagger_ms = STARTUP_STAGGER_MS, stop_grace_ms = STOP_GRACE_MS } = setup;
  const started_at = Date.now();
  const elapsed_ms = () => Date.now() - started_at;
  const queue = queue_order(ids, weights);
  const ledger = create_ledger(queue);
  log(`e2e: ${ids.length} pieces on ${shard_count} workers, deadline ${deadline_s} s`);
  for (const warning of unweighted_warnings(ids, weights)) log(`e2e: ${warning}`);

  const failures = [];
  // One per finished piece: { id, worker, report }. The merged checks come from here.
  const results = [];
  const workers = [];
  let stop_reason;
  let stop_exit_code;
  let deadline_timer = null;
  let resolve_done;
  const done = new Promise((resolve) => { resolve_done = resolve; });

  // The coordinator owns the run dir and its lock, so a worker never opens another one.
  const { E2E_DIR: _owned_by_coordinator, ...worker_env } = env;

  function spawn_worker(first_delay_ms) {
    const number = workers.length + 1;
    // No execArgv: a flag of the coordinator's own node (--inspect, --input-type) breaks a worker or clashes between workers.
    const child = fork(worker_file, [], { silent: true, execArgv: [], env: { ...worker_env, E2E_WORKER: String(number) } });
    // The worker's own report: the timings entries of its pieces, plus the entries the coordinator writes for a piece it cut off.
    const entry = { worker: number, child, state: "starting", first_delay_ms, startup_ms: undefined, finished_ms: undefined, exit: undefined, startup_failure: undefined, last_lines: [], piece: undefined, piece_timer: null, timed_out_piece: undefined, kill_timer: null, report: { pieces: [] } };
    workers.push(entry);
    // Live lines, so nothing is lost when the run is killed. The tag says which worker printed them.
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on("line", (line) => {
        entry.last_lines = [...entry.last_lines.slice(-4), line];
        log(`[w${number}] ${line}`);
      });
    }
    // A send to a worker that died after its last message fails here, and the exit handler records the death.
    // A fork that never spawned (EAGAIN, ENOMEM) has no pid and may never emit exit, so its exit is recorded here, or `done` would never resolve and the lock would stay held.
    child.on("error", (error) => {
      log(`e2e: w${number}: ${error.message}`);
      if (child.pid === undefined && entry.exit === undefined) on_exit(entry, { code: null, signal: null });
    });
    child.on("message", (message) => on_message(entry, message));
    child.on("exit", (code, signal) => on_exit(entry, { code, signal }));
    child.send({ type: "init", ...init });
    return entry;
  }

  const send = (entry, message) => { try { entry.child.send(message); } catch {} };

  function stop_worker(entry) {
    entry.state = "stopping";
    send(entry, { type: "stop" });
  }

  // SIGTERM lets the worker stop its apps. A worker that does not exit in the grace gets SIGKILL, and its exit handler reaps its piece dir.
  function terminate(entry) {
    if (entry.exit !== undefined) return;
    entry.child.kill("SIGTERM");
    entry.kill_timer ??= setTimeout(() => {
      if (entry.exit !== undefined) return;
      log(`e2e: w${entry.worker} did not stop within ${stop_grace_ms / 1000} s, killing it`);
      entry.child.kill("SIGKILL");
    }, stop_grace_ms);
  }

  function hand_out(entry) {
    if (stop_reason || entry.exit !== undefined) return;
    const id = ledger.take(entry.worker, elapsed_ms());
    if (id === undefined) {
      stop_worker(entry);
      return;
    }
    entry.state = "busy";
    entry.piece = { id, handed_ms: elapsed_ms() };
    const piece_deadline_s = piece_deadline_of(id);
    entry.piece_timer = setTimeout(() => piece_timed_out(entry, id, piece_deadline_s), piece_deadline_s * 1000);
    send(entry, { type: "run", id });
  }

  function piece_timed_out(entry, id, piece_deadline_s) {
    if (stop_reason || entry.piece?.id !== id) return;
    failures.push(`${id}: no result within ${piece_deadline_s} s (piece deadline)`);
    entry.report.pieces.push({ name: id, wall_ms: elapsed_ms() - entry.piece.handed_ms, timed_out: true });
    ledger.finish(id, elapsed_ms(), "timed_out");
    entry.timed_out_piece = id;
    entry.piece = undefined;
    entry.state = "killing";
    log(`e2e: ${id} passed its ${piece_deadline_s} s piece deadline, stopping w${entry.worker}`);
    terminate(entry);
  }

  function on_message(entry, message) {
    if (message.type === "ready") {
      entry.startup_ms = elapsed_ms();
      setTimeout(() => hand_out(entry), entry.first_delay_ms);
    } else if (message.type === "startup_failed") {
      entry.startup_failure = message.reason;
    } else if (message.type === "piece_done") {
      // A result that comes after the piece deadline is dropped: the piece already failed and its worker is being stopped.
      if (entry.piece?.id !== message.id) return;
      clearTimeout(entry.piece_timer);
      entry.piece = undefined;
      ledger.finish(message.id, elapsed_ms());
      results.push({ id: message.id, worker: entry.worker, report: message.report });
      entry.report.pieces.push(...(message.timing_entries ?? []));
      if (message.error) failures.push(`${message.id}: ${message.error}`);
      else if (!message.ok && !(message.report?.checks ?? []).some((check) => !check.ok)) failures.push(`${message.id}: the piece failed with no failed check`);
      entry.state = "idle";
      hand_out(entry);
    }
  }

  // Once per worker: a fork that never spawned reaches here from its error handler, and an exit event that still follows must not count it twice.
  function on_exit(entry, exit) {
    if (entry.exit !== undefined) return;
    entry.exit = exit;
    entry.finished_ms = elapsed_ms();
    clearTimeout(entry.piece_timer);
    clearTimeout(entry.kill_timer);
    const in_flight_piece = ledger.in_flight_of(entry.worker);
    const { failure, clean_exit } = classify_exit({ exit, state: entry.state, in_flight_piece, timed_out_piece: entry.timed_out_piece, startup_ms: entry.startup_ms, startup_failure: entry.startup_failure, last_lines: entry.last_lines, stop_reason, worker: entry.worker });
    if (failure) failures.push(failure);
    // A piece whose worker died mid-run ends here, so the run goes on without it. After a stop it stays in flight for the incomplete record.
    if (in_flight_piece && !stop_reason) {
      entry.report.pieces.push({ name: in_flight_piece, wall_ms: elapsed_ms() - entry.piece.handed_ms, died: true });
      ledger.finish(in_flight_piece, elapsed_ms(), "died");
    } else if (in_flight_piece) {
      entry.report.pieces.push({ name: in_flight_piece, wall_ms: elapsed_ms() - entry.piece.handed_ms, in_flight: true });
    }
    // A worker that did not stop cleanly may have left the apps of its last piece running.
    const last_piece = in_flight_piece ?? entry.timed_out_piece;
    if (last_piece && !clean_exit) {
      const reaped = reap(join(init.run_dir, last_piece));
      if (reaped.length) log(`e2e: w${entry.worker} left ${reaped.length} process groups of ${last_piece}, killed them`);
    }
    entry.state = "exited";
    if (last_piece && entry.startup_ms !== undefined && !stop_reason && ledger.not_started().length > 0) {
      log(`e2e: w${entry.worker} is gone, starting a fresh worker`);
      spawn_worker(0);
    }
    if (workers.every((other) => other.state === "exited")) finish_run();
  }

  function stop_all(reason, exit_code) {
    if (stop_reason) return;
    stop_reason = reason;
    stop_exit_code = exit_code;
    log(`e2e: stopping all workers: ${reason}`);
    for (const entry of workers) {
      clearTimeout(entry.piece_timer);
      terminate(entry);
    }
  }

  function finish_run() {
    clearTimeout(deadline_timer);
    const total_ms = elapsed_ms();
    const in_flight = ledger.in_flight();
    const not_started = ledger.not_started();
    const incomplete = build_incomplete({ stop_reason, in_flight, not_started });
    const worker_info = workers.map((entry) => ({
      worker: entry.worker,
      startup_ms: entry.startup_ms,
      busy_ms: ledger.busy_ms_of(entry.worker, total_ms),
      // How long this worker sat finished while others still ran: the slack of the balance.
      idle_ms: total_ms - entry.finished_ms,
      finished_ms: entry.finished_ms,
      pieces: ledger.sequence_of(entry.worker),
      exit: entry.exit,
    }));
    const checks = merge_check_reports(results, ids);
    const failed_checks = checks.checks.filter((check) => !check.ok).map(({ piece, worker, name, detail }) => ({ piece, worker, name, detail }));
    let exit_code = final_exit_code({ failed_check_count: failed_checks.length, failure_count: failures.length, incomplete, stop_reason, stop_exit_code });
    const merged = merge_reports(workers.map((entry) => ({ worker: entry.worker, report: entry.report })), { total_ms, workers: worker_info, incomplete, filter });
    Object.assign(merged, { failed_checks, failures, exit_code });
    // A run that cannot show its evidence did not pass. A stop keeps its own code. The report goes first, so the timings file records a failed write of it.
    const write_or_fail = (path, value) => {
      try {
        write_json(path, value);
      } catch (error) {
        log(`e2e: timings or report not written: ${error.message}`);
        if (exit_code === 0) exit_code = 1;
        merged.exit_code = exit_code;
      }
    };
    if (report_path) write_or_fail(report_path, checks);
    write_or_fail(timings_path, merged);
    log(summary_text(merged));
    for (const warning of stale_weight_warnings(merged.pieces, weights)) log(`e2e: slower than its weight on ${shard_count} workers: ${warning}`);
    log(`e2e: timings ${timings_path}${report_path ? `, report ${report_path}` : ""}`);
    const passed = checks.checks.filter((check) => check.ok).length;
    log(`e2e: ${passed} of ${checks.checks.length} checks passed`);
    resolve_done({ exit_code, merged, stop_reason });
  }

  // From the start, not the first hand-out, so a worker that never says ready cannot hold the run open.
  deadline_timer = setTimeout(() => stop_all(`the ${deadline_s} s deadline passed (E2E_DEADLINE_S)`, 1), deadline_s * 1000);
  for (let index = 0; index < shard_count; index++) spawn_worker(index * stagger_ms);
  return { done, stop: stop_all };
}
