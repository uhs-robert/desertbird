// One running app in an invisible labwc session: keys by wtype, screenshots by grim, state read back from the mbox files and from a result sink.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { start_session } from "../measure/session.mjs";
import { build_profile, install_xpi } from "./profile.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function start_app({ app, app_binary, work_dir, kind = "default", xpi_path = null, startup_ms = Number(process.env.E2E_STARTUP_MS ?? 30000) }) {
  mkdirSync(work_dir, { recursive: true });
  const { profile_dir, folder_dir } = build_profile(join(work_dir, "profile"), { kind });
  if (xpi_path) install_xpi(profile_dir, xpi_path);
  const out_dir = join(work_dir, "out");
  mkdirSync(out_dir, { recursive: true });
  const session = await start_session(work_dir);
  let app_exit = null;
  let sink = null;
  try {
    // The sink takes JSON a helper add-on posts to http://127.0.0.1:<sink_port>/<name>. read_state(name) returns the last one.
    sink = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        writeFileSync(join(out_dir, `state_${request.url.slice(1)}.json`), Buffer.concat(chunks));
        response.end("{}");
      });
    });
    await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
    session.spawn_app([app_binary, "-profile", profile_dir, "-no-remote"], "app.log").on("exit", (code, signal) => { app_exit = { code, signal }; });
    await sleep(startup_ms);
  } catch (error) {
    session.stop();
    throw error;
  }

  return {
    app,
    profile_dir,
    out_dir,
    sink_port: sink.address().port,
    exited: () => app_exit,
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
