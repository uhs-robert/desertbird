// One-off measurement that decides the worker count: starts 1 and then 4 apps at once, each in its own headless labwc session
// and fresh profile through the e2e harness, and records startup time and peak memory.
//   node tools/e2e/measure_concurrent.mjs [thunderbird|betterbird] --xpi dist/desertbird.xpi
// Scratch files go to $E2E_DIR, the result to $E2E_CONCURRENT_FILE (default $E2E_DIR/concurrent.json). Both default to fresh temporary folders.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { start_app } from "./harness.mjs";

const args = process.argv.slice(2);
const xpi_at = args.indexOf("--xpi");
if (xpi_at < 0 || !args[xpi_at + 1]) throw new Error("--xpi <path> is needed: the startup time is read from the helper add-on");
const xpi_path = resolve(args[xpi_at + 1]);
const app = args.find((arg, at) => !arg.startsWith("--") && at !== xpi_at + 1) ?? "thunderbird";
const measure_dir = resolve(process.env.MEASURE_DIR ?? "/tmp/desertbird-measure");
const binaries = { thunderbird: join(measure_dir, "thunderbird-153.7.0esr", "thunderbird", "thunderbird"), betterbird: "/usr/bin/betterbird" };
const e2e_dir = resolve(process.env.E2E_DIR ?? mkdtempSync(join(tmpdir(), "desertbird-concurrent-")));
const out_file = resolve(process.env.E2E_CONCURRENT_FILE ?? join(e2e_dir, "concurrent.json"));
const stagger_ms = 500;
const sleep = (ms) => new Promise((resolve_sleep) => setTimeout(resolve_sleep, ms));

async function run_round(count) {
  const began = Date.now();
  const results = await Promise.all(Array.from({ length: count }, async (_, index) => {
    await sleep(index * stagger_ms);
    const instance = await start_app({ app, app_binary: binaries[app], work_dir: join(e2e_dir, `c${count}_${index}`), kind: "default", xpi_path });
    // Everything the add-on and the helper do on the first Inbox open counts toward the peak.
    await instance.ask("state");
    await sleep(3000);
    const result = { index, startup: instance.startups[0], peak_memory_kb: instance.memory() };
    await instance.stop();
    return result;
  }));
  const sum = (pick) => results.reduce((total, entry) => total + pick(entry), 0);
  return {
    count,
    wall_ms: Date.now() - began,
    instances: results,
    sum_of_peaks_kb: { rss: sum((entry) => entry.peak_memory_kb.app.rss_kb + entry.peak_memory_kb.labwc.rss_kb), pss: sum((entry) => entry.peak_memory_kb.app.pss_kb + entry.peak_memory_kb.labwc.pss_kb) },
  };
}

const rounds = [];
for (const count of [1, 4]) {
  const round = await run_round(count);
  rounds.push(round);
  console.log(`${count} at once: wall ${round.wall_ms} ms, enabled at ${round.instances.map((entry) => entry.startup.enabled_ms).join(", ")} ms, sum of peaks rss ${Math.round(round.sum_of_peaks_kb.rss / 1024)} MB, pss ${Math.round(round.sum_of_peaks_kb.pss / 1024)} MB`);
}
writeFileSync(out_file, `${JSON.stringify({ app, rounds }, null, 2)}\n`);
console.log(`wrote ${out_file}`);
process.exit(0);
