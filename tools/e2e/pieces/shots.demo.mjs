// The demo video of the README and the store listing, on the realistic mail of the `shots` profile kind. Opt-in: it checks nothing but the film itself. wf-recorder films the headless output while the piece types real keys at the pace of a viewer, and the piece writes a caption for each key and a title card for each part. tools/e2e/demo_video.mjs burns them into the film.
// Run it with the DEMO_*_LABEL variables of HINT_TARGETS set, E2E_SHARDS=1 E2E_KINDS=shots E2E_ONLY=demo E2E_KEEP=1 E2E_DIR=<empty dir> just e2e thunderbird, then node tools/e2e/demo_video.mjs <E2E_DIR>/thunderbird/shots/demo/out <output dir> [name].
// Each hint label is read from the still `*_demo_labels_<name>.png` the piece takes when the labels show. A label left unset stops the piece after its still. The session also puts stub link openers first on PATH (see tools/measure/session.mjs), and the piece fails if one was called.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sleep, drawn_since, holds_twice } from "../predicates.mjs";
import { OPEN_OWN_PAGES_SCRIPT } from "../seed.mjs";
import { NEWSLETTER_ID, shots_arrival_files } from "../shots_fixture.mjs";
import { start_recording } from "../recorder.mjs";
import { BLOCKED_OPENERS_LOG } from "../../measure/session.mjs";

export const areas = ["hud", "hints", "cmdline", "message_body", "own_pages"];

const pause = (ms) => sleep(Math.round(ms * PACE));
const id_of = (name) => `${name}@example.com`;
// The pause after a key whose result shows at once, and the hold on a result the viewer must read.
const BEAT_MS = 650;
const HOLD_MS = 1000;
const TITLE_MS = 1800;
// Every pause of the film is stretched by this factor, so a viewer reads the caption and sees the result.
const PACE = 1.8;
const END_CARD_MS = 6000;
// The pace of letters typed in the command line.
const TYPE_MS = 320;
// The hint targets the piece picks, each by the label of an environment variable.
const HINT_TARGETS = { body: "DEMO_UNSUBSCRIBE_LABEL", toolbar: "DEMO_BUTTON_LABEL", theme: "DEMO_THEME_LABEL", border: "DEMO_BORDER_LABEL", save: "DEMO_SAVE_LABEL" };
// Steps up the theme list from the default oasis_moonlight to oasis_mirage, and down the border list from square to chamfer.
const THEME_STEPS_UP = 1;
const BORDER_STEPS_DOWN = 2;

