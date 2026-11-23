// The external editor kinds: a fake editor behind the native host rewrites the scratch file. Plain text, and Markdown with the reply below or above the quote.

import { existsSync } from "node:fs";
import { sleep, compose_opens, compose_tab, reply_is_loaded, mail_window_ready, selects_inbox_s2 } from "../predicates.mjs";
import { EDITED_TEXT, DESERTFOX_HOST, COMPOSE_EDITOR_HTML_KINDS, install_editor_host } from "../seed.mjs";

export const areas = ["compose", "mode_label"];

// A 1x1 PNG for the draft image measurement.
const PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The mode label is drawn by the compose script, so it shows once the script listens. Ctrl+E before that goes to the editor itself and is lost. The label sits at the bottom right of the compose window, and a stretch of body of the same size shows what the region draws with no label.
const COMPOSE_LABEL_REGION = "970,672 96x22";
const COMPOSE_BLANK_REGION = "700,672 96x22";

async function wait_compose_script(instance, { hud_pixels, wait_pixels }) {
  const blank = await hud_pixels(instance, `${instance.app}_compose_blank`, COMPOSE_BLANK_REGION);
  return wait_pixels(instance, "the compose script to draw its mode label", `${instance.app}_compose_label`, COMPOSE_LABEL_REGION, (hash) => hash !== blank, { timeout_ms: 10000 });
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
  await instance.press(["q"]);
  await sleep(800);
  state = await instance.ask("state");
  check(app, kind, "q in normal mode closes nothing", state.windows.some((window) => window.type === "messageCompose"));
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

const with_editor = { seeds: { desertbird_settings: { external_editor: true } }, prepare: (work_dir, kind) => install_editor_host(work_dir, kind) };

export const pieces = [
  { kind: "compose_editor", section: "main", ...with_editor, run: (instance, ctx) => run_compose_editor(instance, ctx) },
  ...Object.keys(COMPOSE_EDITOR_HTML_KINDS).map((kind) => ({ kind, section: "main", ...with_editor, run: (instance, ctx) => run_compose_editor_html(instance, ctx) })),
];
