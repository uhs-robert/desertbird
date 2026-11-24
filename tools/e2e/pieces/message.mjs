// The message body scripts: the reading pane, find, hints, mail keys, tabs and windows. The remote piece runs the same checks with remote content allowed by the profile kind.

import { sleep, first_selected, selects, flag_becomes, main_window_tabs, active_index, tab_count_is, active_is, ppm_colors, drawn_since, holds_twice } from "../predicates.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";
import { insert_label } from "./_insert_label.mjs";

export const areas = ["message_body", "hints", "tabs", "mail_keys", "theme", "panes"];

// The body script: keys while a message is read, in the reading pane, a message tab and a message window. The helper's own content script reports the scroll position and whether DesertBird marked the document.
const LINE_STEP_PX = 40;

const READING_FOLDER_MESSAGES = ["reading-plain", "reading-html", "reading-remote", "reading-sandbox"];

const body_state = (state) => state.body ?? { live: false, scroll_y: -1, scroll_height: 0, inner_height: 0, selection: "" };

const near = (value, expected) => Math.abs(value - expected) <= 2;

// The body report follows a scroll after 100 ms, so a wait on the scroll position ends once the key's scroll has settled and not on a read halfway.
const scroll_is = (what, until) => ({ what, until: (state) => until(body_state(state)), show: (state) => `scrollY ${body_state(state).scroll_y}` });

const scrolls_near = (position) => scroll_is(`the body to scroll to ${position}`, (body) => near(body.scroll_y, position));

// A document has reported once the helper holds a report from it. `from_target` picks the target by the sender of the report (its tab or its window), and `doc_start` must be later than `since`, so the report is from a document made after the action and not from the one it replaces.
const body_reports = (what, since, from_target) => ({ what: `the document of ${what} to report`, until: (state) => state.body !== null && state.body.doc_start >= since && from_target(state, state.body), show: (state) => `body of tab ${state.body?.tab_id}, window ${state.body?.window_id}, started ${state.body?.doc_start}, ${state.body?.href}`, timeout_ms: 10000 });

// The pane is in the mail tab. A framed document inside the message reports too and does not carry the message text, so only the top document must name the message.
const pane_document_of = (id) => (state, body) => body.tab_id === state.mail_tab?.id && (body.is_top === false || (body.text_start ?? "").includes(` of ${id}.`));

const tab_document = (state, body) => body.tab_id === main_window_tabs(state).find((tab) => tab.type === "messageDisplay")?.id;

const window_document = (state, body) => body.window_id === state.windows.find((window) => window.type === "messageDisplay")?.id;

// g e and g f from the message body go through the background page to the window, and the helper state has no focus to read, so the keys after them wait this margin.
const FOCUS_MOVE_MARGIN_MS = 1200;

// `since` asks for a report sent after that time, so a report from before a key cannot pass, and `window_id` for a report of that window's document, so another window's report cannot pass.
const body_focus_is = (focused, since, window_id) => ({ what: `the focus to ${focused ? "be in" : "leave"} the body of window ${window_id}`, until: (state) => body_state(state).window_id === window_id && body_state(state).has_focus === focused && (body_state(state).reported_at ?? 0) >= since, show: (state) => `window ${body_state(state).window_id}, has_focus ${body_state(state).has_focus}, reported_at ${body_state(state).reported_at}`, timeout_ms: 5000 });

// Inside the Help menu of a message window as both apps draw it, and nowhere a notification draws, so only the open menu changes it.
const HELP_MENU_REGION = "505,60 250x140";
// A point of plain text in the body of a message window, below its menus, read from the shots of both apps.
const MESSAGE_WINDOW_BODY_POINT = [800, 600];

const window_of_type = (type, present) => ({ what: `a ${type} window to ${present ? "open" : "close"}`, until: (state) => state.windows.some((window) => window.type === type) === present, show: (state) => JSON.stringify(state.windows.map((window) => window.type)), timeout_ms: 10000 });

