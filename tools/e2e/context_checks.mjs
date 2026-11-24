// The context menu key `, m` (the command `context.menu`): a native menu opens for what the focus is on. Each check presses the key, compares the window before and after as pixels (a menu draws over most of a column of the window) and keeps a screenshot for the reader. Takes the helpers of `run.mjs` as arguments, as `popup_checks.mjs` does.

import { readFileSync } from "node:fs";
import { compose_opens } from "./predicates.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The whole window at the e2e size. A menu covers about 3% of it or more, and an unchanged window differs in under 0.5% (a status bar clock or a hover mark).
const WINDOW_REGION = "0,0 1280x720";
const MENU_OPEN_AT_LEAST = 0.01;
const CONTEXT_KEYS = [",", "m"];

const share_differing = (one, other) => one.reduce((count, byte, index) => count + (byte !== other[index] ? 1 : 0), 0) / one.length;

export const window_pixels = async (instance, name) => readFileSync(await instance.shot_region(name, WINDOW_REGION, "ppm"));

/** Presses `, m` and reports how much of the window changed, with a screenshot of the open menu for the reader. Escape closes the menu after. */
export async function press_context_key(instance, { shot }, name, line, { keys = CONTEXT_KEYS, expect_open = true } = {}) {
  const closed = await window_pixels(instance, `${name}_closed`);
  for (const key of keys) await instance.press([key]);
  await sleep(1200);
  const open = await window_pixels(instance, `${name}_open`);
  const share = share_differing(closed, open);
  await shot(name, line);
  return { share, opened: share > MENU_OPEN_AT_LEAST, closed, open };
}

export async function close_menu(instance) {
  await instance.press(["-k", "Escape"]);
  await sleep(700);
}

export async function run_context_menu_mail_tab(instance, ctx) {
  const { app, kind, check, note, shot, first_selected } = ctx;
  // Focus is in the thread list after open_inbox. The cursor row is the selected one here.
  let result = await press_context_key(instance, ctx, "context_thread", "thread list after , m: the thread context menu is open at the cursor row");
  check(app, kind, ", m in the thread list opens a menu", result.opened, `window differs by ${result.share.toFixed(4)}`);
  await close_menu(instance);
  const closed_again = await window_pixels(instance, "context_thread_closed_again");
  check(app, kind, "Escape closes the thread list menu", share_differing(result.open, closed_again) > MENU_OPEN_AT_LEAST, `differs from the open menu by ${share_differing(result.open, closed_again).toFixed(4)}`);

  // A menu that is already open owns the keyboard, as any open menu does: the comma does nothing and the m is the access key of Move To, so the menu opens its submenu and no second menu opens. Two Escapes close the submenu and the menu.
  const first = await press_context_key(instance, ctx, "context_twice_first", "thread list: the menu before a second , m");
  for (const key of CONTEXT_KEYS) await instance.press([key]);
  await sleep(1200);
  const second = await window_pixels(instance, "context_twice_second");
  await shot("context_twice_second", "thread list after a second , m with the menu open: the same menu, with the Move To submenu from the m access key and no second menu");
  check(app, kind, ", m with a menu already open keeps the one menu open", share_differing(first.closed, second) > MENU_OPEN_AT_LEAST && instance.exited() === null, `differs from the closed list by ${share_differing(first.closed, second).toFixed(4)}`);
  await close_menu(instance);
  await close_menu(instance);
  const after_twice = await window_pixels(instance, "context_twice_closed");
  check(app, kind, "two Escapes close the menu after a second , m", share_differing(first.closed, after_twice) < 0.02, `differs from the list before the menu by ${share_differing(first.closed, after_twice).toFixed(4)}`);

  // The cursor row moves with j and the menu follows it: the menu of the second row sits lower than the first on Betterbird (table rows).
  await instance.press(["j"]);
  await sleep(500);
  const moved = await press_context_key(instance, ctx, "context_thread_after_j", "thread list after j and , m: the menu is open at the new cursor row");
  check(app, kind, ", m after j opens a menu", moved.opened, `window differs by ${moved.share.toFixed(4)}`);
  note(app, kind, "menu pixels after j differ from the first menu", `${share_differing(result.open, moved.open).toFixed(4)}`);
  await close_menu(instance);

  // The cursor row and the selection on different rows: Space picks the selected row and k moves the cursor off it. The menu must act on the cursor row, as a right-click on it does. The first item of the menu is the read toggle, so Down and Return run it, and the flags say which message it changed.
  const pick_state = await instance.ask("state");
  const picked = first_selected(pick_state);
  const above = pick_state.listed[pick_state.listed.indexOf(picked) - 1];
  await instance.press([" "]);
  await instance.press(["k"]);
  await sleep(500);
  const read_before = { picked: pick_state.flags[picked]?.read, above: pick_state.flags[above]?.read };
  for (const key of CONTEXT_KEYS) await instance.press([key]);
  await sleep(1200);
  await shot("context_thread_pick", "thread list with the selection on one row and the cursor on the row above, after , m: the menu is open at the cursor row");
  await instance.press(["-k", "Down"]);
  await sleep(300);
  await instance.press(["-k", "Return"]);
  await sleep(1500);
  const acted = await instance.ask("state");
  check(app, kind, ", m with the cursor off the selection acts on the cursor row and leaves the selected row alone", above !== undefined && acted.flags[above]?.read === !read_before.above && acted.flags[picked]?.read === read_before.picked, `cursor row ${above} read ${read_before.above} then ${acted.flags[above]?.read}, selected row ${picked} read ${read_before.picked} then ${acted.flags[picked]?.read}`);
  await instance.press(["-k", "Escape"]);
  await sleep(500);

  // The folder pane.
  for (const key of ["g", "f"]) await instance.press([key]);
  await sleep(600);
  result = await press_context_key(instance, ctx, "context_folder", "folder pane after , m: the folder context menu is open at the selected folder");
  check(app, kind, ", m in the folder pane opens a menu", result.opened, `window differs by ${result.share.toFixed(4)}`);
  await close_menu(instance);

  // The message body.
  for (const key of ["g", "m"]) await instance.press([key]);
  await sleep(600);
  result = await press_context_key(instance, ctx, "context_message_body", "message body after , m: the message context menu is open");
  check(app, kind, ", m in the message body opens a menu", result.opened, `window differs by ${result.share.toFixed(4)}`);
  await close_menu(instance);

  // An empty list: the key does nothing, shows nothing and breaks nothing. Trash is empty in the fixture.
  for (const key of ["g", "f"]) await instance.press([key]);
  await instance.press(["j"]);
  await sleep(1500);
  for (const key of ["g", "e"]) await instance.press([key]);
  await sleep(600);
  const empty = await press_context_key(instance, ctx, "context_empty_list", "the empty Trash list after , m: no menu opens");
  check(app, kind, ", m in an empty list opens no menu", !empty.opened, `window differs by ${empty.share.toFixed(4)}`);
  const state = await instance.ask("state");
  check(app, kind, "after , m in an empty list the app still answers", instance.exited() === null && state.mail_tab?.folder === "/Trash", `folder ${state.mail_tab?.folder}`);
}

