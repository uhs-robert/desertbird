// End-to-end run in a headless labwc session:
//   node tools/e2e/run.mjs [thunderbird|betterbird]... [--xpi path] [--binary app=path]
// With no --xpi it only proves the setup: each app starts in a fresh profile and one screenshot is taken.
// The run is a list of pieces (see registry.mjs), each on a fresh profile. E2E_KINDS, E2E_ONLY and E2E_SCALE choose them.
// Scratch files go to $E2E_DIR, or to a fresh desertbird-e2e-* folder under the temp dir that is removed after a pass unless E2E_KEEP=1. Thunderbird comes from tools/measure/fetch_thunderbird.sh. Betterbird is /usr/bin/betterbird.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { install_lifecycle, start_app } from "./harness.mjs";
import { open_run_dir } from "./run_dir.mjs";
import { create_timings } from "./timings.mjs";
import { run_piece } from "./piece_runner.mjs";
import { load_pieces, select_pieces } from "./registry.mjs";

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
try {
  pieces = select_pieces(await load_pieces(), process.env);
} catch (error) { console.error(`e2e: ${error.message}`); process.exit(1); }
// With no xpi a piece only starts its app, so one piece per kind proves the setup.
if (!xpi_path) pieces = pieces.filter((piece, at) => pieces.findIndex((other) => other.kind === piece.kind) === at);

let run_dir;
try { run_dir = open_run_dir(); } catch (error) { console.error(`e2e: ${error.message}`); process.exit(1); }
const e2e_dir = run_dir.dir;
console.log(`e2e: work dir ${e2e_dir}`);
const finish = install_lifecycle(run_dir);
// Timings and report outlive the run dir, which is scratch and goes after a pass. Like DesertFox's default_timings_path, they go under <repo>/.logs, and E2E_TIMINGS_FILE overrides.
const timings_path = resolve(process.env.E2E_TIMINGS_FILE ?? join(import.meta.dirname, "..", "..", ".logs", `e2e-timings-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.json`));
const report_path = timings_path.replace(/\.json$/, "") + ".report.json";
const timings = create_timings(timings_path);

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
