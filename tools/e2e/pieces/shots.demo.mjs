// The demo video of the README and the store listing, on the realistic mail of the `shots` profile kind. Opt-in: it checks nothing but the film itself. wf-recorder films the headless output while the piece types real keys at the pace of a viewer, and the piece writes a caption for each key. tools/e2e/demo_video.mjs burns the captions into the film.
// Run it with DEMO_ROW_LABEL=DG DEMO_BODY_LABEL=S E2E_SHARDS=1 E2E_KINDS=shots E2E_ONLY=demo E2E_KEEP=1 E2E_DIR=<empty dir> just e2e thunderbird, then node tools/e2e/demo_video.mjs <E2E_DIR>/thunderbird/shots/demo/out <output dir>.
// The two labels are read from the stills `*_demo_labels_rows.png` and `*_demo_labels_body.png` the piece writes. The piece checks each against the labels the add-on makes for the target counts below, and refuses a body label that is a whole label, since typing it would pick a link. The session also puts stub link openers first on PATH (see tools/measure/session.mjs), and the piece fails if one was called.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sleep, drawn_since, holds_twice, first_selected } from "../predicates.mjs";
import { OPEN_OWN_PAGES_SCRIPT } from "../seed.mjs";
import { NEWSLETTER_ID } from "../shots_fixture.mjs";
import { start_recording } from "../recorder.mjs";
import { BLOCKED_OPENERS_LOG } from "../../measure/session.mjs";
import { hint_labels } from "../../../src/shared/hint_labels.ts";

export const areas = ["hud", "hints", "cmdline", "message_body", "own_pages"];

const id_of = (name) => `${name}@example.com`;
// The pause after each key, so a viewer sees what the key did.
const BEAT_MS = 1200;
const HOLD_MS = 2500;

// Target counts of the two label screens on the shots fixture, read from the stills: the mail window (last label HF) and the newsletter (last label SH). The labels are a pure function of the count, so a changed layout shows as a label that is gone.
const ROW_TARGETS = 49;
const BODY_TARGETS = 15;

function require_label(name, label, count, { whole }) {
  const labels = hint_labels(count);
  const fits = whole ? labels.includes(label.toLowerCase()) : labels.some((shown) => shown.startsWith(label.toLowerCase()) && shown !== label.toLowerCase());
  if (!label || !fits) throw new Error(`${name}=${label} is ${whole ? "not one of" : "not a strict prefix of"} the ${count} labels the screen shows (${labels.join(" ")})`);
}

