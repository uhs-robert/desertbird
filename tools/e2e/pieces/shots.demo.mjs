// The demo video of the README and the store listing, on the realistic mail of the `shots` profile kind. Opt-in: it checks nothing. wf-recorder films the headless output while the piece types at the pace of a viewer, and the piece writes the key captions that tools/e2e/demo_video.mjs burns into the film. Run it with DEMO_ROW_LABEL=DG DEMO_BODY_LABEL=S E2E_SHARDS=1 E2E_KINDS=shots E2E_ONLY=demo E2E_KEEP=1 E2E_DIR=<empty dir> just e2e thunderbird, then node tools/e2e/demo_video.mjs <E2E_DIR>/thunderbird/shots/demo/out <output dir>. The two labels are the hint labels of the fixture layout (read from the `labels` stills the piece writes): DG is the newsletter row. The body label stays one letter, because a full link label opens the link in the owner browser.

import { spawn } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sleep, drawn_since, holds_twice } from "../predicates.mjs";
import { OPEN_OWN_PAGES_SCRIPT } from "../seed.mjs";

export const areas = ["hud", "hints", "cmdline", "message_body", "own_pages"];

const id_of = (name) => `${name}@example.com`;
// The pause after each key, so a viewer sees what the key did.
const BEAT_MS = 1200;
const HOLD_MS = 2500;