async function run_demo(instance, ctx) {
  const { report, show_folder, wait_for_state, wait_pixels, open_command_line, close_compose } = ctx;
  const app = instance.app;
  const strip_region = "0,0 1280x720";
  const work_dir = dirname(instance.out_dir);
  const video_file = join(instance.out_dir, "demo_raw.mp4");
  for (const variable of Object.values(HINT_TARGETS)) if (process.env[variable] && !/^[a-z]{1,3}$/i.test(process.env[variable])) throw new Error(`${variable}=${process.env[variable]} is not a hint label`);
  const captions = [];
  let recording = null;
  const clock = () => (recording ? Date.now() - recording.started_at : 0);
  const caption = (text) => captions.push({ at_ms: clock(), text });
  const title = async (text) => { captions.push({ at_ms: clock(), title: text }); await sleep(TITLE_MS); };
  const selected_is = (name) => (state) => state.selected.some((message) => message.header_id === id_of(name));
  const unlisted = (name) => (state) => !state.listed.includes(id_of(name));
  // Each letter of a chord as its own press: typed as one chunk, a later letter can reach the app before the prefix.
  const press_each = async (letters) => { for (const letter of letters) await instance.press([letter]); };
  // A key (or chord) with its caption, then the wait for what it did, then the beat. `keys` is letters, or wtype argument lists. A dead recorder fails the piece at the next key.
  const key = async (label, keys, wait = null, beat_ms = BEAT_MS) => {
    recording?.assert_alive();
    if (label !== null) caption(label);
    if (Array.isArray(keys[0])) for (const args of keys) await instance.press(args);
    else await press_each(keys);
    if (wait) await wait_for_state(instance, { timeout_ms: 15000, ...wait });
    await pause(beat_ms);
  };
  const to = (name) => ({ what: `${name} to be selected`, until: selected_is(name) });
  const gone = (name) => ({ what: `${name} to leave the list`, until: unlisted(name) });
  const has_tab = (test) => (state) => state.windows.some((window) => window.type === "normal" && window.tabs.some(test));
  const compose_open = (state) => state.windows.some((window) => window.type === "messageCompose");
  const type_letters = async (text) => { for (const letter of text) { recording.assert_alive(); await instance.press(letter === " " ? ["-k", "space"] : [letter]); await sleep(TYPE_MS); } };
  // f, the hold on the labels, a still of them, and the label of `name` typed. Returns the label.
  const hint_pick = async (name, label_caption, hold_ms) => {
    recording.assert_alive();
    const before = await wait_pixels(instance, `the window to hold still before the ${name} hints`, `${app}_demo_${name}_before`, strip_region, holds_twice(), { timeout_ms: 5000 });
    if (label_caption !== null) caption(label_caption);
    await instance.press(["f"]);
    await wait_pixels(instance, `the ${name} hint labels`, `${app}_demo_${name}_hints`, strip_region, drawn_since(before), { timeout_ms: 5000 });
    await pause(hold_ms);
    const still = await instance.shot(`${app}_demo_labels_${name}`);
    report.notes.push(`hint labels for ${name}: ${still}`);
    const label = process.env[HINT_TARGETS[name]]?.toLowerCase();
    if (!label) throw new Error(`set ${HINT_TARGETS[name]} to the label read from ${still}`);
    await press_each(label.split(""));
    return label;
  };

  // Shown once so the app builds the summary of /Receipts, or `u` after a move into it finds no message to bring back.
  await show_folder(instance, "/Receipts");
  await show_folder(instance, "/Inbox");
  await sleep(1500);
  await instance.press(["-k", "F6"]);
  if ((await instance.ask("state")).mail_tab?.message_pane_visible) await press_each(["w", "m"]);
  await sleep(1500);
  await press_each(["g", "g"]);
  await wait_for_state(instance, { what: "the first row to be selected", until: selected_is("roadmap-1"), timeout_ms: 15000 });
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
    // 1. Inbox blitz: read, archive, star, junk, delete and a batch archive empty most of the Inbox.
    await title("Inbox zero. No mouse.");
    await key("w m  Show the message", ["w", "m"], { what: "the message pane to show", until: (state) => state.mail_tab?.message_pane_visible === true }, HOLD_MS);
    await key("j  Next message", ["j"], to("lunch-1"));
    await key("j  Next message", ["j"], to("order-1"));
    await key("a  Archive", ["a"], gone("order-1"), HOLD_MS);
    await key("m s  Star", ["m", "s"], { what: "the invoice to be starred", until: (state) => state.flags[id_of("invoice-1")]?.flagged === true }, HOLD_MS);
    await key("j  Next message", ["j"], to("prize-1"));
    await key("m j  Mark as junk", ["m", "j"], { what: "the prize mail to be junk", until: (state) => state.flags[id_of("prize-1")]?.junk === true }, HOLD_MS);
    await key("d d  Delete", ["d", "d"], gone("prize-1"), HOLD_MS);
    await key("v  Select many", ["v"]);
    for (const name of ["cactus-3", "cactus-2", "cactus-1"]) await key("j  Select more", ["j"], { what: `${name} to join the selection`, until: selected_is(name) }, 350);
    await key("a  Archive all", ["a"], gone("cactus-1"), HOLD_MS + 300);

    // 2. Jump or walk: g t jumps to the Trash, the folder pane walks back to the Inbox. New mail arrives meanwhile.
    await title("Jump or walk");
    recording.assert_alive();
    const before_panel = await wait_pixels(instance, "the window to hold still before the panel", `${app}_demo_panel_before`, strip_region, holds_twice(), { timeout_ms: 3000 });
    caption("g  Go to...");
    await instance.press(["g"]);
    await wait_pixels(instance, "the which-key panel", `${app}_demo_panel`, strip_region, drawn_since(before_panel), { timeout_ms: 5000 });
    await pause(1100);
    await key("g t  Go to Trash", ["t"], { what: "the Trash to show the deleted mail", until: (state) => state.mail_tab?.folder === "/Trash" && state.listed.includes(id_of("prize-1")) }, 200);
    await instance.ask("import_mail", 30000, { path: "/Inbox", messages: shots_arrival_files() });
    await pause(HOLD_MS);
    await key("H  Folder pane", ["H"]);
    await key("g g  Top", ["g", "g"]);
    await key("j  Down to Inbox", ["j"], { what: "the Inbox to show", until: (state) => state.mail_tab?.folder === "/Inbox" }, HOLD_MS);

    // 3. Find anything: filters and sorts reshape the list.
    await title("Find anything");
    await key("L  To the list", ["L"]);
    await key("b u  Only unread", ["b", "u"], { what: "the read mail to hide", until: unlisted("lunch-1") }, HOLD_MS);
    await key("g g  Top", ["g", "g"], to("trail-3"));
    await key("b m l  Only this list", ["b", "m", "l"], { what: "the list to show one mailing list", until: (state) => state.listed.length > 0 && state.listed.every((id) => id.startsWith("trail-")) }, HOLD_MS);
    await key("b r  Show all", ["b", "r"], { what: "the whole Inbox to show", until: (state) => state.listed.includes(id_of("lunch-1")) }, HOLD_MS);
    await key("s f  Sort by sender", ["s", "f"], { what: "the list to sort by sender", until: (state) => state.mail_tab?.sort_type === "author" }, HOLD_MS);
    await key("s d  Sort by date", ["s", "d"], { what: "the list to sort by date", until: (state) => state.mail_tab?.sort_type === "date" }, HOLD_MS);

    // 4. Click anything: f picks the newsletter's unsubscribe link and the toolbar button, whose popup opens the options page.
    await title("Click anything");
    await key("G  Last message", ["G"], to(NEWSLETTER_ID));
    await key("Enter  Open", [["-k", "Return"]], { what: "a message tab to open", until: has_tab((tab) => tab.type === "messageDisplay") }, 1200);
    await hint_pick("body", "f  Click any link", 1800);
    await wait_for_state(instance, { what: "a compose window to the unsubscribe address", until: (state) => state.windows.some((window) => window.type === "messageCompose" && window.tabs.some((tab) => JSON.stringify(tab.to ?? "").includes("unsubscribe@"))), timeout_ms: 15000 });
    await pause(HOLD_MS + 300);
    caption("Esc q  Close");
    await instance.press(["-k", "Escape"]);
    await instance.press(["q"]);
    await pause(700);
    if (compose_open(await instance.ask("state"))) await close_compose(instance);
    await key("q  Close the tab", ["q"], { what: "the message tab to close", until: (state) => !has_tab((tab) => tab.type === "messageDisplay")(state) }, 300);
    await hint_pick("toolbar", "f  Click any button", 1000);
    await pause(800);
    await key("o  Options", ["o"], { what: "the options tab to open", until: has_tab((tab) => /options|desertbird/i.test(`${tab.title} ${tab.raw?.url ?? ""}`) && tab.type !== "mail") }, 1200);
    // f focuses a select, j and k step it, Escape leaves it.
    await hint_pick("theme", "f  Click any setting", 800);
    for (let step = 0; step < THEME_STEPS_UP; step++) await key(step === 0 ? "k  Try themes" : null, ["k"], null, 350);
    await key("Esc  Leave the list", [["-k", "Escape"]], null, 500);
    await hint_pick("border", "f  Click any setting", 800);
    for (let step = 0; step < BORDER_STEPS_DOWN; step++) await key(step === 0 ? "j  Pick a border" : null, ["j"], null, 450);
    await key("Esc  Leave the list", [["-k", "Escape"]], null, 500);
    await key("G  Bottom", ["G"], null, 700);
    await hint_pick("save", "f  Click any button", 800);
    await pause(HOLD_MS);
    await key("q  Close the tab", ["q"], null, 500);

    // 5. Do anything by name: a tag and a move typed by name, then undo.
    await title("Do anything by name");
    await key("k  Up", ["k"], to("coffee-1"));
    recording.assert_alive();
    caption(":  Command line");
    await open_command_line(instance, [":"], { attempts: 3 });
    await pause(1000);
    caption(": tg  Tab");
    await type_letters("tg");
    await pause(400);
    await instance.press(["-k", "Tab"]);
    await pause(400);
    caption(": tag imp  Tab");
    await type_letters(" imp");
    await pause(500);
    await instance.press(["-k", "Tab"]);
    await pause(400);
    await key("Enter  Tag Important", [["-k", "Return"]], { what: "the receipt to carry the Important tag", until: (state) => (state.flags[id_of("coffee-1")]?.tags ?? []).includes("$label1") }, HOLD_MS);
    recording.assert_alive();
    caption("m m  Move");
    // The two letters as two presses, or the second can reach the app first.
    await instance.press(["m"]);
    await open_command_line(instance, ["m"], { attempts: 1 });
    await pause(800);
    caption("m m rec  Tab");
    await type_letters("rec");
    await pause(500);
    await instance.press(["-k", "Tab"]);
    await pause(400);
    await key("Enter  Move to Receipts", [["-k", "Return"]], gone("coffee-1"), HOLD_MS);
    await key("u  Undo", ["u"], { what: "the receipt to come back", until: (state) => state.listed.includes(id_of("coffee-1")) }, HOLD_MS + 300);

    // 6. The end card.
    caption("");
    captions.push({ at_ms: clock(), end: true });
    await pause(END_CARD_MS);
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
  deadline_s: 700,
  run: (instance, ctx) => run_demo(instance, ctx),
};
