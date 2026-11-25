// Plain keys while a popup menu is open: j, k, h and l move the selection of a menu (the `menukeys` Experiment), and any other key the popup does not take must not reach Thunderbird's own shortcuts (j marks the selected message as junk). Takes the helpers of `run.mjs` as arguments, as `pages_checks.mjs` does.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { last_tab_loaded } from "./predicates.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SHIFT_F10 = ["-M", "shift", "-k", "F10", "-m", "shift"];

// The app menu (hamburger) button at the e2e window size.
const APP_MENU_BUTTON = [1218, 21];

// The search box, and the Tab presses from it to the app menu button. Betterbird measured three stops: the search button (the magnifier at the right end of the box), the DesertBird button, then the app menu button. This step also runs on Thunderbird, where the stops and the panel region are not measured.
const SEARCH_BOX = [560, 21];
const TABS_FROM_SEARCH_TO_APP_MENU = 3;
const APP_MENU_PANEL_REGION = "906,40 330x410";

// The thread context menu opened by Shift+F10, as pixels, on Betterbird (read from the shots). Thunderbird places it elsewhere and is not pinned, so its moves are read from the selection only.
const CONTEXT_MENU_REGION = "1080,140 200x305";

// Where the Mark submenu draws at the e2e window size, on the thread context menu opened by Shift+F10. Thunderbird shows the Inbox as cards and opens the menu at the selected card, Betterbird as a table, so the submenu sits in different places.
const MARK_SUBMENU_REGIONS = { thunderbird: "610,280 190x290", betterbird: "900,260 190x260" };

// The menu bar (shown by Alt) and the menu under it, with the first menus of the bar. Measured on Betterbird at the e2e window size; Thunderbird has the same bar and its shots are read, not pinned.
const MENU_BAR_REGION = "0,0 520x460";
const ALT_F = ["-M", "alt", "-k", "f", "-m", "alt"];

// The tallest span of rows one menu item takes (a row measured at 26 px, on both apps). The bar sits 28 px lower on Thunderbird, so the item is not pinned to a row.
const MENU_ITEM_ROWS_AT_MOST = 40;
const MENU_BAR_REGION_WIDTH = 520;
// The rows of two shots of the menu bar region (P6 files, 3 bytes a pixel) in which any pixel differs.
const differing_rows = (one, other) => {
  const header = (ppm) => ppm.length % (MENU_BAR_REGION_WIDTH * 3);
  const [one_start, other_start] = [header(one), header(other)];
  const rows = new Set();
  for (let at = 0; at < one.length - one_start; at++) if (one[one_start + at] !== other[other_start + at]) rows.add(Math.floor(at / (MENU_BAR_REGION_WIDTH * 3)));
  return [...rows].sort((a, b) => a - b);
};