// wf-recorder in its own process group, so the stop reaches the encoder it forks and nothing outlives the run. SIGINT makes it finish the file.
function start_recording(instance, file) {
  const runtime_dir = join(dirname(instance.out_dir), "runtime");
  const socket = readdirSync(runtime_dir).find((entry) => /^wayland-\d+$/.test(entry));
  const env = { PATH: process.env.PATH, XDG_RUNTIME_DIR: runtime_dir, WAYLAND_DISPLAY: socket };
  const child = spawn("wf-recorder", ["-f", file, "-c", "libx264", "-r", "25", "-x", "yuv420p", "-p", "preset=veryfast", "-p", "crf=20"], { env, detached: true, stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  const started_at = Date.now();
  return {
    started_at,
    stop: async () => {
      try { process.kill(-child.pid, "SIGINT"); } catch {}
      const timeout = sleep(20000).then(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
      await Promise.race([exited, timeout]);
    },
  };
}

async function run_demo(instance, ctx) {
  const { report, show_folder, wait_for_state, wait_pixels, open_command_line, close_command_line, close_compose, key_and_state } = ctx;
  const app = instance.app;
  const strip_region = "0,0 1280x720";
  const video_file = join(instance.out_dir, "demo_raw.mp4");
  const captions = [];
  let recording = null;
  const caption = (text) => captions.push({ at_ms: recording ? Date.now() - recording.started_at : 0, text });
  // One key (or chord) with its caption, then the beat.
  const key = async (label, args, beat_ms = BEAT_MS) => {
    caption(label);
    await instance.press(args);
    await sleep(beat_ms);
  };
  const escape = () => key("Esc", ["-k", "Escape"]);
  const select = async (name) => {
    await instance.ask(`select:${id_of(name)}`, 30000);
    await wait_for_state(instance, { what: `${name} to be selected`, until: (state) => state.selected.some((message) => message.header_id === id_of(name)), timeout_ms: 15000 });
    await sleep(1500);
  };
  const focus_list = async () => { await instance.press(["g"]); await instance.press(["e"]); await sleep(1500); };
  const note = (text) => caption(text);

  await show_folder(instance, "/Inbox");
  await sleep(1500);
  await instance.press(["-k", "F6"]);
  if ((await instance.ask("state")).mail_tab?.message_pane_visible) { await instance.press(["w"]); await instance.press(["m"]); }
  await sleep(1500);
  await instance.press(["g"]);
  await instance.press(["g"]);
  await sleep(1500);

  recording = start_recording(instance, video_file);
  try {
    await sleep(2500);
    note("");
    await sleep(500);

    // j and k through the thread list.
    for (const letter of ["j", "j", "j", "k", "j", "j", "k"]) await key(letter, [letter]);
    await sleep(500);

    // g and a pause: the which-key panel.
    const before_panel = await wait_pixels(instance, "the window to hold still before the panel", `${app}_demo_panel_before`, strip_region, holds_twice(), { timeout_ms: 5000 });
    caption("g");
    await instance.press(["g"]);
    await wait_pixels(instance, "the which-key panel", `${app}_demo_panel`, strip_region, drawn_since(before_panel), { timeout_ms: 5000 });
    await sleep(HOLD_MS + 1000);
    await escape();

    // f labels the window. HINT_ROW_LABEL picks a row.
    const before_hints = await wait_pixels(instance, "the window to hold still before the hints", `${app}_demo_hints_before`, strip_region, holds_twice(), { timeout_ms: 5000 });
    caption("f");
    await instance.press(["f"]);
    await wait_pixels(instance, "the hint labels", `${app}_demo_hints`, strip_region, drawn_since(before_hints), { timeout_ms: 5000 });
    await sleep(HOLD_MS + 1000);
    await shot_for_labels(instance, report);
    const row_label = process.env.DEMO_ROW_LABEL;
    if (row_label) {
      for (const letter of row_label) await key(letter, [letter], 700);
      await sleep(HOLD_MS);
    } else {
      await escape();
    }

    // The command line with completion.
    caption(":");
    await open_command_line(instance, [":"], { attempts: 3 });
    await sleep(BEAT_MS);
    for (const letter of "fil") await key(letter, [letter], 800);
    await sleep(HOLD_MS);
    caption("Esc");
    await close_command_line(instance);
    await sleep(BEAT_MS);

    // f in a message tab labels the links of the body.
    await select("trailhead-weekly-47");
    caption("Enter: open the message");
    await instance.ask("open_message_tab");
    await sleep(4000);
    const before_body = await wait_pixels(instance, "the window to hold still before the body hints", `${app}_demo_body_before`, strip_region, holds_twice(), { timeout_ms: 5000 });
    caption("f");
    await instance.press(["f"]);
    await wait_pixels(instance, "the labels over the message", `${app}_demo_body_hints`, strip_region, drawn_since(before_body), { timeout_ms: 5000 });
    await sleep(HOLD_MS);
    await shot_for_labels(instance, report, "body");
    const body_label = process.env.DEMO_BODY_LABEL;
    if (body_label) {
      for (const letter of body_label) await key(letter, [letter], 700);
      await sleep(HOLD_MS);
    } else {
      await escape();
    }
    await escape();
    await key("q", ["q"]);
    await focus_list();

    // a archives the selected message.
    await select("invoice-1");
    await sleep(500);
    await key("a", ["a"], 2500);

    // r replies. The status bar label reads NORMAL, then INSERT.
    await select("roadmap-1");
    caption("r");
    await key_and_state(instance, ["r"], { what: "a compose window with the reply", until: (state) => state.windows.some((window) => window.type === "messageCompose" && window.tabs.some((tab) => tab.subject && (tab.body ?? "").includes("agenda"))), timeout_ms: 15000 });
    await sleep(3000);
    // labwc's own Super+A maximizes the compose window, as a user's window manager would.
    await instance.press(["-M", "logo", "a", "-m", "logo"]);
    await sleep(1500);
    await key("Esc", ["-k", "Escape"], HOLD_MS);
    await key("i", ["i"], HOLD_MS + 1000);
    await key("Esc", ["-k", "Escape"], HOLD_MS);
    await close_compose(instance);
    await focus_list();

    // , h opens the help page.
    caption(", h");
    await instance.ask("open_own_page", 20000, { page: "help" });
    await sleep(HOLD_MS + 1500);
    note("");
    await sleep(500);
  } finally {
    await recording.stop();
    writeFileSync(join(instance.out_dir, "demo_captions.json"), JSON.stringify(captions, null, 1));
    report.notes.push(`demo film ${video_file}, captions ${join(instance.out_dir, "demo_captions.json")}`);
  }
}

// A still while the labels show, so the label to type can be read.
async function shot_for_labels(instance, report, name = "rows") {
  const path = await instance.shot(`${instance.app}_demo_labels_${name}`);
  report.notes.push(`hint labels ${name}: ${path}`);
}

export const piece = {
  kind: "shots",
  section: "demo",
  opt_in: true,
  seeds: {},
  extra_script: OPEN_OWN_PAGES_SCRIPT,
  deadline_s: 400,
  run: (instance, ctx) => run_demo(instance, ctx),
};
