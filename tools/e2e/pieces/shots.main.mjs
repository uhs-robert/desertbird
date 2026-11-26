// The screenshots of the README and the store listing, on the realistic mail of the `shots` profile kind. Opt-in: it checks nothing and writes a still for each feature. Run it with E2E_SHARDS=1 E2E_KINDS=shots E2E_ONLY=main E2E_KEEP=1 E2E_DIR=<empty dir> just e2e thunderbird, then copy the shots from the run dir to docs/images/.

import { sleep, drawn_since, holds_twice } from "../predicates.mjs";
import { OPEN_OWN_PAGES_SCRIPT } from "../seed.mjs";
import { NEWSLETTER_ID } from "../shots_fixture.mjs";

export const areas = ["hud", "hints", "cmdline", "message_body", "own_pages"];

const id_of = (name) => `${name}@example.com`;
const SETTLE_MS = 1500;

async function run_shots(instance, ctx) {
  const { report, show_folder, wait_for_state, wait_pixels, key_and_state, open_command_line, close_command_line, close_compose } = ctx;
  const app = instance.app;
  const kind = instance.kind;
  const shot = async (name, line) => report.shots.push({ app, kind, path: await instance.shot(`${app}_${name}`), name, line });
  const strip_region = "0,0 1280x720";
  const settled = (name) => wait_pixels(instance, `the window to hold still before ${name}`, `${app}_shots_${name}_before`, strip_region, holds_twice(), { timeout_ms: 5000 });
  const escape = async () => { await instance.press(["-k", "Escape"]); await sleep(SETTLE_MS); };
  const select = async (name) => {
    await instance.ask(`select:${id_of(name)}`, 30000);
    await wait_for_state(instance, { what: `${name} to be selected`, until: (state) => state.selected.some((message) => message.header_id === id_of(name)), timeout_ms: 15000 });
    await sleep(SETTLE_MS);
  };
  // g e puts the focus back in the thread list after a tab or a window.
  const focus_list = async () => { await instance.press(["g"]); await instance.press(["e"]); await sleep(SETTLE_MS); };
  // The panel of a key prefix draws after the which-key delay. The shot waits for the window to differ from the one without it.
  const panel_shot = async (name, line, keys) => {
    const before = await settled(name);
    for (const key of keys) await instance.press([key]);
    await wait_pixels(instance, `the panel for ${name}`, `${app}_shots_${name}_panel`, strip_region, drawn_since(before), { timeout_ms: 5000 });
    await sleep(500);
    await shot(name, line);
    await escape();
  };

  await show_folder(instance, "/Inbox");
  await sleep(SETTLE_MS);
  await instance.press(["-k", "F6"]);
  if ((await instance.ask("state")).mail_tab?.message_pane_visible) { await instance.press(["w"]); await instance.press(["m"]); }
  await sleep(SETTLE_MS);
  await instance.press(["g"]);
  await instance.press(["g"]);
  await sleep(SETTLE_MS);
  await shot("inbox", "the Inbox with the first thread selected");

  await panel_shot("which-key", "g and a pause: the which-key panel lists the go keys", ["g"]);
  await panel_shot("which-key-message", "m and a pause: the message keys", ["m"]);
  await panel_shot("followup", "m f and a pause: the follow-up reminder presets", ["m", "f"]);

  // f labels every control of the mail window.
  const before_hints = await settled("hints");
  await instance.press(["f"]);
  await wait_pixels(instance, "the hint labels", `${app}_shots_hints_drawn`, strip_region, drawn_since(before_hints), { timeout_ms: 5000 });
  await sleep(500);
  await shot("hints", "f in the mail window: a label on every row and control");
  await escape();

  // The command line with part of a command typed.
  await open_command_line(instance, [":"], { attempts: 3 });
  for (const letter of "fil") await instance.press([letter]);
  await sleep(SETTLE_MS);
  await shot("command-line", "the command line with fil typed and the matching commands listed");
  await close_command_line(instance);

  // Visual mode over three rows.
  await instance.press(["g"]);
  await instance.press(["g"]);
  await sleep(SETTLE_MS);
  await instance.press(["v"]);
  await instance.press(["j"]);
  await instance.press(["j"]);
  await sleep(SETTLE_MS);
  await shot("visual-mode", "v j j: three rows selected, the label reads VISUAL");
  await escape();

  // The filter keys: b m l keeps the mail of the selected message's list.
  await select("cactus-4");
  await instance.press(["b"]);
  await instance.press(["m"]);
  await instance.press(["l"]);
  await sleep(2500);
  await shot("filter", "b m l: the list shows only the mail of the selected message's mailing list");
  await instance.press(["b"]);
  await instance.press(["r"]);
  await sleep(SETTLE_MS);

  // f in a message tab labels the links of the body.
  await select(NEWSLETTER_ID);
  await instance.ask("open_message_tab");
  await sleep(4000);
  const before_body = await settled("body-hints");
  await instance.press(["f"]);
  await wait_pixels(instance, "the labels over the message", `${app}_shots_body_hints_drawn`, strip_region, drawn_since(before_body), { timeout_ms: 5000 });
  await sleep(500);
  await shot("body-hints", "f in a message: a label on every link in the body");
  await escape();
  await instance.press(["q"]);
  await sleep(SETTLE_MS);
  await focus_list();

  // A reply in the compose window, in normal mode.
  await select("roadmap-1");
  await key_and_state(instance, ["r"], { what: "a compose window with the reply", until: (state) => state.windows.some((window) => window.type === "messageCompose" && window.tabs.some((tab) => tab.subject && (tab.body ?? "").includes("agenda"))), timeout_ms: 15000 });
  await sleep(3000);
  // The compose window opens at less than the screen. labwc's own Super+A maximizes it, as a user's window manager would.
  await instance.press(["-M", "logo", "a", "-m", "logo"]);
  await sleep(SETTLE_MS);
  await instance.press(["-k", "Escape"]);
  await sleep(SETTLE_MS);
  await shot("compose-normal-mode", "the reply window after Escape: the status bar label reads NORMAL");
  await close_compose(instance);
  await focus_list();

  // The generated help page and the options page, opened by the add-on's own page script.
  for (const [page, name] of [["help", "help-page"], ["options", "options-page"]]) {
    await instance.ask("open_own_page", 20000, { page });
    await sleep(4000);
    await shot(name, `the ${page} page`);
    await instance.press(["q"]);
    await sleep(SETTLE_MS);
  }
}

export const piece = {
  kind: "shots",
  section: "main",
  opt_in: true,
  seeds: {},
  extra_script: OPEN_OWN_PAGES_SCRIPT,
  deadline_s: 400,
  run: (instance, ctx) => run_shots(instance, ctx),
};
