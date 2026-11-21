// Plain keys while a popup menu is open: a key the popup does not take must not reach Thunderbird's own shortcuts (j marks the selected message as junk). Takes the helpers of `run.mjs` as arguments, as `pages_checks.mjs` does.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SHIFT_F10 = ["-M", "shift", "-k", "F10", "-m", "shift"];

// The app menu (hamburger) button at the e2e window size.
const APP_MENU_BUTTON = [1218, 21];

// Where the Mark submenu draws at the e2e window size, on the thread context menu opened by Shift+F10.
const MARK_SUBMENU_REGION = "900,260 190x260";

const same_pixels = async (instance, name, other) => (await instance.shot_region(name, MARK_SUBMENU_REGION, "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`)).equals(readFileSync(join(instance.out_dir, `${other}.ppm`)));

export async function run_popup_keys(instance, { check, shot, key_and_state, first_selected }) {
  const app = instance.app;
  const kind = "default";
  const any_junk = (state) => Object.values(state.flags).some((flags) => flags.junk);
  await instance.press(["g"]);
  let start = first_selected(await key_and_state(instance, ["g"]));
  const untouched = (state) => !any_junk(state) && first_selected(state) === start;
  const detail = (state) => `selected ${first_selected(state)}, expected ${start}, junk ${any_junk(state)}`;

  // A popup opened by the keyboard. The focus is in the thread list, so this runs before the click, which moves it to the menu button.
  await instance.press(SHIFT_F10);
  await sleep(1000);
  let state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "context menu open by keyboard: j marks nothing as junk and moves nothing", untouched(state), detail(state));
  // `k` is the access key of Mark in this menu, so it still reaches the menu and opens the submenu.
  await instance.shot_region("popup_menu_before_k", MARK_SUBMENU_REGION, "ppm");
  await instance.press(["k"]);
  await sleep(900);
  check(app, kind, "context menu open: its access key k still reaches the menu and opens the Mark submenu", !(await same_pixels(instance, "popup_menu_after_k", "popup_menu_before_k")));
  await shot("popup_context_menu_access_key", "thread context menu with Mark opened by k");
  await instance.press(["-k", "Escape"]);
  await instance.press(["-k", "Escape"]);
  await sleep(800);

  // A popup opened by a click leaves the focus where it was or on the button, and plain keys still reach Thunderbird.
  await instance.click(...APP_MENU_BUTTON);
  await sleep(1000);
  await shot("popup_app_menu_open", "app menu opened by a click");
  state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "app menu open by mouse: j marks nothing as junk and moves nothing", untouched(state), detail(state));
  // `a` (archive) and `n` (next unread) are Thunderbird shortcuts and access keys of items inside the app menu's hidden views. The menu takes neither.
  const folders_before = JSON.stringify(state.folders);
  for (const key of ["a", "n"]) state = await key_and_state(instance, [key], 1200);
  check(app, kind, "app menu open by mouse: a and n archive nothing and move nothing", untouched(state) && JSON.stringify(state.folders) === folders_before, `${detail(state)}, folders changed ${JSON.stringify(state.folders) !== folders_before}`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "after the menus close, j moves the list again and marks nothing", first_selected(state) !== start && !any_junk(state), `selected ${first_selected(state)}`);

  // The last check moved the list, so the baseline is the selection now.
  start = first_selected(state);
  // The app menu opened by the keyboard puts the focus inside the panel, and an arrow key moves it onto an item. The panel has no access keys, so a plain key must reach nothing. Escape after a click leaves the focus on the button, where Space opens the menu.
  await instance.click(...APP_MENU_BUTTON);
  await sleep(1000);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  await instance.press(["-k", "space"]);
  await sleep(1000);
  await shot("popup_app_menu_open_by_keyboard", "app menu opened by Space on the button");
  state = await key_and_state(instance, ["j"], 1200);
  check(app, kind, "app menu open by keyboard: j marks nothing as junk and moves nothing", untouched(state), detail(state));
  await instance.press(["-k", "Down"]);
  await sleep(500);
  await shot("popup_app_menu_item_focused", "app menu with an arrow key pressed, focus on an item");
  const folders_in_panel = JSON.stringify(state.folders);
  for (const key of ["j", "a", "n"]) state = await key_and_state(instance, [key], 1200);
  check(app, kind, "app menu with focus on an item: j, a and n mark, archive and move nothing", untouched(state) && JSON.stringify(state.folders) === folders_in_panel, `${detail(state)}, folders changed ${JSON.stringify(state.folders) !== folders_in_panel}`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
}
