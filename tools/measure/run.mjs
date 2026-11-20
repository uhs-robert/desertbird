// Runs the probe in one app, one fresh profile per job:
//   node tools/measure/run.mjs betterbird <path to the betterbird binary>
//   node tools/measure/run.mjs thunderbird [path to the thunderbird binary]
// The binary path can also come from APP_BINARY. ONLY=job1,job2 runs a subset of the jobs.
// Scratch files go to $MEASURE_DIR (default /tmp/desertbird-measure). The profile, home and display of a job are new and private to it.
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { write_fixtures } from "./fixtures.mjs";
import { start_session } from "./session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.MEASURE_DIR && process.env.MEASURE_DIR !== undefined) throw new Error("MEASURE_DIR is set but empty");
const measure_dir = resolve(process.env.MEASURE_DIR ?? "/tmp/desertbird-measure");
const app = process.argv[2];
const app_binary = process.argv[3] ?? process.env.APP_BINARY ?? (app === "thunderbird" ? join(measure_dir, "thunderbird-153.7.0esr", "thunderbird", "thunderbird") : undefined);
if (!["betterbird", "thunderbird"].includes(app)) throw new Error("usage: node tools/measure/run.mjs betterbird|thunderbird [binary]");
if (!app_binary || !existsSync(app_binary)) throw new Error(`no app binary at ${app_binary} (pass it as the second argument or in APP_BINARY; fetch_thunderbird.sh fetches Thunderbird)`);

// A job is one scenario in a fresh profile. variant changes the manifest, big adds the 10,000-message folder,
// no_identity leaves the account without an identity, host_manifests writes the native host manifests into the job's HOME.
const SCENARIOS = ["env", "api_presence", "rtt", "key_latency", "threads", "query", "focus_targets", "keys_thread", "keys_pane", "keys_tab", "keys_window", "message_pane", "message_process", "window_types", "compose", "overlay", "filter", "tabs_remove", "tabs_remove_only_tab", "zoom"];
const JOBS = [
  ...SCENARIOS.map((name) => ({ name, only: name })),
  { name: "query_large", only: "query_large", big: true },
  { name: "api_presence_minimal", only: "api_presence", variant: "minimal" },
  { name: "overlay_war", only: "overlay", variant: "war" },
  { name: "native_host", only: "native_host", host_manifests: true },
  { name: "reply_no_identity", only: "reply_no_identity", no_identity: true, expect_exit: true },
];

const BASE_PREFS = {
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

// The user-level folders that could hold native host manifests. The system folders cannot be written, so they are not tested.
const HOST_DIRS = {
  probe_mozilla: ".mozilla/native-messaging-hosts",
  probe_thunderbird: ".thunderbird/native-messaging-hosts",
  probe_betterbird: ".betterbird/native-messaging-hosts",
  probe_config_mozilla: ".config/mozilla/native-messaging-hosts",
  probe_config_thunderbird: ".config/thunderbird/native-messaging-hosts",
  probe_config_betterbird: ".config/betterbird/native-messaging-hosts",
};

function write_host_manifests(home) {
  for (const [name, dir] of Object.entries(HOST_DIRS)) {
    const script = join(home, "hosts", `${name}.sh`);
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, `#!/bin/sh\ntouch "${home}/ran_${name}"\n`);
    chmodSync(script, 0o755);
    mkdirSync(join(home, dir), { recursive: true });
    writeFileSync(join(home, dir, `${name}.json`), JSON.stringify({ name, description: "probe host", path: script, type: "stdio", allowed_extensions: ["probe@desertbird.invalid"] }));
  }
}

function variant_manifest(text, variant) {
  const manifest = JSON.parse(text);
  if (variant === "minimal") {
    manifest.permissions = manifest.permissions.filter((permission) => !["messagesTagsList", "menus", "addressBooks"].includes(permission));
    delete manifest.commands;
  }
  if (variant === "war") manifest.web_accessible_resources = ["overlay.html", "overlay.js"];
  return JSON.stringify(manifest, null, 2);
}

async function run_job(job) {
  const run_dir = join(measure_dir, "run", app, job.name);
  rmSync(run_dir, { recursive: true, force: true });
  const profile_dir = join(run_dir, "profile");
  const out_dir = join(run_dir, "out");
  mkdirSync(join(profile_dir, "extensions"), { recursive: true });
  mkdirSync(out_dir, { recursive: true });
  write_fixtures(profile_dir, { big: !!job.big });

  const prefs = { ...BASE_PREFS, "mail.server.server1.directory": join(profile_dir, "Mail", "Local Folders") };
  if (job.no_identity) for (const name of Object.keys(prefs)) if (name.includes("identit")) delete prefs[name];
  writeFileSync(join(profile_dir, "user.js"), Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`).join("\n") + "\n");

  const port = await new Promise((resolve_port) => {
    const probe_server = http.createServer();
    probe_server.listen(0, "127.0.0.1", () => { const { port: found } = probe_server.address(); probe_server.close(() => resolve_port(found)); });
  });
  const build_dir = join(run_dir, "xpi");
  execFileSync("cp", ["-r", join(here, "probe"), build_dir]);
  writeFileSync(join(build_dir, "config.js"), `const CONFIG = ${JSON.stringify({ port, app, only: [job.only], variant: job.variant ?? "default" })};\n`);
  writeFileSync(join(build_dir, "manifest.json"), variant_manifest(readFileSync(join(build_dir, "manifest.json"), "utf8"), job.variant));
  execFileSync("zip", ["-qr", join(profile_dir, "extensions", "probe@desertbird.invalid.xpi"), "."], { cwd: build_dir });

  const session = await start_session(run_dir);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { session.stop(); setTimeout(() => process.exit(130), 3500); });
  let finished = false;
  let app_exited = null;
  try {
    if (job.host_manifests) write_host_manifests(session.home);
    const log_path = join(out_dir, "probe.log");
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
    session.spawn_app([app_binary, "-profile", profile_dir, "-no-remote"], "app.log").on("exit", (code, signal) => { app_exited = { code, signal }; });
    const deadline = Date.now() + 25 * 60 * 1000;
    while (!finished && !app_exited && Date.now() < deadline) await new Promise((resolve_wait) => setTimeout(resolve_wait, 500));
    server.close();
    const markers = existsSync(session.home) ? readdirSync(session.home).filter((entry) => entry.startsWith("ran_")) : [];
    writeFileSync(join(out_dir, "app_exit.json"), JSON.stringify({ finished, app_exited, expected_exit: !!job.expect_exit, host_markers: markers }, null, 2));
  } finally {
    session.stop();
    await new Promise((resolve_wait) => setTimeout(resolve_wait, 3500));
    for (const signal of ["SIGINT", "SIGTERM"]) process.removeAllListeners(signal);
  }
  const status = finished ? "done" : app_exited ? `app exited ${JSON.stringify(app_exited)}` : "timed out";
  console.log(`${job.name}: ${status}`);
  return finished || (job.expect_exit && app_exited);
}

const wanted = process.env.ONLY ? process.env.ONLY.split(",") : JOBS.map((job) => job.name);
for (const name of wanted) if (!JOBS.some((job) => job.name === name)) throw new Error(`unknown job ${name}`);
let all_ok = true;
for (const job of JOBS.filter((candidate) => wanted.includes(candidate.name))) all_ok = (await run_job(job)) && all_ok;
console.log(`results: ${join(measure_dir, "run", app)}/<job>/out`);
process.exit(all_ok ? 0 : 1);
