// One worker of a sharded e2e run, forked by coordinator.mjs. It runs the pieces the coordinator hands it, one at a time, until it is told to stop.
// Copied from DesertFox's test/key/worker.mjs. Departures:
// - no session lives across pieces: each piece starts and stops its own app through run_piece, the function the serial run calls, so a fresh worker can take over any queue;
// - the config comes in an `init` message, and a `run` message carries the full piece id, which the worker looks up in its own registry (a piece holds functions, which cannot cross IPC);
// - `piece_done` carries the piece's checks and its timings entries, so no worker writes a file and a killed worker loses only its piece in flight;
// - signals go through install_lifecycle, which stops the piece's apps by group, in place of DesertFox's own `signalled` handlers.
import { install_lifecycle, start_app, stop_all_apps } from "./harness.mjs";
import { run_piece } from "./piece_runner.mjs";
import { load_pieces } from "./registry.mjs";
import { parse_piece_id } from "./shards.mjs";
import { create_timings } from "./timings.mjs";

// Resolves once the message is out, so a worker that exits right after still delivers it.
const send = (message) => new Promise((resolve) => {
  if (process.connected) process.send(message, () => resolve());
  else resolve();
});

// The run dir belongs to the coordinator, which holds its lock and removes it. This stub only gives install_lifecycle something to close.
install_lifecycle({ dir: null, close: () => "" }, { announce: false });

// A signal stops the apps while the piece goes on and fails against them. That piece did not finish, so it is not reported done, and the coordinator lists it as in flight.
let signalled = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { signalled = true; });

// The coordinator died or dropped this worker. No app outlives its coordinator.
process.on("disconnect", () => { signalled = true; stop_all_apps().then(() => process.exit(1)); });

let config = null;
let pieces = null;
const timings = create_timings(null);

async function run(id) {
  const { app, name } = parse_piece_id(id);
  const piece = pieces.find((candidate) => candidate.name === name);
  const entries_before = timings.report().pieces.length;
  try {
    if (!piece) throw new Error(`no piece is named ${name}`);
    const result = await run_piece(app, piece, { ...config, timings, start_app });
    if (signalled) return;
    await send({ type: "piece_done", id, ok: result.ok, report: result.report, wall_ms: result.wall_ms, timing_entries: timings.report().pieces.slice(entries_before) });
  } catch (error) {
    // run_piece catches what a piece throws. This is a throw before its start: a path guard, a seed or a missing piece.
    if (signalled) return;
    console.log(`FAIL ${id} worker: ${error.message}`);
    await send({ type: "piece_done", id, ok: false, error: error.message, report: { checks: [], shots: [], notes: [] }, timing_entries: timings.report().pieces.slice(entries_before) });
  }
}

process.on("message", async (message) => {
  if (message.type === "init") {
    config = { run_dir: message.run_dir, xpi_path: message.xpi_path, binaries: message.binaries };
    try {
      pieces = await load_pieces();
    } catch (error) {
      await send({ type: "startup_failed", reason: error.message });
      process.exit(1);
    }
    await send({ type: "ready" });
  } else if (message.type === "run") {
    await run(message.id);
  } else if (message.type === "stop") {
    process.exit(0);
  }
});
