// Plain keys while a popup menu is open: j and k move the selection of a menu (the `menukeys` Experiment), and any other key the popup does not take must not reach Thunderbird's own shortcuts (j marks the selected message as junk). Takes the helpers of `run.mjs` as arguments, as `pages_checks.mjs` does.

import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// DesertBird's toolbar button and its open popup on Betterbird, read from the shots. Thunderbird places the button elsewhere and is not pinned.
const DESERTBIRD_BUTTON = { betterbird: [1127, 21] };
const DESERTBIRD_POPUP_REGION = "1066,38 170x72";
const DESERTBIRD_HELP_ENTRY = [1100, 89];
// The share of bytes two shots of the popup region differ in. A closed popup leaves at most a hover mark of the page below (measured 1.4%), an open one covers most of it (65%).
const share_differing = (one, other) => one.reduce((count, byte, index) => count + (byte !== other[index] ? 1 : 0), 0) / one.length;
const CLOSED_AT_MOST = 0.05;
// The app menu panel region, measured on Betterbird only, over several runs: open against closed differs in 100% of the bytes, and two shots of the closed region in different runs in 0%. A menu that did not open reads 0%.
const OPEN_AT_LEAST = 0.5;
const panel_pixels = async (instance, name) => (await instance.shot_region(name, APP_MENU_PANEL_REGION, "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`));

// The Mark submenu region without 20 px on the side that touches the context menu, so a highlighted row of the menu itself cannot read as an open submenu. Betterbird opens the menu at the right edge of the window and its submenu to the left of it, so the menu is at the region's right. Thunderbird opens the menu at the selected card and its submenu to the right, so the menu is at the region's left.
const submenu_only_region = (app) => {
  const [, x, y, width, height] = MARK_SUBMENU_REGIONS[app].match(/^(\d+),(\d+) (\d+)x(\d+)$/).map(Number);
  return app === "betterbird" ? `${x},${y} ${width - 20}x${height}` : `${x + 20},${y} ${width - 20}x${height}`;
};

export async function run_popup_keys(instance, { check, note, shot, key_and_state, first_selected }) {
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
  // Control: the same region must see the submenu open, or the check above proves nothing. Home goes to the first toolbar button, eight j reach Mark (the other four buttons, Move To, Copy To, Tag, Mark) and Right opens its submenu.
  await instance.press(["-k", "Home"]);
  for (let step = 0; step < 8; step++) await instance.press(["j"]);
  await instance.press(["-k", "Right"]);
  await sleep(600);
  const control_open = !(await submenu_pixels("popup_submenu_control")).equals(submenu_closed);
  await shot("popup_submenu_control", "thread context menu with the Mark submenu opened by Home, eight j and Right");
  check(app, kind, "context menu open: the Mark submenu region shows an open submenu (control)", control_open);
  await instance.press(["-k", "Escape"]);
  await instance.press(["-k", "Escape"]);
  await sleep(800);

  // A popup opened by a click leaves the focus where it was or on the button, and plain keys still reach Thunderbird.
  await instance.click(...APP_MENU_BUTTON);
  await sleep(1000);
  await shot("popup_app_menu_open", "app menu opened by a click");
  // The menu keeps the focus in the list, and j and k move the list under it (`menukeys` leaves a panel whose focus is outside it alone).
  state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "app menu open by mouse: j moves the thread list down one row and marks nothing as junk", first_selected(state) !== start && !any_junk(state), `selected ${first_selected(state)}, expected a row after ${start}, junk ${any_junk(state)}`);
  const moved = first_selected(state);
  state = await key_and_state(instance, ["k"], 1200);
  check(app, kind, "app menu open by mouse: k moves the thread list back up", first_selected(state) === start && !any_junk(state), `selected ${first_selected(state)}, expected ${start}`);
  state = await key_and_state(instance, ["j"], 1200);
  // `a` (archive) and `n` (next unread) are Thunderbird shortcuts and access keys of items inside the app menu's hidden views. The menu takes neither, and they are still swallowed there.
  const folders_before = JSON.stringify(state.folders);
  for (const key of ["a", "n"]) state = await key_and_state(instance, [key], 1200);
  check(app, kind, "app menu open by mouse: a and n archive nothing and move nothing", first_selected(state) === moved && !any_junk(state) && JSON.stringify(state.folders) === folders_before, `selected ${first_selected(state)}, expected ${moved}, junk ${any_junk(state)}, folders changed ${JSON.stringify(state.folders) !== folders_before}`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "after the menus close, j moves the list again and marks nothing", first_selected(state) !== moved && !any_junk(state), `selected ${first_selected(state)}`);

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
    await run_desertbird_popup_keys(instance, { check, note, key_and_state, first_selected });
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
  await run_desertbird_popup_keys(instance, { check, note, key_and_state, first_selected });
}

// DesertBird's own popup takes j, k and h. Thunderbird moves the focus into the popup's browser about 400 ms after it shows, so the wait after the click covers that.
async function run_desertbird_popup_keys(instance, { check, note, key_and_state, first_selected }) {
  const app = instance.app;
  const kind = "default";
  const button = DESERTBIRD_BUTTON[app];
  if (!button) return note(app, kind, "DesertBird popup keys", "not driven: the toolbar button position is pinned on Betterbird only");
  // Its own baseline, so a failure of an app menu check above does not fail this one.
  const before = await instance.ask("state");
  const ring = async (name) => (await instance.shot_region(name, DESERTBIRD_POPUP_REGION, "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`));
  await instance.click(...button);
  await sleep(2000);
  const on_first = await ring("desertbird_popup_open");
  let state = await key_and_state(instance, ["j"], 800);
  const on_second = await ring("desertbird_popup_after_j");
  state = await key_and_state(instance, ["j"], 800);
  const still_second = await ring("desertbird_popup_after_jj");
  state = await key_and_state(instance, ["k"], 800);
  const back_first = await ring("desertbird_popup_after_jjk");
  check(app, kind, "DesertBird popup: j moves the focus to Help, a second j stays there, k returns to Options", !on_first.equals(on_second) && on_second.equals(still_second) && back_first.equals(on_first));
  const junk = Object.values(state.flags).some((flags) => flags.junk);
  check(app, kind, "DesertBird popup: j and k leave the thread list alone", first_selected(state) === first_selected(before) && !junk, `selected ${first_selected(state)}, expected ${first_selected(before)}, junk ${junk}`);
  const tab_count = (each) => each.windows.reduce((sum, window) => sum + window.tabs.length, 0);
  const tabs_before = tab_count(state);
  // A page the popup opens must take keys with no click: q closes it.
  state = await key_and_state(instance, ["h"], 1500);
  check(app, kind, "DesertBird popup: h opens the help page", tab_count(state) === tabs_before + 1, `tabs ${tabs_before} to ${tab_count(state)}`);
  state = await key_and_state(instance, ["q"], 1200);
  check(app, kind, "DesertBird popup: the help page h opened takes q with no click", tab_count(state) === tabs_before, `tabs ${tabs_before + 1} to ${tab_count(state)}`);
  // A click on an entry runs the same request, so its page takes keys the same way.
  await instance.click(...button);
  await sleep(2000);
  await instance.click(...DESERTBIRD_HELP_ENTRY);
  await sleep(1500);
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
  await instance.click(...DESERTBIRD_HELP_ENTRY);
  await sleep(1500);
  state = await key_and_state(instance, ["q"], 1200);
  check(app, kind, "DesertBird popup: the help page a click opened takes q with no click in it", tab_count(state) === tabs_before, `tabs ${tabs_before + 1} to ${tab_count(state)}`);
}
