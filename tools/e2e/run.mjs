// End-to-end run in a headless labwc session:
//   node tools/e2e/run.mjs [thunderbird|betterbird]... [--xpi path] [--binary app=path]
// With no --xpi it only proves the setup: each app starts in a fresh profile and one screenshot is taken.
// The run is a list of pieces (see registry.mjs), each on a fresh profile. E2E_KINDS, E2E_ONLY and E2E_SCALE choose them.
// E2E_SHARDS above 1 runs the pieces on that many forked workers (coordinator.mjs). Otherwise this process runs them one after another.
// Scratch files go to $E2E_DIR, or to a fresh desertbird-e2e-* folder under the temp dir that is removed after a pass unless E2E_KEEP=1. Thunderbird comes from tools/measure/fetch_thunderbird.sh. Betterbird is /usr/bin/betterbird.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { install_lifecycle, start_app } from "./harness.mjs";
import { open_run_dir } from "./run_dir.mjs";
import { create_timings, default_timings_path, filter_of, report_path_of } from "./timings.mjs";
import { run_piece } from "./piece_runner.mjs";
import { load_pieces, select_pieces } from "./registry.mjs";
import { deadline_s_of, load_weights, parse_piece_id, piece_id, read_setup } from "./shards.mjs";
import { run_sharded } from "./coordinator.mjs";

const SETUP_ERROR_EXIT = 2;
const repo_dir = join(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const [, value] = args.splice(at, 2);
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
};
const xpi_path = option("--xpi");
const measure_dir = resolve(process.env.MEASURE_DIR ?? "/tmp/desertbird-measure");
const binaries = {
  thunderbird: join(measure_dir, "thunderbird-153.7.0esr", "thunderbird", "thunderbird"),
  betterbird: "/usr/bin/betterbird",
};
for (let value; (value = option("--binary")); ) { const [name, path] = value.split("="); binaries[name] = path; }
const apps = args.length ? args : ["thunderbird", "betterbird"];

let pieces;
let setup;
try {
  pieces = select_pieces(await load_pieces(), process.env);
  // With no xpi a piece only starts its app, so one piece per kind proves the setup.
  if (!xpi_path) pieces = pieces.filter((piece, at) => pieces.findIndex((other) => other.kind === piece.kind) === at);
  setup = read_setup(process.env, { queue_length: apps.length * pieces.length });
} catch (error) { console.error(`e2e: ${error.message}`); process.exit(SETUP_ERROR_EXIT); }

let run_dir;
try { run_dir = open_run_dir(); } catch (error) { console.error(`e2e: ${error.message}`); process.exit(1); }
const e2e_dir = run_dir.dir;
console.log(`e2e: work dir ${e2e_dir}`);
const timings_path = resolve(default_timings_path(repo_dir));
const report_path = report_path_of(timings_path);
const filter = filter_of(process.env, { xpi_path });

// One piece after another in this process, in registry order, with no queue, weights or deadline.
async function run_serial() {
  const finish = install_lifecycle(run_dir);
  const timings = create_timings(timings_path, { filter });
  // The evidence of every piece, in run order.
  const report = { checks: [], shots: [], notes: [] };
  let all_ok = true;
  for (const app of apps) {
    if (!binaries[app] || !existsSync(binaries[app])) throw new Error(`no binary for ${app} at ${binaries[app]}`);
    for (const piece of pieces) {
      const result = await run_piece(app, piece, { binaries, xpi_path, run_dir: e2e_dir, timings, start_app });
      for (const key of Object.keys(report)) report[key].push(...result.report[key]);
      all_ok = all_ok && result.ok;
    }
  }
  if (xpi_path) {
    mkdirSync(dirname(report_path), { recursive: true });
    writeFileSync(report_path, JSON.stringify(report, null, 2));
    console.log(`e2e: timings ${timings_path}, report ${report_path}`);
  }
  finish(all_ok);
  process.exit(all_ok ? 0 : 1);
}

async function run_on_workers() {
  const signal_codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  let sharded = null;
  let signalled = false;
  // On a signal the lifecycle waits for the workers to stop and the report to be written, then frees the lock and exits with the signal's code.
  const finish = install_lifecycle(run_dir, {
    on_signal: async (signal) => {
      signalled = true;
      sharded?.stop(`received ${signal}`, signal_codes[signal]);
      await sharded?.done;
    },
  });
  const missing = apps.find((app) => !binaries[app] || !existsSync(binaries[app]));
  if (missing) {
    console.error(`e2e: no binary for ${missing} at ${binaries[missing]}`);
    finish(false);
    process.exit(SETUP_ERROR_EXIT);
  }
  const ids = apps.flatMap((app) => pieces.map((piece) => piece_id(app, piece)));
  const { weights, source } = load_weights({ logs_dir: join(repo_dir, ".logs"), chosen_file: process.env.E2E_WEIGHTS });
  console.log(`e2e: weights from ${source}`);
  const piece_deadline_of = (id) => deadline_s_of(pieces.find((piece) => piece.name === parse_piece_id(id).name), setup.piece_deadline_s);
  sharded = run_sharded({ ids, weights, shard_count: setup.shard_count, deadline_s: setup.deadline_s, piece_deadline_of, init: { run_dir: e2e_dir, xpi_path, binaries }, timings_path, report_path: xpi_path ? report_path : null, filter });
  const { exit_code } = await sharded.done;
  if (signalled) return;
  finish(exit_code === 0);
  process.exit(exit_code);
}

await (setup.shard_count > 1 ? run_on_workers() : run_serial());