// Tab presses from the body of a message window to the sender and to the first recipient pill, counted on the header of the Reading messages (the first Tab reaches Reply, on both apps).
const HEADER_STOPS = { sender: 2, recipient: 3, subject: 4 };

const message_windows = (state) => state.windows.filter((window) => window.type === "messageDisplay");

// A message window opened after the app started: its header fields and its body.
export async function run_context_menu_message_window(instance, ctx) {
  const { app, kind, check, wait_for_state, open_inbox } = ctx;
  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  const main_window_id = (await instance.ask("state")).windows.find((window) => window.type === "normal")?.id;
  await instance.ask("focus_window", 20000, { windowId: main_window_id });
  await instance.ask("select:reading-plain@fixture.invalid", 30000);
  await sleep(800);
  const since = Date.now();
  await instance.ask("open_message_window");
  const state = await wait_for_state(instance, { what: "the message window to report its body", until: (current) => current.body !== null && current.body.doc_start >= since && message_windows(current).map((window) => window.id).includes(current.body.window_id), show: (current) => `body of window ${current.body?.window_id}`, timeout_ms: 10000 });
  await instance.ask("focus_window", 20000, { windowId: state.body.window_id });
  await sleep(1000);
  // Just opened, the focus is in the body.
  let result = await press_context_key(instance, ctx, "context_window_body", "message window opened after startup, body focused, after , m: the message body menu is open");
  check(app, kind, ", m in the body of a message window opened after startup opens a menu", result.opened, `window differs by ${result.share.toFixed(4)}`);
  await close_menu(instance);
  // Tab walks the header: the sender and the recipient pill sit at these stops from the body (read from screenshots of each stop).
  let tabbed = 0;
  for (const [name, stop, what] of [["sender", HEADER_STOPS.sender, "the sender"], ["recipient", HEADER_STOPS.recipient, "a recipient pill"], ["subject", HEADER_STOPS.subject, "the subject"]]) {
    for (; tabbed < stop; tabbed++) await instance.press(["-k", "Tab"]);
    await sleep(500);
    result = await press_context_key(instance, ctx, `context_window_${name}`, `message window with ${what} focused, after , m: its menu is open`);
    check(app, kind, `, m on ${what} in a message window opens a menu`, result.opened, `window differs by ${result.share.toFixed(4)}`);
    await close_menu(instance);
  }
  check(app, kind, "the app survived", instance.exited() === null);
}

