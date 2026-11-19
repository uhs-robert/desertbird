// One running app in an invisible labwc session: keys by wtype, screenshots by grim, state read back from the mbox files and from a result sink.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start_session } from "../measure/session.mjs";
import { build_profile, install_xpi } from "./profile.mjs";
import { start_memory_sampler } from "./timings.mjs";

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
  let app_child = null;
  let started_at = 0;
  let first_poll_ms = null;
  let first_answer_ms = null;
  let enabled_ms = null;
  const startups = [];
  const helper_ask = async (name, timeout_ms = 20000, args = null) => {
    const wanted = ++seq;
    pending = { name, seq: wanted, args };
    for (let waited = 0; waited < timeout_ms; waited += 100) {
      const reply = existsSync(join(out_dir, "state_state.json")) ? JSON.parse(readFileSync(join(out_dir, "state_state.json"), "utf8")) : null;
      if (reply?.seq === wanted) return reply;
      await sleep(100);
    }
    throw new Error(`the helper add-on did not answer ${name}`);
  };
  const start_child_app = () => {
    app_exit = null;
    started_at = Date.now();
    first_poll_ms = null;
    first_answer_ms = null;
    enabled_ms = null;
    app_child = session.spawn_app([app_binary, "-profile", profile_dir, "-no-remote"], "app.log");
    app_child.on("exit", (code, signal) => { app_exit = { code, signal }; });
  };
  // The helper add-on answers "state" before DesertBird has its keys live, so the ready signal has two steps under the one ceiling `startup_ms`.
  // First it asks for "state" with seq 0 (ask() counts from 1) until one reply shows DesertBird enabled and a mail tab.
  // Then a key probe proves the keys are live: `t m` flips the message pane and the helper sees it. That is the one effect of a key the helper can read without a test hook in src/.
  // Without the helper add-on there is nothing to ask, so that start keeps the fixed wait.
  const wait_startup = async () => {
    if (!xpi_path) {
      await sleep(startup_ms);
      startups.push({ ceiling_ms: startup_ms, first_poll_ms: null, first_answer_ms: null, mail_tab_ms: null, enabled_ms: null, keys_live_ms: null });
      return;
    }
    const state_file = join(out_dir, "state_state.json");
    // A reply file left by the run before a restart could carry seq 0 too.
    rmSync(state_file, { force: true });
    const ask_state = () => { pending = { name: "state", seq: 0, args: null }; };
    const elapsed = () => Date.now() - started_at;
    let last = null;
    const fail = (stage) => new Error(`${app} was not ready within E2E_STARTUP_MS (${startup_ms} ms): ${stage}. Last helper reply: ${last ? JSON.stringify({ desertbird_enabled: last.desertbird_enabled, mail_tab: last.mail_tab?.id ?? null }) : "none"}. App exit: ${JSON.stringify(app_exit)}. Log: ${join(work_dir, "app.log")}`);
    const check_alive = (stage) => {
      if (app_exit !== null) throw fail(`the app exited ${stage}`);
      if (elapsed() > startup_ms) throw fail(stage);
    };
    ask_state();
    let mail_tab_ms = null;
    while (enabled_ms === null) {
      check_alive("the helper add-on never showed DesertBird enabled with a mail tab");
      const reply = existsSync(state_file) ? JSON.parse(readFileSync(state_file, "utf8")) : null;
      if (reply?.seq === 0) {
        last = reply;
        first_answer_ms ??= elapsed();
        if (reply.mail_tab) mail_tab_ms ??= elapsed();
        // Both conditions from the same reply, so a mail tab that closed again does not pair with an older enabled flag.
        if (reply.desertbird_enabled === true && reply.mail_tab) enabled_ms = elapsed();
        else { rmSync(state_file, { force: true }); ask_state(); }
      }
      if (enabled_ms === null) await sleep(100);
    }
    const pane_visible = async () => (await helper_ask("state", 3000).catch(() => null))?.mail_tab?.message_pane_visible ?? null;
    // Escape first, so a `t` that landed alone does not pair with the `t` of the next try.
    const press_probe = async () => {
      for (const key of ["Escape", "t", "m"]) { await session.press(["-k", "Shift_L"]); await session.press(["-k", key]); }
    };
    const pane_start = await pane_visible();
    if (pane_start === null) throw fail("the helper did not report the message pane");
    // A key pressed before the window has painted and taken focus is dropped, so the probe is pressed again until the pane flips.
    // A slow key can land after a later press, so the pane is only trusted once it has held one value for QUIET_MS with no press in between. Each press flips it, so a press goes out only while the pane is flipped and quiet, and the start ends when it is back and quiet.
    const QUIET_MS = 1500;
    let keys_live_ms = null;
    let value = pane_start;
    let changed_at = 0;
    let pressed_at = 0;
    for (;;) {
      check_alive(keys_live_ms === null ? "the key probe `t m` never flipped the message pane, so the keys are not live" : "the key probe could not flip the message pane back");
      const now = Date.now();
      const quiet = now - Math.max(changed_at, pressed_at) >= QUIET_MS;
      if (value === pane_start && keys_live_ms !== null && quiet) break;
      if (quiet && (keys_live_ms === null || value !== pane_start)) {
        await press_probe();
        pressed_at = Date.now();
      }
      const seen = await pane_visible();
      if (seen !== null && seen !== value) {
        value = seen;
        changed_at = Date.now();
        keys_live_ms ??= elapsed();
      }
      await sleep(100);
    }
    startups.push({ ceiling_ms: startup_ms, first_poll_ms, first_answer_ms, mail_tab_ms, enabled_ms, keys_live_ms });
    console.log(`startup: helper polled at ${first_poll_ms} ms, first answer at ${first_answer_ms} ms, mail tab at ${mail_tab_ms} ms, DesertBird enabled with a mail tab at ${enabled_ms} ms, keys live at ${keys_live_ms} ms, ceiling ${startup_ms} ms`);
  };
  let sampler = null;
  try {
    // The sink takes JSON the helper add-on posts to http://127.0.0.1:<sink_port>/<name>. read_state(name) returns the last one.
    // The helper also polls GET /poll for the next command, which ask() queues.
    sink = http.createServer((request, response) => {
      if (request.method === "GET") {
        first_poll_ms ??= Date.now() - started_at;
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
    start_child_app();
    sampler = start_memory_sampler(() => ({ app: app_child.pid, labwc: session.groups[0] }));
    await wait_startup();
  } catch (error) {
    sampler?.stop();
    sink?.close();
    session.stop();
    // session.stop() sends the kill from an unref'd timer that dies with node, so a hung app outlives the run unless the timer gets its time, as stop() gives it.
    await sleep(3500);
    throw error;
  }

  return {
    app,
    profile_dir,
    out_dir,
    sink_port: sink.address().port,
    // Queues a command for the helper add-on ("state", "select_tab" and so on) and returns its reply.
    ask: helper_ask,
    // Startup times of every start of this app (one more per restart) and the peak memory seen so far, in kB.
    startups,
    memory: () => sampler.peaks,
    exited: () => app_exit,
    // Process id of the running app, so a check can prove a restart replaced the process.
    app_pid: () => app_child.pid,
    // Quits the app and starts it again on the same profile, which is the only real restart of DesertBird: management.setEnabled is refused for an add-on in the profile folder.
    restart: async () => {
      try { process.kill(-app_child.pid, "SIGTERM"); } catch {}
      for (let waited = 0; app_exit === null && waited < 15000; waited += 100) await sleep(100);
      if (app_exit === null) try { process.kill(-app_child.pid, "SIGKILL"); } catch {}
      for (let waited = 0; app_exit === null && waited < 5000; waited += 100) await sleep(100);
      if (app_exit === null) throw new Error("the old app did not exit after SIGKILL");
      start_child_app();
      await wait_startup();
    },
    // The app log. The headless session has no notification service, so libnotify logs one warning on the first notification the app tries to show.
    app_log: () => (existsSync(join(work_dir, "app.log")) ? readFileSync(join(work_dir, "app.log"), "utf8") : ""),
    // A bare Shift first, so the compositor and the app agree on the modifier state before the real keys.
    settle: () => session.press(["-k", "Shift_L"]),
    // wtype arguments, for example ["j"] or ["-M", "shift", "g", "-m", "shift"]. Each call settles first.
    press: async (args) => { await session.press(["-k", "Shift_L"]); await session.press(args); },
    shot: async (name) => { const path = join(out_dir, `${name}.png`); await session.shot(path); return path; },
    // A left click at a point of the 1280x720 output. The pointer first goes to the corner, because wlrctl moves it by an offset.
    click: async (x, y) => {
      const pointer = (...args) => execFileSync("wlrctl", ["pointer", ...args], { env: session.env });
      pointer("move", "-3000", "-3000");
      pointer("move", String(x), String(y));
      // The app needs the pointer motion before the button, or a press right after the move can miss the row under it.
      await new Promise((done) => setTimeout(done, 300));
      pointer("click", "left");
    },
    // A screenshot of a region, "x,y WxH" as grim reads it. A region that leaves out the scrollbar draws the same twice when nothing in it changed.
    shot_region: async (name, region, format = "png") => { const path = join(out_dir, `${name}.${format}`); execFileSync("grim", ["-t", format, "-g", region, path], { env: session.env }); return path; },
    read_state: (name) => { const path = join(out_dir, `state_${name}.json`); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; },
    // Message-ID of every message in a Local Folders mbox, so a test sees where x and d d moved mail.
    folder_message_ids: (folder) => { const path = join(folder_dir, folder); return existsSync(path) ? [...readFileSync(path, "utf8").matchAll(/^Message-ID: <(.+?)>$/gm)].map((match) => match[1]) : []; },
    stop: async () => {
      sampler.stop();
      sink.close();
      session.stop();
      await sleep(3500);
    },
  };
}
