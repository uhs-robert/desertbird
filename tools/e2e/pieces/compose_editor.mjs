// The external editor kinds: a fake editor behind the native host rewrites the scratch file. Plain text, and Markdown with the reply below or above the quote.

import { existsSync } from "node:fs";
import { sleep, HUD_REGION, drawn_since, compose_opens, compose_tab, reply_is_loaded, mail_window_ready, selects_inbox_s2 } from "../predicates.mjs";
import { EDITED_TEXT, DESERTFOX_HOST, COMPOSE_EDITOR_HTML_KINDS, install_editor_host } from "../seed.mjs";

export const areas = ["compose", "mode_label"];

// A 1x1 PNG for the draft image measurement.
const PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The chrome runtime draws the mode label in the status bar, so it shows once the runtime hooks the window. Ctrl+E before that goes to the editor itself and is lost. A stretch of the bar of the same size shows what the region draws with no label.
const COMPOSE_LABEL_REGION = "980,696 90x22";
const COMPOSE_BLANK_REGION = "600,696 90x22";

async function wait_compose_script(instance, { hud_pixels, wait_pixels }) {
  const blank = await hud_pixels(instance, `${instance.app}_compose_blank`, COMPOSE_BLANK_REGION);
  return wait_pixels(instance, "the compose window to draw its mode label", `${instance.app}_compose_label`, COMPOSE_LABEL_REGION, (hash) => hash !== blank, { timeout_ms: 10000 });
}

async function run_compose_editor_html(instance, ctx) {
  const { report, check, note, key_and_state, close_compose } = ctx;
  const app = instance.app;
  const kind = instance.kind;
  if (!existsSync(DESERTFOX_HOST)) {
    note(app, kind, "external editor not run", `no DesertFox host at ${DESERTFOX_HOST}; set E2E_DESERTFOX_HOST`);
    return;
  }
  const edited_html_checks = (label, html) => {
    check(app, kind, `${label}: the Markdown came back as HTML`, html.includes("<strong>Edited</strong> by the e2e editor."), `html ${JSON.stringify(html)}`);
    check(app, kind, `${label}: no event handler, script URL or live tag from the Markdown`, !/onerror|javascript:|<b>kept/i.test(html) && html.includes("&lt;b&gt;kept as text&lt;/b&gt;"), `html ${JSON.stringify(html)}`);
  };
  const edit_in = async (label) => {
    await wait_compose_script(instance, ctx);
    const state = await key_and_state(instance, ["-M", "ctrl", "e", "-m", "ctrl"], compose_opens((tab) => (tab.html ?? "").includes("<strong>Edited</strong>")));
    report.shots.push({ app, kind, path: await instance.shot(`${app}_${kind}_${label}`), name: `${kind}_${label}`, line: `HTML compose window after Ctrl+E (${label})` });
    return compose_tab(state)?.html ?? "";
  };
  let state = await reply_to_inbox_s2(instance, ctx, { focus_list: true });
  const reply_before = compose_tab(state)?.html ?? "";
  check(app, kind, "r opens an HTML reply", compose_tab(state)?.is_plain === false, `isPlainText ${compose_tab(state)?.is_plain}`);
  note(app, kind, "HTML reply body before the editor", JSON.stringify(reply_before));
  const reply_after = await edit_in("reply");
  note(app, kind, "HTML reply body after the editor", JSON.stringify(reply_after));
  edited_html_checks("reply", reply_after);
  const at_text = reply_after.indexOf("<strong>Edited");
  const at_quote = reply_after.indexOf('<blockquote type="cite"');
  const at_signature = reply_after.indexOf("E2E signature line");
  check(app, kind, "reply: the quote and the signature survive", at_quote >= 0 && at_signature >= 0 && reply_after.includes("Body of inbox-s2."), `quote at ${at_quote}, signature at ${at_signature}`);
  // Below means past the end of the quote, so text written inside the quote fails.
  const at_quote_end = reply_after.indexOf("</blockquote>");
  const placed = COMPOSE_EDITOR_HTML_KINDS[kind] === "below" ? at_text > at_quote_end && at_text < at_signature : at_text < at_quote && at_text < at_signature;
  check(app, kind, `reply: the text sits ${COMPOSE_EDITOR_HTML_KINDS[kind]} the quote where Thunderbird put the cursor`, at_text >= 0 && placed, `text at ${at_text}, quote at ${at_quote}, signature at ${at_signature}`);
  await close_compose(instance);
  if (COMPOSE_EDITOR_HTML_KINDS[kind] === "below") await note_draft_image(instance, ctx);
  state = await instance.ask("state");
  check(app, kind, "the app survived the HTML editor", instance.exited() === null && !state.windows.some((window) => window.type === "messageCompose"));
}