async function run_demo(instance, ctx) {
  const { report, show_folder, wait_for_state, wait_pixels, open_command_line, close_command_line, close_compose, key_and_state } = ctx;
  const app = instance.app;
  const strip_region = "0,0 1280x720";
  const work_dir = dirname(instance.out_dir);
  const video_file = join(instance.out_dir, "demo_raw.mp4");
  const row_label = process.env.DEMO_ROW_LABEL;
  const body_label = process.env.DEMO_BODY_LABEL;
  // Before anything starts: a wrong label must not cost a run.
  require_label("DEMO_ROW_LABEL", row_label ?? "", ROW_TARGETS, { whole: true });
  require_label("DEMO_BODY_LABEL", body_label ?? "", BODY_TARGETS, { whole: false });
  const captions = [];
  let recording = null;
  const caption = (text) => captions.push({ at_ms: recording ? Date.now() - recording.started_at : 0, text });
  // One key (or chord) with its caption, then the beat. A dead recorder fails the piece at the next key.
  const key = async (label, args, beat_ms = BEAT_MS) => {
    recording?.assert_alive();
    caption(label);
    await instance.press(args);
    await sleep(beat_ms);
  };
  // g e puts the focus back in the thread list. Two presses: typed as one chunk, the e can reach the app before the g prefix and fetch mail.
  const focus_list = async () => {
    recording?.assert_alive();
    caption("g e");
    await instance.press(["g"]);
    await instance.press(["e"]);
    await sleep(1500);
  };
  const escape = () => key("Esc", ["-k", "Escape"]);
  const selected_is = (name) => (state) => state.selected.some((message) => message.header_id === id_of(name));
  // The key, then the wait for what it did, then the beat.
  const key_until = async (label, args, wait, beat_ms = BEAT_MS) => {
    recording?.assert_alive();
    caption(label);
    await key_and_state(instance, args, wait);
    await sleep(beat_ms);
  };
  const to_row = (name, label, args) => key_until(label, args, { what: `${name} to be selected`, until: selected_is(name), timeout_ms: 15000 });
  // For a row whose id the piece does not name (a thread row): the key, then the wait for another message to be selected.
  const move_off_selection = async (label, args) => {
    const before = first_selected(await instance.ask("state"));
    await key_until(label, args, { what: "another row to be selected", until: (state) => first_selected(state) !== before, timeout_ms: 15000 });
  };
  const has_tab = (test) => (state) => state.windows.some((window) => window.type === "normal" && window.tabs.some(test));
  const hint_screen = async (name, still_name, count_of_what) => {
    const before = await wait_pixels(instance, `the window to hold still before the ${name} hints`, `${app}_demo_${name}_before`, strip_region, holds_twice(), { timeout_ms: 5000 });
    caption("f");
    await instance.press(["f"]);
    await wait_pixels(instance, `the ${name} hint labels`, `${app}_demo_${name}_hints`, strip_region, drawn_since(before), { timeout_ms: 5000 });
    await sleep(HOLD_MS);
    report.notes.push(`hint labels ${count_of_what}: ${await instance.shot(`${app}_demo_labels_${still_name}`)}`);
    return before;
  };

  await show_folder(instance, "/Inbox");
  await sleep(1500);
  await instance.press(["-k", "F6"]);
  if ((await instance.ask("state")).mail_tab?.message_pane_visible) { await instance.press(["w"]); await instance.press(["m"]); }
  await sleep(1500);
  await instance.press(["g"]);
  await instance.press(["g"]);
  await sleep(1500);

  const runtime_dir = join(work_dir, "runtime");
  const socket = readdirSync(runtime_dir).find((entry) => /^wayland-\d+$/.test(entry));
  recording = await start_recording({
    // -D films at a steady rate. With damage-driven frames a still screen gives wf-recorder no event to notice the stop on, and it hangs after SIGINT.
    args: ["-f", video_file, "-c", "libx264", "-D", "-r", "25", "-x", "yuv420p", "-p", "preset=veryfast", "-p", "crf=20"],
    env: { PATH: process.env.PATH, XDG_RUNTIME_DIR: runtime_dir, WAYLAND_DISPLAY: socket },
    log_file: join(instance.out_dir, "wf_recorder.log"),
    adopt_group: instance.adopt_group,
  });
  let completed = false;
  try {
    await sleep(2500);
    caption("");
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

    // f labels the window, and the row label picks the newsletter.
    await hint_screen("rows", "rows", "of the mail window");
    caption(row_label);
    for (const letter of row_label) { recording.assert_alive(); await instance.press([letter]); await sleep(700); }
    await wait_for_state(instance, { what: "the newsletter row to be selected by its label", until: selected_is(NEWSLETTER_ID), timeout_ms: 15000 });
    await sleep(HOLD_MS);

    // The command line with completion.
    caption(":");
    await open_command_line(instance, [":"], { attempts: 3 });
    await sleep(BEAT_MS);
    for (const letter of "fil") await key(letter, [letter], 800);
    await sleep(HOLD_MS);
    caption("Esc");
    await close_command_line(instance);
    await sleep(BEAT_MS);

    // Enter opens the selected message in a tab. f there labels the links of the body.
    await key_until("Enter", ["-k", "Return"], { what: "a message tab to open", until: has_tab((tab) => tab.type === "messageDisplay"), timeout_ms: 15000 }, 4000);
    await hint_screen("body", "body", "of the message");
    caption(body_label);
    for (const letter of body_label) { recording.assert_alive(); await instance.press([letter]); await sleep(700); }
    await sleep(HOLD_MS);
    // A whole label would have picked a link and ended the labels, so the labels still showing proves the prefix.
    const narrowed = await instance.shot_region(`${app}_demo_body_narrowed`, strip_region, "ppm");
    report.notes.push(`body labels after ${body_label}: ${narrowed}`);
    await escape();
    await escape();
    await key_until("q", ["q"], { what: "the message tab to close", until: (state) => !has_tab((tab) => tab.type === "messageDisplay")(state), timeout_ms: 15000 });
    await focus_list();

    // a archives the selected message: two k from the newsletter reach the invoice.
    await to_row("standup-1", "k", ["k"]);
    await to_row("invoice-1", "k", ["k"]);
    await key_until("a", ["a"], { what: "the invoice to leave the Inbox", until: (state) => !state.listed.includes(id_of("invoice-1")), timeout_ms: 15000 }, 2500);

    // r replies. A reply opens in INSERT, Escape gives NORMAL and i gives INSERT again.
    // After the archive the standup is selected. Three k reach the newsletter's thread, the lunch and the roadmap.
    for (let step = 0; step < 2; step++) await move_off_selection("k", ["k"]);
    await to_row("roadmap-1", "k", ["k"]);
    await key_until("r", ["r"], { what: "a compose window with the reply", until: (state) => state.windows.some((window) => window.type === "messageCompose" && window.tabs.some((tab) => tab.subject && (tab.body ?? "").includes("agenda"))), timeout_ms: 15000 }, 3000);
    // labwc's own Super+A maximizes the compose window, as a user's window manager would.
    await instance.press(["-M", "logo", "a", "-m", "logo"]);
    await sleep(1500);
    await key("Esc", ["-k", "Escape"], HOLD_MS);
    await key("i", ["i"], HOLD_MS + 1000);
    await key("Esc", ["-k", "Escape"], HOLD_MS);
    await close_compose(instance);
    await focus_list();

    // , h opens the help page in a tab.
    recording.assert_alive();
    caption(", h");
    await instance.press([","]);
    await key_and_state(instance, ["h"], { what: "the help tab to open", until: has_tab((tab) => /help/i.test(tab.title ?? "")), timeout_ms: 15000 });
    await sleep(HOLD_MS + 1500);
    caption("");
    await sleep(500);
    completed = true;
  } finally {
    // A stop failure is the piece's error only when the run itself went well.
    const stop_error = await recording.stop().then(() => null, (error) => error);
    writeFileSync(join(instance.out_dir, "demo_captions.json"), JSON.stringify(captions, null, 1));
    report.notes.push(`demo film ${video_file}, captions ${join(instance.out_dir, "demo_captions.json")}`);
    const log = join(work_dir, BLOCKED_OPENERS_LOG);
    const opened = existsSync(log) ? readFileSync(log, "utf8").trim() : "";
    if (opened) throw new Error(`a link opener was called, the stub caught it: ${opened}`);
    if (stop_error && completed) throw stop_error;
  }
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