async function run_message_scripts(instance, ctx) {
  const { report, check, note, open_inbox, wait_for, wait_for_state, key_and_state, wait_pixels } = ctx;
  const app = instance.app;
  const kind = instance.kind;
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${kind}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };
  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);

  // Shows the message in the pane and puts focus in its body: the helper selects it, one F6 from the thread list reaches the body.
  const show_in_pane = async (id) => {
    const since = Date.now();
    await instance.ask(`select:${id}@fixture.invalid`, 30000);
    await wait_for_state(instance, body_reports(id, since, pane_document_of(id)));
    await instance.press(["-k", "F6"]);
    return instance.ask("state");
  };
  // Runs the scroll keys in the document that has focus. `where` names it in each check.
  // Escape is skipped where Thunderbird itself closes the window on it, the message window.
  const scroll_keys = async (where, { measure_only = false, escape = true } = {}) => {
    let state = await instance.ask("state");
    const start = body_state(state);
    note(app, kind, `${where}: body document`, `live ${start.live}, top frame ${start.is_top}, scrollHeight ${start.scroll_height}, innerHeight ${start.inner_height}, ${start.href}`);
    check(app, kind, `${where}: the body script marked the document live`, start.live === true, JSON.stringify(start));
    check(app, kind, `${where}: the message is taller than a screen`, start.scroll_height > 3 * start.inner_height, `scrollHeight ${start.scroll_height}, innerHeight ${start.inner_height}`);
    const keys = async (args, wait) => body_state(await key_and_state(instance, args, wait));
    let body = await keys(["j"], scrolls_near(LINE_STEP_PX));
    check(app, kind, `${where}: j scrolls one line`, near(body.scroll_y, LINE_STEP_PX), `scrollY ${body.scroll_y}`);
    if (measure_only) return;
    await instance.press(["5"]);
    body = await keys(["j"], scrolls_near(6 * LINE_STEP_PX));
    check(app, kind, `${where}: 5j scrolls five lines`, near(body.scroll_y, 6 * LINE_STEP_PX), `scrollY ${body.scroll_y}`);
    body = await keys(["k"], scrolls_near(5 * LINE_STEP_PX));
    check(app, kind, `${where}: k scrolls one line back`, near(body.scroll_y, 5 * LINE_STEP_PX), `scrollY ${body.scroll_y}`);
    const before_half = body.scroll_y;
    body = await keys(["-M", "ctrl", "d", "-m", "ctrl"], scroll_is("Ctrl+d to scroll half a page", (current) => near(current.scroll_y - before_half, current.inner_height / 2)));
    check(app, kind, `${where}: Ctrl+d scrolls half a page`, near(body.scroll_y - before_half, body.inner_height / 2), `scrollY ${before_half} then ${body.scroll_y}, innerHeight ${body.inner_height}`);
    body = await keys(["-M", "ctrl", "u", "-m", "ctrl"], scrolls_near(before_half));
    check(app, kind, `${where}: Ctrl+u scrolls half a page back`, near(body.scroll_y, before_half), `scrollY ${body.scroll_y}, expected ${before_half}`);
    body = await keys(["G"], scroll_is("G to scroll to the bottom", (current) => near(current.scroll_y, current.scroll_height - current.inner_height)));
    check(app, kind, `${where}: G scrolls to the bottom`, near(body.scroll_y, body.scroll_height - body.inner_height), `scrollY ${body.scroll_y}, scrollHeight ${body.scroll_height}, innerHeight ${body.inner_height}`);
    await shot(`${where.replaceAll(" ", "_")}_bottom`, `${where} after G`);
    await instance.press(["g"]);
    body = await keys(["g"], scroll_is("g g to scroll to the top", (current) => current.scroll_y === 0));
    check(app, kind, `${where}: g g scrolls to the top`, body.scroll_y === 0, `scrollY ${body.scroll_y}`);
    if (!escape) return;
    // A count then Escape ends the count, so the next j is one line.
    await instance.press(["7"]);
    await instance.press(["-k", "Escape"]);
    body = await keys(["j"], scrolls_near(LINE_STEP_PX));
    check(app, kind, `${where}: Escape drops a pending count`, near(body.scroll_y, LINE_STEP_PX), `scrollY ${body.scroll_y}`);
    await instance.press(["g"]);
    await keys(["g"], scrolls_near(0));
    // Insert mode in the body: `i` shows INSERT, j reaches Thunderbird and does not scroll, Escape returns to NORMAL and j scrolls again.
    const label = insert_label(instance, ctx);
    const normal = await label.normal();
    const insert = await label.enter(normal);
    check(app, kind, `${where}: i changes the label to insert`, insert !== normal, `normal ${normal.slice(0, 8)}, insert ${insert.slice(0, 8)}`);
    // G is no Thunderbird key, so it reaches nothing here, and in normal mode it scrolls to the bottom.
    body = await keys(["G"], 1000);
    check(app, kind, `${where}: G in insert mode does not scroll`, body.scroll_y === 0, `scrollY ${body.scroll_y}`);
    check(app, kind, `${where}: Escape ends insert mode and the label returns`, (await label.leave(normal)) === normal);
    body = await keys(["G"], scroll_is("G to scroll to the bottom", (current) => near(current.scroll_y, current.scroll_height - current.inner_height)));
    check(app, kind, `${where}: G scrolls again after Escape`, near(body.scroll_y, body.scroll_height - body.inner_height), `scrollY ${body.scroll_y}`);
    await instance.press(["g"]);
    await keys(["g"], scrolls_near(0));
  };

  // `refocus_body` is for the reading pane, where the line returns the focus to the thread list and not to the message: the run then notes whether n moves, and presses F6 to put the focus in the body.
  const find_checks = async (where, { refocus_body = false } = {}) => {
    const body_after = async (args, wait) => body_state(await key_and_state(instance, args, wait));
    await instance.press(["/"]);
    await sleep(1500);
    await shot(`${where.replaceAll(" ", "_")}_find_line`, `${where} with the command line open, find typed in`);
    await instance.press(["marker"]);
    let body = await body_after(["-k", "Return"], scroll_is("find to select the first marker and scroll to it", (current) => current.selection === "marker" && current.scroll_y > current.inner_height));
    const first = body.scroll_y;
    check(app, kind, `${where}: find selects the first match and scrolls to it`, body.selection === "marker" && first > body.inner_height, `selection ${JSON.stringify(body.selection)}, scrollY ${first}, innerHeight ${body.inner_height}`);
    if (refocus_body) {
      // Whether n moves here is a measurement with no expected answer, so the wait stays fixed.
      body = await body_after(["n"], 1200);
      note(app, kind, `${where}: n right after the line closed`, `${body.scroll_y === first ? "did not move" : "moved"}: scrollY ${first} then ${body.scroll_y}`);
      await instance.press(["-k", "F6"]);
      await sleep(800);
    }
    body = await body_after(["n"], scroll_is("n to scroll to the second marker", (current) => current.selection === "marker" && current.scroll_y > first));
    const second = body.scroll_y;
    check(app, kind, `${where}: n goes to the next match`, body.selection === "marker" && second > first, `scrollY ${first} then ${second}`);
    body = await body_after(["n"], scrolls_near(first));
    check(app, kind, `${where}: n wraps from the last match to the first`, near(body.scroll_y, first), `scrollY ${body.scroll_y}, first match at ${first}`);
    body = await body_after(["N"], scrolls_near(second));
    check(app, kind, `${where}: N wraps from the first match to the last`, near(body.scroll_y, second), `scrollY ${body.scroll_y}, last match at ${second}`);
    body = await body_after(["N"], scrolls_near(first));
    check(app, kind, `${where}: N goes back to the first match`, near(body.scroll_y, first), `scrollY ${body.scroll_y}, first match at ${first}`);
    await shot(`${where.replaceAll(" ", "_")}_found`, `${where} with the match selected`);
    await instance.press(["g"]);
    await key_and_state(instance, ["g"], scrolls_near(0));
  };

  // The reading pane. j in the body scrolls and moves no row, r opens no compose window, and the list keeps its keys once focus returns.
  let state = await show_in_pane("reading-plain");
  const pane_message = first_selected(state);
  check(app, kind, "a message shows in the pane", pane_message === "reading-plain@fixture.invalid", `selected ${pane_message}`);
  await shot("pane_plain", "reading pane with the plain text message, body focused");
  await scroll_keys("pane plain text");
  // Thunderbird's own single-key shortcuts must not fire while the body script is live. `s` stars the message and `m` toggles its read state, and the helper reports both. A bare `r` would prove nothing: the message is already read. `f` is the hint key now, so it no longer proves the swallow.
  const starred_before = state.flags[pane_message]?.flagged;
  const read_before = state.flags[pane_message]?.read;
  state = await key_and_state(instance, ["s"], 1500);
  check(app, kind, "pane: s stars nothing, the body script swallows Thunderbird's single-key shortcuts", state.flags[pane_message]?.flagged === starred_before, `flagged ${starred_before} then ${state.flags[pane_message]?.flagged}`);
  state = await key_and_state(instance, ["m"], 1500);
  check(app, kind, "pane: m does not toggle the read state", state.flags[pane_message]?.read === read_before && first_selected(state) === pane_message, `read ${read_before} then ${state.flags[pane_message]?.read}, selected ${first_selected(state)}`);
  // Find: `/` opens the command line over the window, the typed text runs `find`, and the body script selects the match. n and N step with wrap, which also proves the focus went back into the message after the line closed.
  await find_checks("pane plain text", { refocus_body: true });
  state = await instance.ask("state");
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  state = await key_and_state(instance, ["j"], { what: "j to move the list selection off the shown message", until: (current) => first_selected(current) !== pane_message && first_selected(current) !== null, show: (current) => `selected ${first_selected(current)}` });
  check(app, kind, "pane: after focus returns to the list, j moves the list again", first_selected(state) !== pane_message && first_selected(state) !== null, `selected ${first_selected(state)}`);

  // The body script takes every key while the message pane has the focus, so g e and g f there ask the background to move the focus. Native Down tells which pane has it.
  state = await show_in_pane("reading-plain");
  await instance.press(["g"]);
  await instance.press(["e"]);
  await sleep(FOCUS_MOVE_MARGIN_MS);
  const list_row = first_selected(await instance.ask("state"));
  state = await key_and_state(instance, ["-k", "Down"], { what: "Down to move the list selection", until: (current) => first_selected(current) !== list_row && first_selected(current) !== null, show: (current) => `selected ${first_selected(current)}` });
  check(app, kind, "pane: g e in the message body focuses the thread list, so Down moves the selection", first_selected(state) !== list_row && first_selected(state) !== null, `selected ${list_row} then ${first_selected(state)}`);
  state = await show_in_pane("reading-plain");
  const folder_before = state.mail_tab?.folder;
  await instance.press(["g"]);
  await instance.press(["f"]);
  await sleep(FOCUS_MOVE_MARGIN_MS);
  state = await key_and_state(instance, ["-k", "Down"], { what: "Down to move the folder selection", until: (current) => current.mail_tab?.folder !== folder_before, show: (current) => `folder ${current.mail_tab?.folder}` });
  check(app, kind, "pane: g f in the message body focuses the folder pane, so Down moves the folder", state.mail_tab?.folder !== folder_before, `folder ${folder_before} then ${state.mail_tab?.folder}`);
  await key_and_state(instance, ["-k", "Up"], { what: "Up to move the folder selection back", until: (current) => current.mail_tab?.folder === folder_before, show: (current) => `folder ${current.mail_tab?.folder}` });
  // The checks below press F6 from the list, so put the focus back there.
  await instance.press(["g"]);
  await instance.press(["e"]);
  await sleep(FOCUS_MOVE_MARGIN_MS);

  // HTML mail, remote content and a sandboxed frame. The measurement the design asked for: does the script run there?
  for (const id of READING_FOLDER_MESSAGES.slice(1)) {
    await show_in_pane(id);
    await shot(`pane_${id}`, `reading pane with ${id}, body focused`);
    await scroll_keys(`pane ${id}`, { measure_only: true });
    await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  }

  // Hints: f labels the header and the links on screen in one set, the typed label opens a link in one step (the Experiment sends a trusted Enter), and the link target at the bottom of the mail scrolls into view.
  const body_links = BODY_LINK_LABELS[app];
  await show_in_pane("reading-html");
  let hint_body = body_state(await instance.ask("state"));
  check(app, kind, "hints: the html message starts at the top", hint_body.scroll_y === 0, `scrollY ${hint_body.scroll_y}`);
  await instance.press(["f"]);
  await sleep(800);
  await shot("hint_labels", "reading pane with the hint labels on the header and the links");
  // The label wears the theme: the box is the brand color of the scheme the message shows, and the fixed yellow of the fallback is gone.
  const { resolve_theme: message_theme } = await import("../../../src/background/theme/palette.ts");
  const { DEFAULT_THEME } = await import("../../../src/shared/theme_choice.ts");
  const message_colors = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_labels_raw`, "0,0 1280x720", "ppm"));
  const default_theme = message_theme(DEFAULT_THEME);
  check(app, kind, "hints: the message label is drawn in the theme color and not the fallback yellow", (message_colors.has(default_theme.dark.primary) || message_colors.has(default_theme.light.primary)) && !message_colors.has("#ffd33d"), `dark ${default_theme.dark.primary} ${message_colors.get(default_theme.dark.primary) ?? 0} px, light ${default_theme.light.primary} ${message_colors.get(default_theme.light.primary) ?? 0} px`);
  await instance.press([body_links.jump[0]]);
  hint_body = body_state(await key_and_state(instance, [body_links.jump[1]], scroll_is("the link label to scroll the page to the link target", (current) => current.scroll_y > 2 * current.inner_height)));
  check(app, kind, "hints: f then the link label opens the link in one step, so the page scrolls to its target", hint_body.scroll_y > 2 * hint_body.inner_height, `scrollY ${hint_body.scroll_y}, innerHeight ${hint_body.inner_height}`);
  // An external link whose text names another address. The pick sends a trusted Enter, so Thunderbird's own click handling runs and warns about such a link. The shot hint_external_pick shows the Link Mismatch dialog when it works, and the pane stays on the message. A script click skips the warning (see the probe below).
  const href_before = hint_body.href;
  const windows_before = (await instance.ask("state")).windows.length;
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], scrolls_near(0));
  await instance.press(["f"]);
  await sleep(800);
  await shot("hint_labels_two", "reading pane with the header labels and one label on each link");
  for (const letter of body_links.external) await instance.press([letter]);
  await sleep(2500);
  await shot("hint_external_pick", "reading pane after the one-step pick of the external link: the Link Mismatch dialog shows");
  state = await instance.ask("state");
  hint_body = body_state(state);
  note(app, kind, "hints: one-step pick of the external link", `windows ${windows_before} then ${state.windows.length}, ${JSON.stringify(state.windows.map((window) => window.type))}, document ${hint_body.href === href_before ? "unchanged" : hint_body.href}; read the shot: the Link Mismatch dialog must show`);
  check(app, kind, "hints: the one-step pick of the external link leaves the message in place", hint_body.href === href_before && hint_body.scroll_y < hint_body.inner_height, `document ${hint_body.href}, scrollY ${hint_body.scroll_y}`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  // The probe behind the one-step pick: the same external link, clicked by a script (the helper's content script runs click() as the body script does). A dialog in this shot, as in hint_external_pick, means click() keeps Thunderbird's link-mismatch check.
  const click_answer = await instance.ask("click_link", 20000, { text: "bank.example" });
  await sleep(2500);
  await shot("hint_external_click", "reading pane after a scripted click() on the external link");
  state = await instance.ask("state");
  note(app, kind, "hints: click() on the external link", `clicked ${click_answer.clicked}, windows ${JSON.stringify(state.windows.map((window) => window.type))}; read the shot: a Link Mismatch dialog means the check ran`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);

  // The mail keys run on the shown message while the body has the focus. m s flags it, and q hands the focus back to the thread list.
  const plain_id = "reading-plain@fixture.invalid";
  // wtype drops the second key of a pair typed in one call, so m and s go in two presses.
  const flag_keys = async (id, flagged) => {
    await instance.press(["m"]);
    return key_and_state(instance, ["s"], flag_becomes(id, "flagged", flagged));
  };
  const flagged_ids = (snapshot) => Object.entries(snapshot.flags).filter(([, flags]) => flags.flagged).map(([id]) => id);
  await show_in_pane("reading-plain");
  state = await flag_keys(plain_id, true);
  check(app, kind, "pane: m s flags the shown message", flagged_ids(state).includes(plain_id), `flagged ${JSON.stringify(flagged_ids(state))}`);
  await flag_keys(plain_id, false);
  const tabs_in_pane = main_window_tabs(state).length;
  state = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "pane: q closes no tab", main_window_tabs(state).length === tabs_in_pane, `tabs ${main_window_tabs(state).length}`);
  const selected_before_j = first_selected(state);
  state = await key_and_state(instance, ["j"], { what: "j to move the list selection", until: (current) => first_selected(current) !== selected_before_j && first_selected(current) !== null, show: (current) => `selected ${first_selected(current)}` });
  check(app, kind, "pane: after q the thread list has the focus, so j moves the selection", first_selected(state) !== selected_before_j, `selected ${selected_before_j} then ${first_selected(state)}`);
  await instance.press(["g"]);
  await instance.press(["e"]);
  await sleep(FOCUS_MOVE_MARGIN_MS);

  // A message tab: the message opens in a new tab and the keys go to it.
  await show_in_pane("reading-plain");
  const tab_requested = Date.now();
  await instance.ask("open_message_tab");
  state = await wait_for_state(instance, body_reports("the message tab", tab_requested, tab_document));
  check(app, kind, "a message tab opened", main_window_tabs(state).some((tab) => tab.type === "messageDisplay"), JSON.stringify(main_window_tabs(state).map((tab) => tab.type)));
  await shot("message_tab", "message in its own tab");
  await scroll_keys("message tab");
  await find_checks("message tab");
  // The tab shows reading-plain while the list selects another message, so a key that read the list would flag the wrong one.
  await instance.ask("select_tab", 20000, { index: 0 });
  await wait_for_state(instance, active_is(0));
  await instance.ask("select:reading-html@fixture.invalid", 30000);
  await wait_for_state(instance, selects("reading-html@fixture.invalid"));
  await instance.ask("select_tab", 20000, { index: 1 });
  await wait_for_state(instance, active_is(1));
  state = await flag_keys(plain_id, true);
  check(app, kind, "message tab: m s flags the message of the tab, not the list selection", flagged_ids(state).includes(plain_id) && !flagged_ids(state).includes("reading-html@fixture.invalid"), `flagged ${JSON.stringify(flagged_ids(state))}`);
  // u in the tab undoes the star it just set. g C opens the conversation of the displayed message: it needs the message in Thunderbird's search index, so the result is a note.
  state = await key_and_state(instance, ["u"], flag_becomes(plain_id, "flagged", false));
  check(app, kind, "message tab: u undoes the star", !flagged_ids(state).includes(plain_id), `flagged ${JSON.stringify(flagged_ids(state))}`);
  const tabs_before_conversation = main_window_tabs(state).length;
  await instance.press(["g"]);
  state = await key_and_state(instance, ["C"], 2500);
  note(app, kind, "message tab: g C", `tabs ${tabs_before_conversation} then ${main_window_tabs(state).length}; a new tab means the conversation opened, none means Thunderbird has the command disabled for this message`);
  await shot("message_tab_gC", "message tab after g C: no error notification about a missing mail tab");
  if (main_window_tabs(state).length > tabs_before_conversation) {
    // The conversation tab opened after the message tab. Close it so the tab count below stays one.
    await instance.ask("select_tab", 20000, { index: tabs_before_conversation });
    await wait_for_state(instance, active_is(tabs_before_conversation));
    await key_and_state(instance, ["q"], tab_count_is(tabs_before_conversation));
  }
  await instance.ask("select_tab", 20000, { index: 1 });
  await wait_for_state(instance, active_is(1));
  state = await key_and_state(instance, ["K"], active_is(0));
  check(app, kind, "message tab: K switches to the mail tab", active_index(state) === 0, `active ${active_index(state)}`);
  await instance.ask("select_tab", 20000, { index: 1 });
  await wait_for_state(instance, active_is(1));
  await instance.press(["t"]);
  state = await key_and_state(instance, ["0"], active_is(0));
  check(app, kind, "message tab: t 0 goes to the first tab", active_index(state) === 0, `active ${active_index(state)}`);
  await instance.ask("select_tab", 20000, { index: 1 });
  await wait_for_state(instance, active_is(1));
  state = await key_and_state(instance, ["q"], tab_count_is(1));
  check(app, kind, "message tab: q closes the tab", main_window_tabs(state).length === 1, `tabs left ${main_window_tabs(state).length}`);
  await instance.ask("reset_tabs");
  await wait_for_state(instance, { ...tab_count_is(1), until: (current) => main_window_tabs(current).length === 1 && active_index(current) === 0 });

  // A message window.
  await instance.ask("select:reading-plain@fixture.invalid", 30000);
  await wait_for_state(instance, selects("reading-plain@fixture.invalid"));
  const window_requested = Date.now();
  await instance.ask("open_message_window");
  state = await wait_for_state(instance, body_reports("the message window", window_requested, window_document));
  check(app, kind, "a message window opened", state.windows.some((window) => window.type === "messageDisplay"), JSON.stringify(state.windows.map((window) => window.type)));
  await shot("message_window", "message in its own window");
  await scroll_keys("message window", { escape: false });
  // Find in a message window: `/` opens the line, the find reaches the window's tab through `tabs.query({windowId, active: true})`, and n and N step with wrap, which also proves the line gave the focus back to the body. The line itself is the piece `message/window_cmdline`.
  await find_checks("message window");
  state = await flag_keys(plain_id, true);
  check(app, kind, "message window: m s flags the message of the window", flagged_ids(state).includes(plain_id), `flagged ${JSON.stringify(flagged_ids(state))}`);
  await flag_keys(plain_id, false);
  state = await key_and_state(instance, ["H"], 1500);
  check(app, kind, "message window: H changes nothing and the window stays", state.windows.some((window) => window.type === "messageDisplay"), JSON.stringify(state.windows.map((window) => window.type)));
  const message_window_id = state.windows.find((window) => window.type === "messageDisplay")?.id;
  const main_window_id = state.windows.find((window) => window.type === "normal")?.id;

  // The body runs the window tree, which leaves the pane chords to Thunderbird: Alt+H opens its Help menu. The message tree binds Alt+H to `pane.left`, so a body on that tree would swallow it and nothing would draw.
  const screen_before = await wait_pixels(instance, "the Help menu region to hold still before Alt+H", `${app}_${kind}_alt_h_before`, HELP_MENU_REGION, holds_twice(), { timeout_ms: 3000 });
  await instance.press(["-M", "alt", "h", "-m", "alt"]);
  const menu_drawn = await wait_pixels(instance, "Alt+H to open the Help menu", `${app}_${kind}_alt_h_after`, HELP_MENU_REGION, drawn_since(screen_before), { timeout_ms: 3000 });
  await shot("message_window_alt_h", "message window body after Alt+H: Thunderbird's Help menu is open");
  check(app, kind, "message window body runs the window tree: Alt+H, which only the message tree binds, reaches Thunderbird and opens its Help menu", menu_drawn !== screen_before);
  // Escape would leave the menu bar active, and with no menu it would close the window. The first click ends the menu, the second puts the focus back in the body.
  for (const _ of [1, 2]) {
    await instance.click(...MESSAGE_WINDOW_BODY_POINT);
    await sleep(500);
  }

  // A fresh report of the window's own document. A key in the header or a zoom moves nothing the report script listens to, and another window may have reported last.
  const fresh_body = (window_id, what, until = () => true) =>
    wait_for(
      instance,
      what,
      async () => {
        const since = Date.now();
        await instance.ask("report_window", 20000, { windowId: window_id });
        await sleep(200);
        const current = await instance.ask("state");
        return current.body?.window_id === window_id && (current.body.reported_at ?? 0) >= since ? current : { ...current, body: null };
      },
      (current) => current.body !== null && until(current.body),
      { soft: true, step_ms: 100 },
    );
  const press_each = async (keys) => {
    for (const key of keys) await instance.press([key]);
  };
  const tab_addresses = (current) => main_window_tabs(current).map((tab) => tab.raw?.url ?? tab.title ?? "");
  // Message mode keeps the keys that act on the window or open in the main window: zoom, new message, help, options and the Thunderbird pages. `refocus` puts the focus back where the keys ran once the main window or a compose window took it.
  const window_app_keys = async (where, pages, refocus) => {
    const zoom_start = body_state(await fresh_body(message_window_id, `a report of the ${where}`)).inner_height;
    // One press per key, as the zoom kind does: two keys in one wtype call ended the sequence after the first one in a message window.
    await press_each(["z", "i"]);
    let read = body_state(await fresh_body(message_window_id, `z i in the ${where} to zoom the message in`, (body) => body.inner_height < zoom_start));
    check(app, kind, `${where}: z i zooms the message in`, read.inner_height < zoom_start, `innerHeight ${zoom_start} then ${read.inner_height}`);
    await press_each(["z", "="]);
    read = body_state(await fresh_body(message_window_id, `z = in the ${where} to reset the zoom`, (body) => body.inner_height === zoom_start));
    check(app, kind, `${where}: z = resets the zoom`, read.inner_height === zoom_start, `innerHeight ${zoom_start} then ${read.inner_height}`);
    state = await key_and_state(instance, ["c"], window_of_type("messageCompose", true));
    check(app, kind, `${where}: c opens a new message`, state.windows.some((window) => window.type === "messageCompose"), JSON.stringify(state.windows.map((window) => window.type)));
    await instance.ask("close_compose");
    await wait_for_state(instance, window_of_type("messageCompose", false));
    await refocus();
    for (const [keys, page, is_page] of pages) {
      await press_each(keys.slice(0, -1));
      state = await key_and_state(instance, keys.slice(-1), { what: `${keys.join(" ")} in the ${where} to open the ${page} page in the main window`, until: (current) => tab_addresses(current).some(is_page) && current.windows.find((window) => window.id === main_window_id)?.focused === true, show: (current) => `main tabs ${tab_addresses(current).join(" ")}, windows ${JSON.stringify(current.windows.map((window) => [window.type, window.focused]))}`, timeout_ms: 15000 });
      check(app, kind, `${where}: ${keys.join(" ")} opens the ${page} page in a tab of the main window and brings that window to the front`, tab_addresses(state).some(is_page) && state.windows.find((window) => window.id === main_window_id)?.focused === true, `main tabs ${tab_addresses(state).join(" ")}`);
      await instance.ask("reset_tabs");
      await wait_for_state(instance, tab_count_is(1));
      await refocus();
    }
  };
  const is_own_page = (fragment) => (address) => address.startsWith("moz-extension:") && address.includes(fragment);
  const focus_message_window = async () => {
    await instance.ask("focus_window", 20000, { windowId: message_window_id });
    await sleep(800);
  };
  await window_app_keys("message window body", [[["g", "?"], "help", is_own_page("help/help.html")], [[",", "s"], "options", is_own_page("options")], [["g", "p", "c"], "config", (address) => address === "about:config"]], focus_message_window);

  // The header of the window runs the same message mode keys, from the pages bundle. F6 takes the focus out of the body. Only a report sent after F6 counts.
  const header_focus = async (where, window_id) => {
    const f6_at = Date.now();
    await instance.press(["-k", "F6"]);
    const focused = await wait_for_state(instance, body_focus_is(false, f6_at, window_id));
    check(app, kind, `${where}: F6 takes the focus out of the body`, body_state(focused).window_id === window_id && body_state(focused).has_focus === false, `has_focus ${body_state(focused).has_focus}`);
    return focused;
  };
  await header_focus("message window", message_window_id);
  await shot("message_window_header_focus", "message window after F6: the focus sits in the header");
  const header_top = body_state(await instance.ask("state")).scroll_y;
  state = await key_and_state(instance, ["j"], scroll_is("j in the header to scroll the body", (current) => current.scroll_y > header_top));
  check(app, kind, "message window header: j scrolls the body", body_state(state).scroll_y > header_top, `scrollY ${header_top} then ${body_state(state).scroll_y}`);
  state = await flag_keys(plain_id, true);
  check(app, kind, "message window header: m s flags the message of the window", flagged_ids(state).includes(plain_id), `flagged ${JSON.stringify(flagged_ids(state))}`);
  await flag_keys(plain_id, false);
  const header_scroll = body_state(await instance.ask("state")).scroll_y;
  for (const key of ["/", "H", "n", "N"]) await instance.press([key]);
  await sleep(1500);
  state = await instance.ask("state");
  await shot("message_window_header_unbound", "message window header after /, H, n and N: nothing changed, no notification, no command line");
  check(app, kind, "message window header: /, H, n and N do nothing and the window stays", state.windows.some((window) => window.type === "messageDisplay") && body_state(state).scroll_y === header_scroll, `windows ${JSON.stringify(state.windows.map((window) => window.type))}, scrollY ${header_scroll} then ${body_state(state).scroll_y}`);
  // The main window and a compose window take the focus from the header. The window gives it back to the header, else F6 moves it there again.
  const focus_header = async () => {
    await focus_message_window();
    if (body_state(await fresh_body(message_window_id, "a report of the message window after it took the focus back")).has_focus !== false) await header_focus("message window again", message_window_id);
  };
  await window_app_keys("message window header", [[[",", "h"], "help", is_own_page("help/help.html")], [[",", "?"], "help", is_own_page("help/help.html")], [["g", "p", "a"], "add-ons", (address) => address === "about:addons"], [["g", "p", "t"], "themes", (address) => address === "about:addons"]], focus_header);

  // A second message window. Both hook the same pages bundle, which keeps one half-typed sequence: g in one window and g in the other must not make g g.
  const first_window_id = state.windows.find((window) => window.type === "messageDisplay")?.id;
  // The helper selects in the mail tab of the focused window, so the main window takes the focus first.
  await instance.ask("focus_window", 20000, { windowId: state.windows.find((window) => window.type === "normal")?.id });
  await sleep(800);
  await instance.ask("select:reading-html@fixture.invalid", 30000);
  await wait_for_state(instance, selects("reading-html@fixture.invalid"));
  const second_requested = Date.now();
  await instance.ask("open_message_window");
  state = await wait_for_state(instance, body_reports("the second message window", second_requested, (current, body) => body.window_id !== first_window_id && current.windows.some((window) => window.id === body.window_id && window.type === "messageDisplay")));
  const second_window_id = state.body.window_id;
  check(app, kind, "two message windows open", state.windows.filter((window) => window.type === "messageDisplay").length === 2, JSON.stringify(state.windows.map((window) => window.type)));
  await header_focus("second message window", second_window_id);
  for (const _ of [1, 2, 3]) await instance.press(["j"]);
  state = await wait_for_state(instance, scroll_is("j j j to scroll the second window", (body) => body.window_id === second_window_id && body.scroll_y > 0));
  const second_scroll = body_state(state).scroll_y;
  await instance.ask("focus_window", 20000, { windowId: first_window_id });
  await sleep(800);
  await instance.press(["g"]);
  await instance.ask("focus_window", 20000, { windowId: second_window_id });
  await sleep(800);
  await instance.press(["g"]);
  await sleep(1000);
  await shot("message_windows_g_g", "the second message window after g in the first window and g in this one: still scrolled");
  state = await fresh_body(second_window_id, "a report of the second message window after g in each window");
  check(app, kind, "two message windows: g in one and g in the other make no g g", body_state(state).window_id === second_window_id && body_state(state).scroll_y === second_scroll, `window ${body_state(state).window_id}, scrollY ${second_scroll} then ${body_state(state).scroll_y}`);
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], scroll_is("g g in the second window to its top", (body) => body.window_id === second_window_id && body.scroll_y === 0));
  check(app, kind, "two message windows: g g in the second window goes to its top", body_state(state).scroll_y === 0, `scrollY ${body_state(state).scroll_y}`);
  state = await key_and_state(instance, ["q"], { what: "q in the header to close the second window", until: (current) => !current.windows.some((window) => window.id === second_window_id), show: (current) => JSON.stringify(current.windows.map((window) => window.type)), timeout_ms: 10000 });
  check(app, kind, "message window header: q closes the window", !state.windows.some((window) => window.id === second_window_id) && state.windows.some((window) => window.id === first_window_id), JSON.stringify(state.windows.map((window) => [window.id, window.type])));
  await instance.ask("focus_window", 20000, { windowId: first_window_id });
  await sleep(800);
  state = await key_and_state(instance, ["q"], window_of_type("messageDisplay", false));
  check(app, kind, "message window: q closes the window", !state.windows.some((window) => window.type === "messageDisplay"), JSON.stringify(state.windows.map((window) => window.type)));

  // A key right after the window opens, before about:message or the body may be ready: it is taken or lost, and the window keeps working.
  await instance.ask("select:reading-plain@fixture.invalid", 30000);
  await wait_for_state(instance, selects("reading-plain@fixture.invalid"));
  const early_requested = Date.now();
  await instance.ask("open_message_window");
  await instance.press(["j"]);
  state = await wait_for_state(instance, body_reports("the message window opened with a key", early_requested, window_document));
  const early_top = body_state(state).scroll_y;
  state = await key_and_state(instance, ["j"], scroll_is("j in the new window", (body) => body.scroll_y > early_top));
  check(app, kind, "message window: a key right after the window opens breaks nothing, and j then scrolls", body_state(state).scroll_y > early_top && instance.exited() === null, `scrollY ${early_top} then ${body_state(state).scroll_y}`);
  await instance.ask("close_message_windows");
  await wait_for_state(instance, window_of_type("messageDisplay", false));
  check(app, kind, "the app survived", instance.exited() === null);
}

// The header labels come first, so the two links of reading-html take the last two labels: Reply, Reply All, Forward, Archive, Spam, Delete, Headers (Betterbird only), More, the star, the sender and the recipient, then the links. Read from the shots of each app.

const BODY_LINK_LABELS = { betterbird: { jump: "sd", external: "sf" }, thunderbird: { jump: "ss", external: "sd" } };

export const pieces = ["message", "message_remote"].map((kind) => ({
  kind,
  section: "main",
  deadline_s: LONG_PIECE_DEADLINE_S,
  run: (instance, ctx) => run_message_scripts(instance, ctx),
}));
