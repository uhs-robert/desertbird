// One running app in an invisible labwc session: keys by wtype, screenshots by grim, state read back from the mbox files and from a result sink.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start_session } from "../measure/session.mjs";
import { build_profile, install_xpi } from "./profile.mjs";

const helper_dir = join(dirname(fileURLToPath(import.meta.url)), "helper");

// Zips the helper add-on with the sink address written into config.js, and installs it beside DesertBird.
function install_helper(work_dir, profile_dir, sink_port) {
  const stage = join(work_dir, "helper_stage");
  rmSync(stage, { recursive: true, force: true });
  cpSync(helper_dir, stage, { recursive: true });
  writeFileSync(join(stage, "config.js"), `const SINK_URL = "http://127.0.0.1:${sink_port}";\n`);
  const xpi = join(work_dir, "helper.xpi");
  rmSync(xpi, { force: true });
  execFileSync("zip", ["-qr", xpi, "."], { cwd: stage });
  install_xpi(profile_dir, xpi);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function start_app({ app, app_binary, work_dir, kind = "default", xpi_path = null, startup_ms = Number(process.env.E2E_STARTUP_MS ?? 30000) }) {
  mkdirSync(work_dir, { recursive: true });
  const { profile_dir, folder_dir } = build_profile(join(work_dir, "profile"), { kind });
  if (xpi_path) install_xpi(profile_dir, xpi_path);
  const out_dir = join(work_dir, "out");
  // A reply left by an earlier run in the same directory carries a seq this run reuses, so the directory starts empty.
  rmSync(out_dir, { recursive: true, force: true });
  mkdirSync(out_dir, { recursive: true });
  const session = await start_session(work_dir);
  let app_exit = null;
  let sink = null;
  let pending = null;
  let seq = 0;
  try {
    // The sink takes JSON the helper add-on posts to http://127.0.0.1:<sink_port>/<name>. read_state(name) returns the last one.
    // The helper also polls GET /poll for the next command, which ask() queues.
    sink = http.createServer((request, response) => {
      if (request.method === "GET") {
        response.end(JSON.stringify(pending ?? { name: null, seq: -1 }));
        pending = null;
        return;
      }
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        writeFileSync(join(out_dir, `state_${request.url.slice(1)}.json`), Buffer.concat(chunks));
        response.end("{}");
      });
    });
    await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
    // The app finds add-ons in the profile only at startup, so the helper goes in before the app starts.
    if (xpi_path) install_helper(work_dir, profile_dir, sink.address().port);
    session.spawn_app([app_binary, "-profile", profile_dir, "-no-remote"], "app.log").on("exit", (code, signal) => { app_exit = { code, signal }; });
    await sleep(startup_ms);
  } catch (error) {
    sink?.close();
    session.stop();
    throw error;
  }

  return {
    app,
    profile_dir,
    out_dir,
    sink_port: sink.address().port,
    // Queues a command for the helper add-on ("state" or "reload_desertbird") and returns its reply.
    ask: async (name, timeout_ms = 20000) => {
      const wanted = ++seq;
      pending = { name, seq: wanted };
      for (let waited = 0; waited < timeout_ms; waited += 100) {
        const reply = existsSync(join(out_dir, "state_state.json")) ? JSON.parse(readFileSync(join(out_dir, "state_state.json"), "utf8")) : null;
        if (reply?.seq === wanted) return reply;
        await sleep(100);
      }
      throw new Error(`the helper add-on did not answer ${name}`);
    },
    exited: () => app_exit,
    // The app log. The headless session has no notification service, so libnotify logs one warning on the first notification the app tries to show.
    app_log: () => (existsSync(join(work_dir, "app.log")) ? readFileSync(join(work_dir, "app.log"), "utf8") : ""),
    // A bare Shift first, so the compositor and the app agree on the modifier state before the real keys.
    settle: () => session.press(["-k", "Shift_L"]),
    // wtype arguments, for example ["j"] or ["-M", "shift", "g", "-m", "shift"]. Each call settles first.
    press: async (args) => { await session.press(["-k", "Shift_L"]); await session.press(args); },
    shot: async (name) => { const path = join(out_dir, `${name}.png`); await session.shot(path); return path; },
    read_state: (name) => { const path = join(out_dir, `state_${name}.json`); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; },
    // Message-ID of every message in a Local Folders mbox, so a test sees where x and d d moved mail.
    folder_message_ids: (folder) => { const path = join(folder_dir, folder); return existsSync(path) ? [...readFileSync(path, "utf8").matchAll(/^Message-ID: <(.+?)>$/gm)].map((match) => match[1]) : []; },
    stop: async () => {
      sink.close();
      session.stop();
      await sleep(3500);
    },
  };
}
