// One-off measurement that decides the worker count: starts 1 and then 4 apps at once, each in its own headless labwc session
// and fresh profile through the e2e harness, and records startup time and peak memory.
//   node tools/e2e/measure_concurrent.mjs [thunderbird|betterbird] --xpi dist/desertbird.xpi [--counts 1,4]
// Everything runs in a fresh folder made by mkdtemp. E2E_CONCURRENT_FILE sets the result path and must sit inside that folder, default <folder>/concurrent.json.
// E2E_CONCURRENT_FAIL_LAST=1 makes the last app of each round fail after it starts, to show that every session still stops.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { start_app } from "./harness.mjs";

const args = process.argv.slice(2);
const value_of = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const [, value] = args.splice(at, 2);
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
};
const xpi_value = value_of("--xpi");
if (!xpi_value) throw new Error("--xpi <path> is needed: the startup time is read from the helper add-on");
const xpi_path = resolve(xpi_value);
const counts = (value_of("--counts") ?? "1,4").split(",").map(Number);
const app = args.find((arg) => !arg.startsWith("--")) ?? "thunderbird";
const measure_dir = resolve(process.env.MEASURE_DIR ?? "/tmp/desertbird-measure");
const binaries = { thunderbird: join(measure_dir, "thunderbird-153.7.0esr", "thunderbird", "thunderbird"), betterbird: "/usr/bin/betterbird" };
if (!binaries[app]) throw new Error(`unknown app ${app}`);

// A fresh folder every run: the harness deletes the profile and out folders it is given, so it never gets a folder from the environment.
const run_dir = mkdtempSync(join(tmpdir(), "desertbird-concurrent-"));
const inside_run_dir = (path) => resolve(path).startsWith(`${run_dir}${sep}`);
const out_file = resolve(process.env.E2E_CONCURRENT_FILE ?? join(run_dir, "concurrent.json"));
if (!inside_run_dir(out_file)) throw new Error(`E2E_CONCURRENT_FILE ${out_file} is outside the run folder ${run_dir}`);
const stagger_ms = 500;
const sleep = (ms) => new Promise((resolve_sleep) => setTimeout(resolve_sleep, ms));

async function run_one(count, index) {
  await sleep(index * stagger_ms);
  const work_dir = join(run_dir, `c${count}_${index}`);
  if (!inside_run_dir(work_dir)) throw new Error(`work folder ${work_dir} is outside the run folder`);
  const instance = await start_app({ app, app_binary: binaries[app], work_dir, kind: "default", xpi_path });
  try {
    if (!inside_run_dir(instance.profile_dir) || !inside_run_dir(instance.out_dir)) throw new Error("the profile or out folder is outside the run folder");
    if (process.env.E2E_CONCURRENT_FAIL_LAST === "1" && index === count - 1) throw new Error("forced failure");
    // Everything the add-on and the helper do on the first Inbox open counts toward the peak.
    await instance.ask("state");
    await sleep(3000);
    return { index, startup: instance.startups[0], peak_memory_kb: instance.memory() };
  } finally {
    await instance.stop();
  }
}

async function run_round(count) {
  const began = Date.now();
  // allSettled waits for every instance, so one failure never leaves another running.
  const settled = await Promise.allSettled(Array.from({ length: count }, (_, index) => run_one(count, index)));
  const failed = settled.filter((entry) => entry.status === "rejected");
  if (failed.length) throw new Error(`${failed.length} of ${count} failed: ${failed.map((entry) => entry.reason?.message).join("; ")}`);
  const results = settled.map((entry) => entry.value);
  const sum = (pick) => results.reduce((total, entry) => total + pick(entry), 0);
  return {
    count,
    wall_ms: Date.now() - began,
    instances: results,
    sum_of_peaks_kb: { rss: sum((entry) => entry.peak_memory_kb.app.rss_kb + entry.peak_memory_kb.labwc.rss_kb), pss: sum((entry) => entry.peak_memory_kb.app.pss_kb + entry.peak_memory_kb.labwc.pss_kb) },
  };
}

const rounds = [];
let exit_code = 0;
try {
  for (const count of counts) {
    const round = await run_round(count);
    rounds.push(round);
    console.log(`${count} at once: wall ${round.wall_ms} ms, enabled at ${round.instances.map((entry) => entry.startup.enabled_ms).join(", ")} ms, sum of peaks rss ${Math.round(round.sum_of_peaks_kb.rss / 1024)} MB, pss ${Math.round(round.sum_of_peaks_kb.pss / 1024)} MB`);
  }
  mkdirSync(dirname(out_file), { recursive: true });
  writeFileSync(out_file, `${JSON.stringify({ app, rounds }, null, 2)}\n`);
  console.log(`wrote ${out_file}`);
} catch (error) {
  console.error(error.message);
  exit_code = 1;
}
process.exit(exit_code);
