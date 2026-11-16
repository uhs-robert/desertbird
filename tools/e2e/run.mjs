// End-to-end run in a headless labwc session:
//   node tools/e2e/run.mjs [thunderbird|betterbird]... [--xpi path] [--binary app=path]
// With no --xpi it only proves the setup: each app starts in a fresh profile and one screenshot is taken.
// Scratch files go to $E2E_DIR (default /tmp/desertbird-e2e). Thunderbird comes from tools/measure/fetch_thunderbird.sh. Betterbird is /usr/bin/betterbird.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { start_app } from "./harness.mjs";

const e2e_dir = resolve(process.env.E2E_DIR ?? "/tmp/desertbird-e2e");
const measure_dir = resolve(process.env.MEASURE_DIR ?? "/tmp/desertbird-measure");
const binaries = {
  thunderbird: join(measure_dir, "thunderbird-153.7.0esr", "thunderbird", "thunderbird"),
  betterbird: "/usr/bin/betterbird",
};

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at < 0 ? null : args.splice(at, 2)[1]; };
const xpi_path = option("--xpi");
for (let value; (value = option("--binary")); ) { const [name, path] = value.split("="); binaries[name] = path; }
const apps = args.length ? args : ["thunderbird", "betterbird"];

// Key assertions, for later (they need the xpi built by S4). Each runs in every app, and the reply_no_identity one in its own profile kind.
// - j, k, g g, G and 5j move the selection (read it through view.rows and getSelectedMessages)
// - j skips collapsed children
// - j does not mark messages as junk
// - m, s, a and 1 do nothing
// - typing in the quick filter passes through
// - x archives
// - d d moves the messages to Trash
// - r opens "Re: <subject>"
// - reply_no_identity: no crash, and the refusal shows
// - after runtime.reload(), one j moves one row
// - a screenshot after G
async function run_assertions(_instance) {
  throw new Error("key assertions are not written yet");
}

let all_ok = true;
for (const app of apps) {
  if (!binaries[app] || !existsSync(binaries[app])) throw new Error(`no binary for ${app} at ${binaries[app]}`);
  const kinds = ["default", "reply_no_identity"];
  for (const kind of kinds) {
    const instance = await start_app({ app, app_binary: binaries[app], work_dir: join(e2e_dir, app, kind), kind, xpi_path });
    try {
      if (xpi_path) await run_assertions(instance);
      else {
        const shot = await instance.shot(`${app}_${kind}_start`);
        const exited = instance.exited();
        console.log(`${app} ${kind}: ${exited ? `app exited ${JSON.stringify(exited)}` : "running"}, screenshot ${shot}`);
        all_ok = all_ok && !exited;
      }
    } finally {
      await instance.stop();
    }
  }
}
process.exit(all_ok ? 0 : 1);
