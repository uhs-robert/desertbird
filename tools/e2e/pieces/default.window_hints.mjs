// The mail window hint labels (f): the fixed labels per app, shown and ended.

import { COLLAPSED_ROWS } from "../fixture_rows.mjs";
import { sleep, first_selected, selects, folder_shown, holds_twice, drawn_since } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["hints", "folders", "cmdline", "theme"];

async function run_window_hints(instance, ctx) {
  const { app, kind, shot, check, wait_for_state, key_and_state, wait_pixels, open_command_line, press_in_command_line } = ctx;
  const labels = WINDOW_HINT_LABELS[app];
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  const window_pixels = (name, until, options) => wait_pixels(instance, name, `${app}_hints_${name.replaceAll(" ", "_")}`, WINDOW_REGION, until, { timeout_ms: 5000, ...options });
  // Presses f and returns the pixels of the window before and with the labels.
  const show_labels = async (keys = ["f"]) => {
    const before = await window_pixels("the window before the labels", holds_twice());
    hold_from = Date.now();
    await instance.press(keys);
    return { before, labelled: await window_pixels("the labels to draw", drawn_since(before)) };
  };
  await instance.press(["g"]);
  const top = await key_and_state(instance, ["g"], selects(COLLAPSED_ROWS[0]));
  const rows_before = top.listed.length;
  const { labelled } = await show_labels();
  await shot("window_hints", "f in the thread list: labels over the toolbar, folder rows, message rows and buttons");
  // Hint letters are home row keys that are also commands (j moves down, s stars). While the labels show they must reach the labels only: the selection must not move.
  await instance.press(["j"]);
  await instance.press(["-k", "Escape"]);
  // A message pane that finishes loading changes the window too, so the end of the labels is the region leaving the labelled hash, not returning to an earlier one.
  await window_pixels("Escape to end the labels", drawn_since(labelled));
  // A command that j ran would show in the state a moment after the key, and the focus is not in the list for the barrier yet.
  await sleep(500);
  let state = await instance.ask("state");
  check(app, kind, "window hints: j typed while the labels show runs no command, and Escape ends them", state.listed.length === rows_before && selection_of(state) === selection_of(top), `listed ${state.listed.length} of ${rows_before}, selected ${selection_of(state)}`);
  await shot("window_hints_ended", "the labels are gone after a letter and Escape");
  // The hold drops plain keys, so wait it out or this check proves nothing.
  await hold_over();
  state = await key_and_state(instance, ["j"], { what: "j to move the selection after Escape", until: (current) => selection_of(current) !== selection_of(top), show: (current) => `selected ${selection_of(current)}` });
  check(app, kind, "window hints: after Escape a bound key runs again", selection_of(state) !== selection_of(top), `selected ${selection_of(top)} then ${selection_of(state)}`);
  await instance.press(["g"]);
  const burst_before = selection_of(await key_and_state(instance, ["g"], selects(COLLAPSED_ROWS[0])));
  // The whole gesture in one burst. `c` is bound (msg.new opens a compose window) and is no hint label. The first `c` ends the labels and is swallowed, and the hold after `f` must drop the second, so no compose window may open.
  // A compose window opens many seconds late, so this negative check keeps its margin.
  await instance.press(["fcc"]);
  await sleep(2000);
  state = await instance.ask("state");
  check(app, kind, "window hints: f c c in one burst opens no compose window and changes no mail", !state.windows.some((window) => window.type === "messageCompose") && state.listed.length === rows_before && selection_of(state) === burst_before, `compose windows ${state.windows.filter((window) => window.type === "messageCompose").length}, listed ${state.listed.length} of ${rows_before}`);
  // A key that no label continues with ends the labels, and swallows the key.
  const { before: before_z, labelled: labelled_z } = await show_labels();
  await instance.press(["z"]);
  await window_pixels("z to end the labels", drawn_since(labelled_z));
  await hold_over();
  state = await key_and_state(instance, ["j"], { what: "j to move the selection after z", until: (current) => selection_of(current) !== burst_before, show: (current) => `selected ${selection_of(current)}` });
  check(app, kind, "window hints: a key no label starts with ends them, then j moves", selection_of(state) !== selection_of(top) && labelled_z !== before_z, `selected ${selection_of(state)}`);
  // A message row: one pick selects it and leaves the focus in the list.
  await show_labels();
  await instance.press([labels.thread_row_1]);
  state = await wait_for_state(instance, selects(COLLAPSED_ROWS[1]));
  check(app, kind, "window hints: the label of a message row selects that thread", first_selected(state) === COLLAPSED_ROWS[1], `selected ${first_selected(state)}, expected ${COLLAPSED_ROWS[1]}`);
  await hold_over();
  state = await key_and_state(instance, ["j"], selects(COLLAPSED_ROWS[2]));
  check(app, kind, "window hints: after a row pick the focus is in the list, so j moves on", first_selected(state) === COLLAPSED_ROWS[2], `selected ${first_selected(state)}, expected ${COLLAPSED_ROWS[2]}`);
  // A folder row: one pick shows that folder, and j then moves in the folder pane.
  await show_labels();
  await shot("window_hints_second", "f again after a row pick: the labels follow the new layout");
  await instance.press([labels.folder_reading]);
  state = await wait_for_state(instance, folder_shown("/Reading"));
  check(app, kind, "window hints: the label of a folder row shows that folder", state.mail_tab?.folder === "/Reading", `displayed folder ${state.mail_tab?.folder}`);
  await shot("window_hints_folder", "the Reading folder shown after a folder hint, no labels left");
  await show_labels();
  await instance.press([labels.folder_inbox]);
  // The pick ends the labels, so the hold after `f` ends with them: an f at once, inside the 1.5 s, must label again. A held f would be swallowed and Escape would then change nothing.
  hold_from = Date.now();
  await instance.press(["f"]);
  state = await wait_for_state(instance, folder_shown("/Inbox"));
  check(app, kind, "window hints: the label of the Inbox row returns to the Inbox", state.mail_tab?.folder === "/Inbox", `displayed folder ${state.mail_tab?.folder}`);
  const settled = await window_pixels("the window to hold still after the pick and f", holds_twice());
  await instance.press(["-k", "Escape"]);
  const escaped = await window_pixels("Escape to end the labels of the second f", drawn_since(settled), { timeout_ms: 3000 });
  check(app, kind, "window hints: f typed at once after a pick shows labels again", escaped !== settled, `Escape ${escaped === settled ? "changed nothing, so no labels were up" : "ended the labels"}`);
  // `; ;` opens the command line with `hint ` typed. A flag and Enter run the window hint command, which labels the window.
  await hold_over();
  await instance.press([";"]);
  await open_command_line(instance, [";"]);
  await shot("window_hints_cmdline", "after ; ;: the command line is open with hint typed in");
  await press_in_command_line(instance, ["--", "--focus"], WINDOW_REGION);
  hold_from = Date.now();
  const { after: labels_up } = await press_in_command_line(instance, ["-k", "Return"], WINDOW_REGION);
  await shot("window_hints_cmdline_labels", "after hint --focus on the line: the labels show");
  const { after: labels_gone } = await press_in_command_line(instance, ["-k", "Escape"], WINDOW_REGION);
  state = await instance.ask("state");
  check(app, kind, "window hints: ; ; then hint --focus then Escape leaves the list as it was", state.listed.length === rows_before && labels_up !== labels_gone, `listed ${state.listed.length} of ${rows_before}`);
  check(app, kind, "the app survived the window hint checks", instance.exited() === null);
  // The next section presses plain keys at once, and the hold would drop its first one.
  await hold_over();
}

// The labels sit in the order the targets sit on screen (window toolbars, folder rows, message rows, then buttons), so a fixed window shows the same labels each run. The ones below were read from the shots of each app.
const WINDOW_HINT_LABELS = { betterbird: { thread_row_1: "da", folder_reading: "sj", folder_inbox: "sd" }, thunderbird: { thread_row_1: "da", folder_reading: "sj", folder_inbox: "sd" } };

// The labels draw over the toolbars, the folder rows and the message rows, so the whole window is the region to read.
const WINDOW_REGION = "0,0 1280x720";

// The key that runs the hint command (f, or Return on the hint command line) holds plain keys for 1.5 s (`HOLD_MS` in src/chrome/runtime.ts), counted from that key. Nothing shows when the hold is over, so `hold_over` waits out what is left of it, counted from `hold_from`.
const HINT_HOLD_MS = 1600;

let hold_from = 0;

const hold_over = () => sleep(Math.max(0, HINT_HOLD_MS - (Date.now() - hold_from)));

export const piece = section_piece({ section: "window_hints", only: ["hints"], run: run_window_hints });