async function run_compose_editor(instance, ctx) {
  const { report, check, note, key_and_state, close_compose } = ctx;
  const app = instance.app;
  const kind = instance.kind;
  if (!existsSync(DESERTFOX_HOST)) {
    note(app, kind, "external editor not run", `no DesertFox host at ${DESERTFOX_HOST}; set E2E_DESERTFOX_HOST`);
    return;
  }
  // A reply puts the focus in the body, where the compose script listens.
  let state = await reply_to_inbox_s2(instance, ctx, { focus_list: true });
  const before = compose_tab(state)?.body ?? "";
  check(app, kind, "r opens a plain-text reply for the editor", compose_tab(state)?.is_plain === true && !before.includes(EDITED_TEXT), `isPlainText ${compose_tab(state)?.is_plain}, body ${JSON.stringify(before)}`);
  const body_of = (state) => compose_tab(state)?.body ?? "";
  // The editor runs outside the app and writes its text into the body, so the body is the sign that it finished.
  const editor_wrote_text = compose_opens((tab) => (tab.body ?? "").trim() === EDITED_TEXT);
  await wait_compose_script(instance, ctx);
  state = await key_and_state(instance, ["-M", "ctrl", "e", "-m", "ctrl"], editor_wrote_text);
  const after = compose_tab(state)?.body ?? "";
  check(app, kind, "Ctrl+E runs the editor through desertbird_host and writes its text into the body", after.trim() === EDITED_TEXT, `body ${JSON.stringify(after)}`);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_after_ctrl_e`), name: "after_ctrl_e", line: "compose window with the text of the fake editor" });
  await close_compose(instance);

  // Normal mode. Each entry into the body is a fresh reply, so the fake editor's text shows only when `e` ran it.
  const reply_again = () => reply_to_inbox_s2(instance, ctx);
  const body_grows = (before) => compose_opens((tab) => (tab.body ?? "").length > before.length);
  state = await reply_again();
  const plain_body = body_of(state);
  state = await key_and_state(instance, ["e"], body_grows(plain_body));
  check(app, kind, "e in insert mode types an e and runs no editor", body_of(state) === `e${plain_body}` || body_of(state).length === plain_body.length + 1, `body ${JSON.stringify(body_of(state))}`);
  await instance.press(["-k", "Escape"]);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_normal_label`), name: "normal_label", line: "compose window after Escape, label reads NORMAL" });
  const body_before_x = body_of(state);
  await instance.press(["x"]);
  await instance.press(["-k", "Return"]);
  await sleep(800);
  state = await instance.ask("state");
  check(app, kind, "a letter and Enter typed in normal mode leave the body unchanged", body_of(state) === body_before_x, `body ${JSON.stringify(body_of(state))}`);
  const body_before_tab = body_of(state);
  await instance.press(["-k", "Tab"]);
  await instance.press(["-M", "shift", "-k", "Tab", "-m", "shift"]);
  await sleep(800);
  check(app, kind, "Tab and Shift+Tab in normal mode leave the body unchanged", body_of(await instance.ask("state")) === body_before_tab, `body ${JSON.stringify(body_of(await instance.ask("state")))}`);
  await instance.press(["i"]);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_insert_label`), name: "insert_label", line: "compose window back in insert mode after i, label reads INSERT" });
  state = await key_and_state(instance, ["x"], body_grows(body_before_x));
  check(app, kind, "i returns to typing and the next letter types", body_of(state).includes("x"), `body ${JSON.stringify(body_of(state))}`);
  await instance.press(["-k", "Escape"]);
  state = await key_and_state(instance, ["e"], editor_wrote_text);
  check(app, kind, "Escape then e runs the editor and keeps the compose window open", body_of(state).trim() === EDITED_TEXT, `body ${JSON.stringify(body_of(state))}`);
  await close_compose(instance);

  // A quoted reply opens in insert mode, so the first typed letter reaches it.
  state = await reply_again();
  const fresh_body = body_of(state);
  state = await key_and_state(instance, ["s"], body_grows(fresh_body));
  check(app, kind, "a window that opens on a reply with quoted text types in insert mode", body_of(state).includes("s"), `body ${JSON.stringify(body_of(state))}`);
  await close_compose(instance);

  // s saves a draft and leaves the window open and in normal mode.
  state = await reply_again();
  const drafts_in = (state) => Object.entries(state.folders ?? {}).filter(([path]) => /Draft/i.test(path)).reduce((count, [, list]) => count + (Array.isArray(list) ? list.length : 0), 0);
  const drafts_before = drafts_in(state);
  await instance.press(["-k", "Escape"]);
  state = await key_and_state(instance, ["s"], { what: "a saved draft", until: (state) => drafts_in(state) > drafts_before, timeout_ms: 15000 });
  check(app, kind, "s in normal mode saves a draft and keeps the window open", drafts_in(state) === drafts_before + 1 && state.windows.some((window) => window.type === "messageCompose"), `drafts ${drafts_before} -> ${drafts_in(state)}`);
  // A draft save moves the focus in Thunderbird. The mode does not depend on focus, so a letter typed after it is still cancelled.
  await sleep(2500);
  const body_after_save = body_of(await instance.ask("state"));
  await instance.press(["x"]);
  await sleep(800);
  check(app, kind, "after the draft save the window stays in normal mode and a letter does not type", body_of(await instance.ask("state")) === body_after_save, `body ${JSON.stringify(body_of(await instance.ask("state")))}`);
  // Ctrl+S is Thunderbird's own save and moves the focus the same way, so normal mode must hold through it too.
  await instance.press(["-M", "ctrl", "s", "-m", "ctrl"]);
  await sleep(2500);
  await instance.press(["x"]);
  await sleep(800);
  check(app, kind, "after Ctrl+S in normal mode a letter still does not type", body_of(await instance.ask("state")) === body_after_save, `body ${JSON.stringify(body_of(await instance.ask("state")))}`);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_after_save`), name: "after_save", line: "compose window after s and a typed letter, label still reads NORMAL" });

  // The zoom keys work from normal mode: the body text grows, so the pixels of its region change.
  const zoom_region = "20,150 400x200";
  const before_zoom = await ctx.hud_pixels(instance, `${app}_compose_zoom_before`, zoom_region);
  await instance.press(["z"]);
  await instance.press(["m"]);
  const after_zoom = await ctx.wait_pixels(instance, "the compose body to zoom", `${app}_compose_zoom_after`, zoom_region, (hash) => hash !== before_zoom, { timeout_ms: 5000 });
  check(app, kind, "z m in normal mode zooms the compose body", after_zoom !== before_zoom);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_zoomed`), name: "zoomed", line: "compose window after z m" });
  await instance.press(["z"]);
  await instance.press(["="]);
  await close_compose(instance);

  // The draft that holds the editor's text must hold no label either.
  state = await reply_again();
  await instance.press(["-k", "Escape"]);
  state = await key_and_state(instance, ["e"], editor_wrote_text);

  // The label must not reach the body or a saved draft.
  await instance.press(["-k", "Escape"]);
  const draft = await instance.ask("save_draft_raw", 30000);
  state = await instance.ask("state");
  const label_pattern = /-- (INSERT|NORMAL) --/;
  await instance.press(["-M", "shift", "-k", "Tab", "-m", "shift"]);
  await sleep(500);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_unfocused_label`), name: "unfocused_label", line: "compose window with focus out of the body, no label" });
  check(app, kind, "the mode label is in neither the body nor the saved draft", !label_pattern.test(compose_tab(state)?.html ?? "") && !label_pattern.test(body_of(state)) && !label_pattern.test(draft.raw ?? "") && (draft.raw ?? "").includes(EDITED_TEXT), `draft ${JSON.stringify((draft.raw ?? "").slice(-300))}`);
  await close_compose(instance);
  // ? opens the help page in a tab of the main window, since the compose window has no tab bar.
  state = await reply_again();
  await instance.press(["-k", "Escape"]);
  const main_tabs = (state) => state.windows.find((window) => window.type === "normal")?.tabs.length ?? 0;
  const tabs_before = main_tabs(await instance.ask("state"));
  state = await key_and_state(instance, ["?"], { what: "the help tab in the main window", until: (state) => main_tabs(state) > tabs_before, timeout_ms: 8000 });
  check(app, kind, "? in normal mode opens the help page in the main window", main_tabs(state) > tabs_before, `tabs ${tabs_before} -> ${main_tabs(state)}`);
  await close_compose(instance);
  state = await instance.ask("state");
  check(app, kind, "the app survived the external editor", instance.exited() === null && !state.windows.some((window) => window.type === "messageCompose"));
}