// DesertBird's toolbar button and its open popup on Betterbird, read from the shots. Thunderbird places the button elsewhere and is not pinned.
const DESERTBIRD_BUTTON = { betterbird: [1127, 21] };
const DESERTBIRD_POPUP_REGION = "1066,38 170x72";
const DESERTBIRD_HELP_ENTRY = [1100, 89];
// The share of bytes two shots of the popup region differ in. A closed popup leaves at most a hover mark of the page below (measured 1.4%), an open one covers most of it (65%).
const share_differing = (one, other) => one.reduce((count, byte, index) => count + (byte !== other[index] ? 1 : 0), 0) / one.length;
const CLOSED_AT_MOST = 0.05;
// A shot of the open popup moves with the hover and the focus ring, so it cannot be the reference for "closed". The popup's own text is the sign: 1100 to 1900 dark bytes while open, 0 over the help tab once closed.
const DARK_BELOW = 110;
const dark_bytes = (pixels) => pixels.reduce((count, byte) => count + (byte < DARK_BELOW ? 1 : 0), 0);
const CLOSED_DARK_BYTES_AT_MOST = 100;
// Half the 1100 dark bytes the open popup's text measured at its least, and the time its region must hold still (the popup browser takes the focus about 400 ms after it shows).
const POPUP_TEXT_DARK_BYTES_AT_LEAST = 550;
const POPUP_STILL_MS = 600;
const J_ATTEMPTS = 4;
// The app menu panel region, measured on Betterbird only, over several runs: open against closed differs in 100% of the bytes, and two shots of the closed region in different runs in 0%. A menu that did not open reads 0%.
const OPEN_AT_LEAST = 0.5;
const panel_pixels = async (instance, name) => (await instance.shot_region(name, APP_MENU_PANEL_REGION, "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`));

// The Mark submenu region without 20 px on the side that touches the context menu, so a highlighted row of the menu itself cannot read as an open submenu. Betterbird opens the menu at the right edge of the window and its submenu to the left of it, so the menu is at the region's right. Thunderbird opens the menu at the selected card and its submenu to the right, so the menu is at the region's left.
const submenu_only_region = (app) => {
  const [, x, y, width, height] = MARK_SUBMENU_REGIONS[app].match(/^(\d+),(\d+) (\d+)x(\d+)$/).map(Number);
  return app === "betterbird" ? `${x},${y} ${width - 20}x${height}` : `${x + 20},${y} ${width - 20}x${height}`;
};

export async function run_popup_keys(instance, { check, note, shot, key_and_state, first_selected, wait_for, wait_for_state, wait_window_focus }) {
  const app = instance.app;
  const kind = "default";
  const any_junk = (state) => Object.values(state.flags).some((flags) => flags.junk);
  await instance.press(["g"]);
  let start = first_selected(await key_and_state(instance, ["g"]));
  const untouched = (state) => !any_junk(state) && first_selected(state) === start;
  const detail = (state) => `selected ${first_selected(state)}, expected ${start}, junk ${any_junk(state)}`;

  // A popup opened by the keyboard. The focus is in the thread list, so this runs before the click, which moves it to the menu button.
  const menu_pixels = async (name) => (await instance.shot_region(name, CONTEXT_MENU_REGION, "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`));
  await instance.press(SHIFT_F10);
  await sleep(1000);
  const pinned = app === "betterbird";
  const menu_before = pinned && (await menu_pixels("popup_menu_before"));
  const submenu_pixels = async (name) => (await instance.shot_region(name, submenu_only_region(app), "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`));
  const submenu_closed = await submenu_pixels("popup_submenu_closed");
  let state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "context menu open by keyboard: j marks nothing as junk and moves nothing in the list", untouched(state), detail(state));
  // j and k move the menu's selection, read as pixels.
  if (pinned) {
    const after_j = await menu_pixels("popup_menu_after_j");
    state = await key_and_state(instance, ["j"], 800);
    const after_jj = await menu_pixels("popup_menu_after_jj");
    state = await key_and_state(instance, ["k"], 800);
    const after_jjk = await menu_pixels("popup_menu_after_jjk");
    check(app, kind, "context menu open: j moves the selection down one item and k moves it back up", !after_j.equals(menu_before) && !after_jj.equals(after_j) && after_jjk.equals(after_j));
    // The menu is back on the first item. A real Down reaches what the second j did, and a real Up what the first j did.
    await instance.press(["-k", "Down"]);
    await sleep(500);
    const after_down = await menu_pixels("popup_menu_after_down");
    await instance.press(["-k", "Up"]);
    await sleep(500);
    const after_up = await menu_pixels("popup_menu_after_up");
    check(app, kind, "context menu open: a real Down and Up reach the items j and k reached", after_down.equals(after_jj) && after_up.equals(after_j));
    await shot("popup_context_menu_after_keys", "thread context menu with an item selected by j and k");
  } else {
    state = await key_and_state(instance, ["k"], 800);
    note(app, kind, "context menu j and k move the selection", "not read as pixels: the menu position is pinned on Betterbird only");
  }
  check(app, kind, "context menu open: j and k leave the list alone", untouched(state), detail(state));
  const submenu_after_k = await submenu_pixels("popup_submenu_after_k");
  check(app, kind, "context menu open: k opens no Mark submenu", submenu_after_k.equals(submenu_closed));
  await shot("popup_submenu_after_k", "thread context menu after k, with the Mark submenu region closed");
  // h and l, against the same closed baseline. Home goes to the first toolbar button, eight j reach Mark (the other four buttons, Move To, Copy To, Tag, Mark). A highlighted Mark opens nothing by itself, l opens its submenu, a real Right reaches the same pixels, and h closes it again. A control (the open submenu differs from the closed region) keeps every equality below from passing on a region that never changes.
  await instance.press(["-k", "Home"]);
  for (let step = 0; step < 8; step++) await instance.press(["j"]);
  await sleep(600);
  const at_mark = await submenu_pixels("popup_submenu_at_mark");
  await shot("popup_submenu_at_mark", "thread context menu with Mark highlighted by Home and eight j, its submenu still closed");
  state = await key_and_state(instance, ["l"], 800);
  const after_l = await submenu_pixels("popup_submenu_after_l");
  await shot("popup_submenu_after_l", "thread context menu with the Mark submenu opened by l");
  check(app, kind, "context menu open: l opens the Mark submenu (the region differs from the closed one)", at_mark.equals(submenu_closed) && !after_l.equals(submenu_closed));
  check(app, kind, "context menu open: l leaves the list alone", untouched(state), detail(state));
  state = await key_and_state(instance, ["h"], 800);
  const after_h = await submenu_pixels("popup_submenu_after_h");
  await shot("popup_submenu_after_h", "thread context menu after h closed the Mark submenu");
  check(app, kind, "context menu open: h closes the Mark submenu (the region is the closed baseline again)", after_h.equals(submenu_closed));
  check(app, kind, "context menu open: h leaves the list alone", untouched(state), detail(state));
  await instance.press(["-k", "Right"]);
  await sleep(600);
  const after_right = await submenu_pixels("popup_submenu_after_right");
  check(app, kind, "context menu open: a real Right reaches what l reached", after_right.equals(after_l));
  await instance.press(["-k", "Left"]);
  await sleep(600);
  check(app, kind, "context menu open: a real Left reaches what h reached", (await submenu_pixels("popup_submenu_after_left")).equals(submenu_closed));
  await instance.press(["-k", "Escape"]);
  await instance.press(["-k", "Escape"]);
  await sleep(800);

  // A menu bar menu: Alt+F opens File on its first item, New, which has a submenu. Two j reach Close, which has none, so l (like a real Right) moves to the next menu, Edit. The shot and its region cover the menu bar and the open menu, so File against Edit reads from the pixels.
  const bar_pixels = async (name) => (await instance.shot_region(name, MENU_BAR_REGION, "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`));
  const open_file_at_close = async (keys) => {
    await instance.press(ALT_F);
    await sleep(800);
    for (const key of keys) await instance.press(key);
    await sleep(500);
  };
  await open_file_at_close([["j"], ["j"]]);
  const bar_at_close = await bar_pixels("popup_bar_at_close");
  await shot("popup_bar_at_close", "File menu opened by Alt+F, Close highlighted by two j");
  state = await key_and_state(instance, ["l"], 800);
  const bar_after_l = await bar_pixels("popup_bar_after_l");
  await shot("popup_bar_after_l", "after l on Close, which has no submenu: the Edit menu is open");
  check(app, kind, "menu bar menu open, no submenu at the highlight: l moves to the next menu", !bar_after_l.equals(bar_at_close));
  check(app, kind, "menu bar menu open: l leaves the list alone", untouched(state), detail(state));
  state = await key_and_state(instance, ["h"], 800);
  const bar_after_h = await bar_pixels("popup_bar_after_h");
  await shot("popup_bar_after_h", "after h on the Edit menu: back to the File menu");
  const bar_h_shot = bar_after_h;
  await instance.press(["-k", "Escape"]);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  await open_file_at_close([["-k", "Down"], ["-k", "Down"]]);
  await instance.press(["-k", "Right"]);
  await sleep(800);
  const bar_after_right = await bar_pixels("popup_bar_after_right");
  await shot("popup_bar_after_right", "after a real Right on Close: the Edit menu with its first item highlighted");
  const rows_apart = differing_rows(bar_after_right, bar_after_l);
  // Measured: a real Right opens Edit with its first enabled item highlighted and l opens it with none, so the two differ in the rows of that one item and nowhere else.
  check(app, kind, "menu bar menu open: a real Right opens the same menu as l, apart from the highlighted first item", rows_apart.length > 0 && rows_apart.at(-1) - rows_apart[0] < MENU_ITEM_ROWS_AT_MOST, `rows apart ${rows_apart.at(0)} to ${rows_apart.at(-1)}`);
  // A real Left from the same Edit state. An h that closed the menu, or stayed on Edit, differs from it in far more than one item.
  await instance.press(["-k", "Left"]);
  await sleep(800);
  const bar_after_left = await bar_pixels("popup_bar_after_left");
  await shot("popup_bar_after_left", "after a real Left on the Edit menu: the File menu");
  const left_rows_apart = differing_rows(bar_after_left, bar_h_shot);
  check(app, kind, "menu bar menu open: h opens the same menu as a real Left, apart from one item", !bar_h_shot.equals(bar_after_l) && (left_rows_apart.length === 0 || left_rows_apart.at(-1) - left_rows_apart[0] < MENU_ITEM_ROWS_AT_MOST), `rows apart ${left_rows_apart.at(0)} to ${left_rows_apart.at(-1)}`);
  await instance.press(["-k", "Escape"]);
  await instance.press(["-k", "Escape"]);
  await sleep(800);

  // A popup opened by a click leaves the focus in the thread list. j and k move the menu all the same, and every other plain key still reaches nothing.
  const click_closed = await panel_pixels(instance, "popup_app_menu_click_closed");
  await instance.click(...APP_MENU_BUTTON);
  await sleep(1000);
  await shot("popup_app_menu_open", "app menu opened by a click");
  const click_at_first = await panel_pixels(instance, "popup_app_menu_click_at_first");
  const click_opened = share_differing(click_closed, click_at_first) > OPEN_AT_LEAST;
  check(app, kind, "app menu opens by a click", click_opened, `differs from closed ${share_differing(click_closed, click_at_first).toFixed(3)}`);
  state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "app menu open by mouse: j marks nothing as junk and moves nothing in the list", first_selected(state) === start && !any_junk(state), `selected ${first_selected(state)}, expected ${start}, junk ${any_junk(state)}`);
  const click_after_j = await panel_pixels(instance, "popup_app_menu_click_after_j");
  state = await key_and_state(instance, ["j"], 1200);
  const click_after_jj = await panel_pixels(instance, "popup_app_menu_click_after_jj");
  state = await key_and_state(instance, ["k"], 1200);
  const click_after_jjk = await panel_pixels(instance, "popup_app_menu_click_after_jjk");
  check(app, kind, "app menu open by mouse: j moves the selection down one item and k moves it back up", !click_after_j.equals(click_at_first) && !click_after_jj.equals(click_after_j) && click_after_jjk.equals(click_after_j), `list still at ${first_selected(state)}, expected ${start}`);
  await shot("popup_app_menu_click_after_jk", "app menu opened by a click, with the selection moved by j, j and k");
  // `a` (archive) and `n` (next unread) are Thunderbird shortcuts and access keys of items inside the app menu's hidden views. The menu takes neither, and they are still swallowed there.
  const folders_before = JSON.stringify(state.folders);
  for (const key of ["a", "n"]) state = await key_and_state(instance, [key], 1200);
  check(app, kind, "app menu open by mouse: a and n archive nothing and move nothing", first_selected(state) === start && !any_junk(state) && JSON.stringify(state.folders) === folders_before, `selected ${first_selected(state)}, expected ${start}, junk ${any_junk(state)}, folders changed ${JSON.stringify(state.folders) !== folders_before}`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "after the menus close, j moves the list again and marks nothing", first_selected(state) !== start && !any_junk(state), `selected ${first_selected(state)}`);

  // The last check moved the list, so the baseline is the selection now.
  start = first_selected(state);
  // The app menu opened by the keyboard puts the focus inside the panel. A plain key must reach nothing there, also after an arrow key. Escape after a click returns the focus to the thread list on Betterbird, and Space on the button would pick a row there instead of pressing it (the list is the key target unless a text field or an open menu has the focus). So Tab from the search box moves the focus to the button, and Enter presses it.
  const panel_closed = await panel_pixels(instance, "popup_app_menu_panel_closed");
  await instance.click(...SEARCH_BOX);
  await sleep(500);
  for (let tab = 0; tab < TABS_FROM_SEARCH_TO_APP_MENU; tab++) await instance.press(["-k", "Tab"]);
  await sleep(500);
  await instance.press(["-k", "Return"]);
  await sleep(1000);
  const panel_open = await panel_pixels(instance, "popup_app_menu_panel_open");
  const opened = share_differing(panel_closed, panel_open) > OPEN_AT_LEAST;
  check(app, kind, "app menu opens by Enter on its button", opened, `differs from closed ${share_differing(panel_closed, panel_open).toFixed(3)}`);
  // The checks below mean nothing without the open menu: j, a and n would act on the list and report a leak that is no leak.
  if (!opened) {
    await instance.press(["-k", "Escape"]);
    await sleep(800);
    await run_desertbird_popup_keys(instance, { check, note, key_and_state, first_selected, wait_for, wait_for_state, wait_window_focus });
    return;
  }
  await shot("popup_app_menu_open_by_keyboard", "app menu opened by Enter on the button");
  // j and k move the focus inside the panel: j, j, k ends where the first j did, read as pixels.
  const at_first = await panel_pixels(instance, "popup_app_menu_at_first");
  state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "app menu open by keyboard: j marks nothing as junk and moves nothing in the list", untouched(state), detail(state));
  const after_j = await panel_pixels(instance, "popup_app_menu_after_j");
  state = await key_and_state(instance, ["j"], 1200);
  const after_jj = await panel_pixels(instance, "popup_app_menu_after_jj");
  state = await key_and_state(instance, ["k"], 1200);
  const after_jjk = await panel_pixels(instance, "popup_app_menu_after_jjk");
  check(app, kind, "app menu open by keyboard: j moves the focus down one item and k moves it back up", !after_j.equals(at_first) && !after_jj.equals(after_j) && after_jjk.equals(after_j), `list still untouched ${untouched(state)}`);
  await shot("popup_app_menu_after_jk", "app menu with the focus moved by j, j and k");
  await instance.press(["-k", "Down"]);
  await sleep(500);
  await shot("popup_app_menu_after_arrow", "app menu after an arrow key pressed in it");
  const folders_in_panel = JSON.stringify(state.folders);
  for (const key of ["j", "a", "n"]) state = await key_and_state(instance, [key], 1200);
  check(app, kind, "app menu after an arrow key inside it: j, a and n mark, archive and move nothing", untouched(state) && JSON.stringify(state.folders) === folders_in_panel, `${detail(state)}, folders changed ${JSON.stringify(state.folders) !== folders_in_panel}`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  await run_desertbird_popup_keys(instance, { check, note, key_and_state, first_selected, wait_for, wait_for_state, wait_window_focus });
}

// DesertBird's own popup takes j, k and h. Thunderbird moves the focus into the popup's browser about 400 ms after it shows, so the wait after the click covers that.
async function run_desertbird_popup_keys(instance, { check, note, key_and_state, first_selected, wait_for, wait_for_state, wait_window_focus }) {
  const app = instance.app;
  const kind = "default";
  const button = DESERTBIRD_BUTTON[app];
  if (!button) return note(app, kind, "DesertBird popup keys", "not driven: the toolbar button position is pinned on Betterbird only");
  // Its own baseline, so a failure of an app menu check above does not fail this one.
  const before = await instance.ask("state");
  const ring = async (name) => (await instance.shot_region(name, DESERTBIRD_POPUP_REGION, "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`));
  const popup_text_shows = (pixels) => dark_bytes(pixels) > POPUP_TEXT_DARK_BYTES_AT_LEAST;
  // The window must have the focus before the click, or the popup opens in an inactive window and its page never takes the keys (issue #178).
  await wait_window_focus(instance);
  await instance.click(...button);
  // The popup shows its text, then the region holds still: the focus ring is drawn once the popup's browser has the focus, about 400 ms after it shows, and a key sent before that is swallowed.
  let last_read = null;
  let still_since = 0;
  const on_first = await wait_for(instance, "the DesertBird popup to show its text and hold still", () => ring("desertbird_popup_open"), (now) => {
    const held = last_read !== null && now.equals(last_read);
    last_read = now;
    if (!held || !popup_text_shows(now)) still_since = 0;
    else still_since ||= Date.now();
    return still_since > 0 && Date.now() - still_since >= POPUP_STILL_MS;
  }, { timeout_ms: 8000, step_ms: 100, show: (now) => `dark bytes ${dark_bytes(now)}` });
  // A j sent while the popup page lacks the focus, or lost on the way to the window, moves nothing. j is idempotent at the end of the list, so it repeats until the ring moves.
  let state = null;
  let on_second = on_first;
  for (let attempt = 1; attempt <= J_ATTEMPTS && on_second.equals(on_first); attempt++) {
    if (attempt > 1) note(app, kind, "DesertBird popup: j moved no focus ring", `pressing j again (attempt ${attempt} of ${J_ATTEMPTS})`);
    state = await key_and_state(instance, ["j"], 500);
    on_second = await ring(`desertbird_popup_after_j${attempt > 1 ? `_attempt_${attempt}` : ""}`);
  }
  state = await key_and_state(instance, ["j"], 800);
  const still_second = await ring("desertbird_popup_after_jj");
  state = await key_and_state(instance, ["k"], 800);
  const back_first = await ring("desertbird_popup_after_jjk");
  check(app, kind, "DesertBird popup: j moves the focus to Help, a second j stays there, k returns to Options", !on_first.equals(on_second) && on_second.equals(still_second) && back_first.equals(on_first));
  const junk = Object.values(state.flags).some((flags) => flags.junk);
  check(app, kind, "DesertBird popup: j and k leave the thread list alone", first_selected(state) === first_selected(before) && !junk, `selected ${first_selected(state)}, expected ${first_selected(before)}, junk ${junk}`);
  // The popup closes only after the background has run the request, which is slow under load, and a fixed sleep let the next click toggle it shut. The wait ends when the region holds still with no popup text in it. A popup that never closes ends the wait at its ceiling with a FAIL line.
  const click_help_and_wait_for_close = async () => {
    await instance.click(...DESERTBIRD_HELP_ENTRY);
    let last = null;
    await wait_for(instance, "the DesertBird popup to close after the Help click", () => ring("desertbird_popup_after_help"), (now) => {
      const held = last !== null && now.equals(last);
      last = now;
      return held && dark_bytes(now) <= CLOSED_DARK_BYTES_AT_MOST;
    }, { timeout_ms: 8000, step_ms: 100 });
  };
  const tab_count = (each) => each.windows.reduce((sum, window) => sum + window.tabs.length, 0);
  const tabs_before = tab_count(state);
  // A page the popup opens must take keys with no click: q closes it. The page binds its keys once loaded, which the close of the popup does not wait for, so each q follows a wait for the help tab to finish loading.
  // One retry, and only while the popup text still shows: a popup that closed took the first h, and a second h would go to the new help tab or the list.
  const press_h_and_wait_for_tab = async () => {
    await instance.press(["h"]);
    return wait_for_state(instance, { what: "the help tab h opens", until: (each) => tab_count(each) > tabs_before, timeout_ms: 2500, soft: true });
  };
  state = await press_h_and_wait_for_tab();
  if (tab_count(state) === tabs_before && popup_text_shows(await ring("desertbird_popup_after_h_miss"))) {
    note(app, kind, "DesertBird popup: h opened no help tab", "the popup text still shows, pressing h once more");
    state = await press_h_and_wait_for_tab();
  }
  check(app, kind, "DesertBird popup: h opens the help page", tab_count(state) === tabs_before + 1, `tabs ${tabs_before} to ${tab_count(state)}`);
  await wait_for_state(instance, last_tab_loaded(tabs_before + 1));
  state = await key_and_state(instance, ["q"], 1200);
  check(app, kind, "DesertBird popup: the help page h opened takes q with no click", tab_count(state) === tabs_before, `tabs ${tabs_before + 1} to ${tab_count(state)}`);
  // A click on an entry runs the same request, so its page takes keys the same way.
  await instance.click(...button);
  await sleep(2000);
  await click_help_and_wait_for_close();
  await wait_for_state(instance, last_tab_loaded(tabs_before + 1));
  state = await instance.ask("state");
  const opened_by_click = tab_count(state) === tabs_before + 1;
  // The closed baseline is the help tab's own: open the popup over it, then close it with Escape, which the panel handles natively.
  const after_click = await ring("desertbird_popup_after_click");
  await instance.click(...button);
  await sleep(2000);
  const reopened = await ring("desertbird_popup_reopened");
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  const closed = await ring("desertbird_popup_closed");
  const closed_share = share_differing(after_click, closed);
  const reopened_share = share_differing(reopened, closed);
  check(app, kind, "DesertBird popup: a click on Help opens the page and closes the popup", opened_by_click && closed_share <= CLOSED_AT_MOST && reopened_share > CLOSED_AT_MOST, `opened ${opened_by_click}, differs from closed ${closed_share.toFixed(3)}, reopened differs ${reopened_share.toFixed(3)}`);
  await instance.press(["-k", "Escape"]);
  await instance.click(...button);
  await sleep(2000);
  await click_help_and_wait_for_close();
  await wait_for_state(instance, last_tab_loaded(tabs_before + 1));
  state = await key_and_state(instance, ["q"], 1200);
  check(app, kind, "DesertBird popup: the help page a click opened takes q with no click in it", tab_count(state) === tabs_before, `tabs ${tabs_before + 1} to ${tab_count(state)}`);
}
