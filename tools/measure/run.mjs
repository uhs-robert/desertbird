// Runs the probe in one app: node tools/measure/run.mjs betterbird|thunderbird
// Scratch files go to $MEASURE_DIR (default /tmp/desertbird-measure). The profile, home and display are new and private to the run.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { write_fixtures } from "./fixtures.mjs";
import { start_session } from "./session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const measure_dir = resolve(process.env.MEASURE_DIR ?? "/tmp/desertbird-measure");
const app = process.argv[2];
const APP_BINARIES = {
  betterbird: "/opt/betterbird/betterbird",
  thunderbird: join(measure_dir, "thunderbird-153.7.0esr", "thunderbird", "thunderbird"),
};
if (!APP_BINARIES[app]) throw new Error("usage: node tools/measure/run.mjs betterbird|thunderbird");
if (!existsSync(APP_BINARIES[app])) throw new Error(`${APP_BINARIES[app]} is missing (run fetch_thunderbird.sh for thunderbird)`);

const run_dir = join(measure_dir, "run", app);
rmSync(run_dir, { recursive: true, force: true });
const profile_dir = join(run_dir, "profile");
const out_dir = join(run_dir, "out");
mkdirSync(join(profile_dir, "extensions"), { recursive: true });
mkdirSync(out_dir, { recursive: true });
write_fixtures(profile_dir);

const prefs = {
  "mail.accountmanager.accounts": "account1",
  "mail.accountmanager.defaultaccount": "account1",
  "mail.accountmanager.localfoldersserver": "server1",
  "mail.account.account1.server": "server1",
  "mail.account.account1.identities": "id1",
  "mail.identity.id1.fullName": "Probe",
  "mail.identity.id1.useremail": "probe@fixture.invalid",
  "mail.identity.id1.valid": true,
  "mail.identity.id1.compose_html": false,
  "mail.server.server1.type": "none",
  "mail.server.server1.hostname": "Local Folders",
  "mail.server.server1.userName": "nobody",
  "mail.server.server1.name": "Local Folders",
  "mail.server.server1.storeContractID": "@mozilla.org/msgstore/berkeleystore;1",
  "mail.server.server1.directory": join(profile_dir, "Mail", "Local Folders"),
  "mailnews.default_view_flags": 1,
  "mailnews.default_sort_type": 18,
  "mailnews.default_sort_order": 1,
  "mail.provider.suppress_dialog_on_startup": true,
  "mail.spotlight.firstRunDone": true,
  "mail.shell.checkDefaultClient": false,
  "mailnews.start_page.enabled": false,
  "app.update.auto": false,
  "app.update.enabled": false,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "extensions.experiments.enabled": true,
  "xpinstall.signatures.required": false,
  "extensions.blocklist.enabled": false,
  "privacy.reduceTimerPrecision": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.enabled": false,
  "network.proxy.type": 0,
  "mail.biff.show_alert": false,
  "mail.chat.enabled": false,
  "mail.rights.version": 1,
  "mail.collect_email_address_outgoing": false,
};
// NO_IDENTITY=1 leaves the account without an identity, to see what compose.beginReply does then.
if (process.env.NO_IDENTITY) for (const name of Object.keys(prefs)) if (name.includes("identit")) delete prefs[name];
writeFileSync(join(profile_dir, "user.js"), Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`).join("\n") + "\n");

const port = await new Promise((resolve_port) => {
  const probe_server = http.createServer();
  probe_server.listen(0, "127.0.0.1", () => { const { port: found } = probe_server.address(); probe_server.close(() => resolve_port(found)); });
});
const build_dir = join(run_dir, "xpi");
execFileSync("cp", ["-r", join(here, "probe"), build_dir]);
writeFileSync(join(build_dir, "config.js"), `const CONFIG = ${JSON.stringify({ port, app, only: process.env.ONLY ? process.env.ONLY.split(",") : null })};\n`);
execFileSync("zip", ["-qr", join(profile_dir, "extensions", "probe@desertbird.invalid.xpi"), "."], { cwd: build_dir });

const session = await start_session(run_dir);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { session.stop(); setTimeout(() => process.exit(130), 3500); });
const log_path = join(out_dir, "probe.log");
let finished = false;
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", async () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    let reply = {};
    try {
      if (request.url === "/press") await session.press(body.args);
      else if (request.url === "/shot") await session.shot(join(out_dir, `${body.name}.png`));
      else if (request.url === "/result") writeFileSync(join(out_dir, `${body.name}.json`), JSON.stringify(body.data, null, 2));
      else if (request.url === "/log") appendFileSync(log_path, `${new Date().toISOString()} ${body}\n`);
      else if (request.url === "/done") finished = true;
    } catch (error) {
      reply = { error: String(error) };
    }
    response.end(JSON.stringify(reply));
  });
});
await new Promise((resolve_listen) => server.listen(port, "127.0.0.1", resolve_listen));

let app_exited = false;
session.spawn_app([APP_BINARIES[app], "-profile", profile_dir, "-no-remote"], "app.log").on("exit", (code, signal) => { app_exited = true; console.log(`the app exited: code ${code}, signal ${signal}`); });
const deadline = Date.now() + 25 * 60 * 1000;
while (!finished && !app_exited && Date.now() < deadline) await new Promise((resolve_wait) => setTimeout(resolve_wait, 1000));
console.log(finished ? `done: results in ${out_dir}` : `timed out: partial results in ${out_dir}`);
server.close();
session.stop();
await new Promise((resolve_wait) => setTimeout(resolve_wait, 3500));
process.exit(finished ? 0 : 1);