// Puts the focus in the thread list, selects inbox-s2 and presses `r`. Returns the state once the reply has loaded.
async function reply_to_inbox_s2(instance, ctx, { focus_list = false } = {}) {
  const { wait_for_state, key_and_state } = ctx;
  if (focus_list) {
    await wait_for_state(instance, mail_window_ready);
    await instance.press(["-k", "F6"]);
  }
  await instance.ask("select:inbox-s2@fixture.invalid", 30000);
  await wait_for_state(instance, selects_inbox_s2);
  return key_and_state(instance, ["r"], compose_opens(reply_is_loaded));
}

async function note_draft_image(instance, ctx) {
  const { note } = ctx;
  const image = `<img src="data:image/png;filename=pixel.png;base64,${PIXEL_PNG_BASE64}" alt="pixel">`;
  const reopened = await instance.ask("draft_round_trip", 30000, { body: `<html><body><p>Image draft.</p>${image}</body></html>` });
  const image_tags = [...(reopened.body ?? "").matchAll(/<img[^>]*>/g)].map((match) => match[0].replace(/base64,[^"]{40,}/, "base64,..."));
  note(instance.app, instance.kind, "src of an embedded image in a saved draft opened again", JSON.stringify(image_tags) + (reopened.body?.startsWith("error") ? ` ${reopened.body}` : ""));
  await instance.ask("close_compose");
}

// The compose window hook: the keys of the chrome runtime in the body, To, Cc, Bcc and Subject. The mode label sits in the status bar, so its pixels (the region below) change between INSERT and NORMAL.
const STATUS_LABEL_REGION = COMPOSE_LABEL_REGION;
const FIND_REGION = "210,630 860x66";
// The body's context menu opened by Shift+F10 in the reply of the fixture (read from the shots), and the key that opens it.
const CONTEXT_MENU_REGION = "225,355 235x295";
const SHIFT_F10 = ["-M", "shift", "-k", "F10", "-m", "shift"];
// The middle of the window, where the save prompt of `q` draws.
const PROMPT_REGION = "340,300 600x140";

async function run_compose_window(instance, ctx) {
  const { report, check, note, key_and_state, close_compose, hud_pixels, wait_pixels } = ctx;
  const app = instance.app;
  const kind = instance.kind;
  // The compose window hook is measured and tested on Betterbird alone.
  if (app !== "betterbird") {
    note(app, kind, "compose window keys not run", "measured on Betterbird only");
    return;
  }
  const body_of = (state) => compose_tab(state)?.body ?? "";
  const field_of = (name) => (state) => compose_tab(state)?.[name];
  const compose_open = (state) => state.windows.some((window) => window.type === "messageCompose");
  const type_text = async (text) => {
    for (const character of text) await instance.press([character]);
  };
  const settle_ms = 2500;
  const shot = async (name, line) => report.shots.push({ app, kind, path: await instance.shot(`${app}_${kind}_${name}`), name: `${kind}_${name}`, line });
  const jump = async (letter) => {
    await instance.press(["g"]);
    await instance.press([letter]);
    await sleep(700);
  };
  const waits_for = (what, until) => ({ what, until, timeout_ms: 8000 });
  await instance.ask("make_contacts");

  let state = await reply_to_inbox_s2(instance, ctx, { focus_list: true });
  await sleep(settle_ms);
  await shot("opened", "compose window right after the reply opened");
  const insert_pixels = await hud_pixels(instance, `${app}_status_insert`, STATUS_LABEL_REGION);
  await instance.press(["-k", "Escape"]);
  const normal_pixels = await wait_pixels(instance, "the status bar label to read NORMAL", `${app}_status_normal`, STATUS_LABEL_REGION, (hash) => hash !== insert_pixels, { timeout_ms: 5000 });
  check(app, kind, "Escape in the body draws a NORMAL label in the status bar", normal_pixels !== insert_pixels);
  await shot("normal_label", "status bar label reads NORMAL after Escape");
  await instance.press(["i"]);
  const back_pixels = await wait_pixels(instance, "the status bar label to read INSERT", `${app}_status_back`, STATUS_LABEL_REGION, (hash) => hash === insert_pixels, { timeout_ms: 5000 });
  check(app, kind, "i brings the INSERT label back", back_pixels === insert_pixels);
  await instance.press(["-k", "Escape"]);

  // The which-key panel of the hud draws in the compose window: g is a prefix key, so the panel lists g t, g c and the rest after the delay, and Escape ends it.
  await wait_pixels(instance, "the status bar label to read NORMAL again", `${app}_compose_panel_label`, STATUS_LABEL_REGION, (hash) => hash === normal_pixels, { timeout_ms: 5000 });
  const panel_bare = await hud_pixels(instance, `${app}_compose_panel_bare`, HUD_REGION);
  await instance.press(["g"]);
  const panel_shown = await wait_pixels(instance, "the which-key panel to draw in the compose window", `${app}_compose_panel_shown`, HUD_REGION, drawn_since(panel_bare), { timeout_ms: 8000 });
  check(app, kind, "g in normal mode draws the which-key panel in the compose window", panel_shown !== panel_bare);
  await shot("which_key", "the which-key panel after g in a compose window");
  await instance.press(["-k", "Escape"]);
  const panel_gone = await wait_pixels(instance, "the which-key panel to go", `${app}_compose_panel_gone`, HUD_REGION, (hash) => hash === panel_bare, { timeout_ms: 5000 });
  check(app, kind, "Escape after g removes the which-key panel of the compose window", panel_gone === panel_bare);
  // g ? shows the root keys of the compose tree at once and the next key ends the panel.
  await instance.press(["g"]);
  await instance.press(["?"]);
  const root_shown = await wait_pixels(instance, "the root key panel to draw in the compose window", `${app}_compose_root_shown`, HUD_REGION, drawn_since(panel_bare), { timeout_ms: 8000 });
  check(app, kind, "g ? draws the root key panel in the compose window", root_shown !== panel_bare);
  await shot("which_key_root", "the root key panel after g ? in a compose window");
  await instance.press(["-k", "Escape"]);
  const root_gone = await wait_pixels(instance, "the root key panel to go", `${app}_compose_root_gone`, HUD_REGION, (hash) => hash === panel_bare, { timeout_ms: 5000 });
  check(app, kind, "Escape removes the root key panel of the compose window", root_gone === panel_bare);

  // Jumps. Each one leaves normal mode for insert, so the field takes typing at once. Escape then makes normal mode in that field.
  await jump("s");
  state = await key_and_state(instance, ["Z"], waits_for("Z in the Subject", (state) => (field_of("subject")(state) ?? "").includes("Z")));
  check(app, kind, "gs jumps to the Subject in insert mode, so the first letter types", (field_of("subject")(state) ?? "").includes("Z"), `subject ${JSON.stringify(field_of("subject")(state))}`);
  const jump_label = await hud_pixels(instance, `${app}_status_after_jump`, STATUS_LABEL_REGION);
  check(app, kind, "the label reads INSERT after a jump", jump_label === insert_pixels);
  await instance.press(["-k", "Escape"]);
  const subject_before = field_of("subject")(await instance.ask("state"));
  await type_text("xj");
  await sleep(500);
  check(app, kind, "letters in normal mode leave the Subject unchanged", field_of("subject")(await instance.ask("state")) === subject_before, `subject ${JSON.stringify(field_of("subject")(await instance.ask("state")))}`);
  await instance.press(["i"]);
  state = await key_and_state(instance, ["W"], waits_for("W in the Subject", (state) => (field_of("subject")(state) ?? "").includes("W")));
  check(app, kind, "i in the Subject returns to typing", (field_of("subject")(state) ?? "").includes("W") && !(field_of("subject")(state) ?? "").includes("xj"), `subject ${JSON.stringify(field_of("subject")(state))}`);
  await instance.press(["-k", "Escape"]);

  await jump("t");
  await type_text("zed@fixture.invalid,");
  state = await key_and_state(instance, ["-k", "Escape"], waits_for("a pill in To", (state) => (field_of("to")(state) ?? []).join(" ").includes("zed@fixture.invalid")));
  await type_text("xj");
  await instance.press(["i"]);
  await type_text("yan@fixture.invalid,");
  state = await key_and_state(instance, ["-k", "Escape"], waits_for("a second pill in To", (state) => (field_of("to")(state) ?? []).join(" ").includes("yan@fixture.invalid")));
  const to_list = (field_of("to")(state) ?? []).join(" ");
  check(app, kind, "gt types an address in To at once, and letters in normal mode type nothing there", to_list.includes("zed@fixture.invalid") && to_list.includes("yan@fixture.invalid") && !to_list.includes("xj"), `to ${JSON.stringify(to_list)}`);
  await shot("to_pill", "To holds the typed addresses as pills");

  await jump("c");
  await type_text("cee@fixture.invalid,");
  state = await key_and_state(instance, ["-k", "Escape"], waits_for("a pill in Cc", (state) => (field_of("cc")(state) ?? []).length > 0));
  check(app, kind, "gc reveals Cc and types there at once", (field_of("cc")(state) ?? []).join(" ").includes("cee@fixture.invalid"), `cc ${JSON.stringify(field_of("cc")(state))}`);
  await jump("b");
  await type_text("bee@fixture.invalid,");
  state = await key_and_state(instance, ["-k", "Escape"], waits_for("a pill in Bcc", (state) => (field_of("bcc")(state) ?? []).length > 0));
  check(app, kind, "gb reveals Bcc and types there at once", (field_of("bcc")(state) ?? []).join(" ").includes("bee@fixture.invalid"), `bcc ${JSON.stringify(field_of("bcc")(state))}`);
  await shot("cc_bcc", "Cc and Bcc rows revealed with a pill each");

  await jump("m");
  state = await key_and_state(instance, ["Y"], waits_for("Y in the body", (state) => body_of(state).includes("Y")));
  check(app, kind, "gm focuses the body in insert mode, so the first letter types", body_of(state).includes("Y"), `body ${JSON.stringify(body_of(state))}`);
  await instance.press(["-k", "Escape"]);
  const body_before = body_of(await instance.ask("state"));
  await type_text("xj");
  await sleep(500);
  check(app, kind, "letters in normal mode leave the body unchanged", body_of(await instance.ask("state")) === body_before);

  // The body's context menu in normal mode and in insert mode: the menu is open, so j and k move its selection and neither types nor runs a mode key. The pixels of the menu region follow j, j, k as they do in the mail window.
  const context_menu_keys = async (mode) => {
    await instance.press(SHIFT_F10);
    await sleep(1000);
    const menu_before = await hud_pixels(instance, `${app}_context_${mode}_before`, CONTEXT_MENU_REGION);
    const body_open = body_of(await instance.ask("state"));
    await instance.press(["j"]);
    await sleep(500);
    const after_j = await hud_pixels(instance, `${app}_context_${mode}_after_j`, CONTEXT_MENU_REGION);
    await instance.press(["j"]);
    await sleep(500);
    const after_jj = await hud_pixels(instance, `${app}_context_${mode}_after_jj`, CONTEXT_MENU_REGION);
    await instance.press(["k"]);
    await sleep(500);
    const after_jjk = await hud_pixels(instance, `${app}_context_${mode}_after_jjk`, CONTEXT_MENU_REGION);
    await shot(`context_menu_${mode}`, `the body's context menu in ${mode} mode after j, j and k`);
    check(app, kind, `the body's context menu in ${mode} mode: j moves the selection down and k back up`, after_j !== menu_before && after_jj !== after_j && after_jjk === after_j);
    await instance.press(["-k", "Escape"]);
    await sleep(700);
    check(app, kind, `the body's context menu in ${mode} mode: j and k type nothing in the body`, body_of(await instance.ask("state")) === body_open);
  };
  await context_menu_keys("normal");
  await instance.press(["i"]);
  await context_menu_keys("insert");
  await instance.press(["-k", "Escape"]);

  // The find bar is no header field: in normal mode its field takes typing, and Escape closes it and keeps the mode.
  const find_before = await hud_pixels(instance, `${app}_find_before`, FIND_REGION);
  await instance.press(["-M", "ctrl", "f", "-m", "ctrl"]);
  await sleep(1000);
  const find_open = await hud_pixels(instance, `${app}_find_open`, FIND_REGION);
  await type_text("abc");
  await sleep(500);
  await shot("find_bar", "the find bar open with abc typed in normal mode");
  const find_typed = await hud_pixels(instance, `${app}_find_typed`, FIND_REGION);
  check(app, kind, "Ctrl+F in normal mode opens the find bar and its field takes typing", find_open !== find_before && find_typed !== find_open);
  await instance.press(["-k", "Escape"]);
  const find_closed = await wait_pixels(instance, "the find bar to close on Escape", `${app}_find_closed`, FIND_REGION, (hash) => hash === find_before, { timeout_ms: 5000 });
  check(app, kind, "Escape in the find bar closes it", find_closed === find_before);

  // The address popup: Escape closes it first and keeps insert mode, the next Escape enters normal mode.
  await jump("t");
  await type_text("ali");
  await sleep(2000);
  await shot("popup_open", "the address popup open under To");
  // A j typed with the popup open is text: the popup keeps its focus in the field, so the menu keys leave it alone. The contact Alijah keeps the popup open after the j.
  await type_text("j");
  await instance.press(["-k", "Escape"]);
  await sleep(700);
  await shot("popup_closed", "the address popup closed by the first Escape");
  await type_text("x@fixture.invalid,");
  state = await key_and_state(instance, ["-k", "Escape"], waits_for("the pill after the popup Escape", (state) => (field_of("to")(state) ?? []).join(" ").includes("alijx@fixture.invalid")));
  check(app, kind, "a j typed with the address popup open types, and Escape closes the popup and keeps insert mode (the next letters still type)", (field_of("to")(state) ?? []).join(" ").includes("alijx@fixture.invalid"), `to ${JSON.stringify(field_of("to")(state))}`);

  // q with a changed draft shows the save prompt, and Cancel keeps the window and the text.
  await jump("m");
  state = await key_and_state(instance, ["K"], waits_for("K in the body", (state) => body_of(state).includes("K")));
  await instance.press(["-k", "Escape"]);
  const prompt_before = await hud_pixels(instance, `${app}_prompt_before`, PROMPT_REGION);
  await instance.press(["q"]);
  // The prompt is a window of its own that the window list does not show, so its pixels in the middle of the screen stand for it.
  const prompt_shown = await wait_pixels(instance, "the save prompt to draw", `${app}_prompt_shown`, PROMPT_REGION, (hash) => hash !== prompt_before, { timeout_ms: 8000 });
  await shot("save_prompt", "the save prompt after q on a changed draft");
  state = await instance.ask("state");
  check(app, kind, "q on a changed draft shows the save prompt and keeps the window", prompt_shown !== prompt_before && compose_open(state));
  await instance.press(["-k", "Escape"]);
  const prompt_gone = await wait_pixels(instance, "the save prompt to go", `${app}_prompt_gone`, PROMPT_REGION, (hash) => hash === prompt_before, { timeout_ms: 8000 });
  state = await instance.ask("state");
  check(app, kind, "Cancel in the save prompt closes it and keeps the window and the text", prompt_gone === prompt_before && compose_open(state) && body_of(state).includes("K"), `body ${JSON.stringify(body_of(state))}`);
  await close_compose(instance);

  // q on a draft with no change closes the window with no prompt.
  state = await reply_to_inbox_s2(instance, ctx);
  await sleep(settle_ms);
  await instance.press(["-k", "Escape"]);
  state = await key_and_state(instance, ["q"], { what: "the compose window to close", until: (state) => !compose_open(state), timeout_ms: 10000 });
  check(app, kind, "q on a draft with no change closes the window", !compose_open(state));
  state = await instance.ask("state");
  check(app, kind, "the app survived the compose window keys", instance.exited() === null && !compose_open(state));
}

const with_editor = { seeds: { desertbird_settings: { external_editor: true } }, prepare: (work_dir, kind) => install_editor_host(work_dir, kind) };

export const pieces = [
  { kind: "compose_editor", section: "main", ...with_editor, run: (instance, ctx) => run_compose_editor(instance, ctx) },
  { kind: "compose_editor", section: "window", run: (instance, ctx) => run_compose_window(instance, ctx) },
  ...Object.keys(COMPOSE_EDITOR_HTML_KINDS).map((kind) => ({ kind, section: "main", ...with_editor, run: (instance, ctx) => run_compose_editor_html(instance, ctx) })),
];