// The mode label of a compose window draws once the chrome runtime hooks it. A key before that goes to the editor as text.
const COMPOSE_LABEL_REGION = "980,696 90x22";
const COMPOSE_BLANK_REGION = "600,696 90x22";

// A compose window opened after the app started: the To and Subject fields, and the body.
export async function run_context_menu_compose(instance, ctx) {
  const { app, kind, check, wait_for_state, key_and_state, hud_pixels, wait_pixels, close_compose } = ctx;
  await wait_for_state(instance, { what: "the mail window to have a mail tab and the focus", until: (state) => state.mail_tab !== null && state.windows.some((window) => window.type === "normal" && window.focused === true), timeout_ms: 10000 });
  await instance.ask("select:inbox-s2@fixture.invalid", 30000);
  await sleep(1000);
  await key_and_state(instance, ["r"], compose_opens((tab) => Boolean(tab.subject)));
  const blank = await hud_pixels(instance, `${app}_context_compose_blank`, COMPOSE_BLANK_REGION);
  await wait_pixels(instance, "the compose window to draw its mode label", `${app}_context_compose_label`, COMPOSE_LABEL_REGION, (hash) => hash !== blank, { timeout_ms: 10000 });
  // The window opens in insert mode, where , and m are text. Escape gives normal mode, where the key is bound.
  await instance.press(["-k", "Escape"]);
  await sleep(500);
  let result = await press_context_key(instance, ctx, "context_compose_body", "compose body after Escape and , m: the editor context menu is open");
  check(app, kind, ", m in the body of a compose window opened after startup opens a menu", result.opened, `window differs by ${result.share.toFixed(4)}`);
  await close_menu(instance);
  for (const [field, key, what] of [["subject", "s", "the Subject field"], ["to", "t", "the To field"]]) {
    // A field jump enters insert mode, so Escape gives normal mode back with the focus still in the field.
    for (const each of ["g", key]) await instance.press([each]);
    await sleep(700);
    await instance.press(["-k", "Escape"]);
    await sleep(500);
    result = await press_context_key(instance, ctx, `context_compose_${field}`, `compose window with ${what} focused, after , m: its menu is open`);
    check(app, kind, `, m in ${what} of a compose window opens a menu`, result.opened, `window differs by ${result.share.toFixed(4)}`);
    await close_menu(instance);
  }
  await close_compose(instance);
  check(app, kind, "the app survived", instance.exited() === null);
}

// A web page of the local server and another add-on's page, each in a tab opened after the app started. The page actor takes the keys, the context menu actor opens the menu.
export async function run_context_menu_pages(instance, ctx) {
  const { app, kind, check, open_inbox } = ctx;
  const { start_web_fixture } = await import("./web_fixture.mjs");
  const fixture = await start_web_fixture();
  try {
    await open_inbox(instance);
    const from = fixture.log.length;
    await instance.ask("open_web_tab", 20000, { url: fixture.url("") });
    for (let waited = 0; waited < 8000 && !fixture.log.slice(from).some((entry) => entry.kind === "pageshow"); waited += 200) await sleep(200);
    await sleep(1500);
    let result = await press_context_key(instance, ctx, "context_web_page", "web page tab after , m: the page context menu is open");
    check(app, kind, ", m in a web page tab opens a menu", result.opened, `window differs by ${result.share.toFixed(4)}`);
    await close_menu(instance);
    await instance.ask("reset_tabs", 20000);
    await sleep(800);
    await instance.ask("open_helper_page", 20000, { log: fixture.port });
    await sleep(2500);
    result = await press_context_key(instance, ctx, "context_extension_page", "another add-on's page tab after , m: the page context menu is open");
    check(app, kind, ", m in another add-on's page tab opens a menu", result.opened, `window differs by ${result.share.toFixed(4)}`);
    await close_menu(instance);
    check(app, kind, "the app survived", instance.exited() === null);
  } finally {
    await fixture.close();
  }
}
