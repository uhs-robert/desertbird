// DesertBird's own pages: the xpi is a copy whose background page opens the options or help page when the helper add-on sends the page name.

import { sleep, CTRL_SHIFT, KEY_LIST_REGION, main_window_tabs, PAINT_MARGIN_MS, CHROME_TAB_MARGIN_MS, tab_count_is, active_is, last_tab_loaded } from "../predicates.mjs";
import { OPEN_OWN_PAGES_SCRIPT } from "../seed.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";

export const areas = ["own_pages", "theme", "message_body", "hud", "cmdline", "pages"];

// DesertBird's own pages run the message keys themselves: q closes the page tab, and q typed in an option input stays text.
async function run_own_pages(instance, ctx) {
  const { report, check, open_inbox, wait_for_state, key_and_state, hud_pixels, close_command_line } = ctx;
  const app = instance.app;
  const kind = "own_pages";
  await open_inbox(instance);
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };
  const tab_count = async () => main_window_tabs(await instance.ask("state")).length;
  const before = await tab_count();
  const open_page = async (page) => {
    const reply = await instance.ask("open_own_page", 20000, { page });
    const opened = await wait_for_state(instance, last_tab_loaded(before + 1));
    await sleep(PAINT_MARGIN_MS);
    check(app, kind, `the ${page} page opens in a tab`, main_window_tabs(opened).length === before + 1, `reply ${JSON.stringify(reply)}`);
  };
  // A page nobody clicked yet: its first keys must work, so j scrolls it and q closes it.
  for (const page of ["options", "help"]) {
    await open_page(page);
    const page_region = "0,150 1260x480";
    const page_before = await hud_pixels(instance, `${app}_${page}_unclicked_before`, page_region);
    for (let count = 0; count < 5; count++) await instance.press(["j"]);
    await sleep(500);
    check(app, kind, `j scrolls the ${page} page with no click first`, (await hud_pixels(instance, `${app}_${page}_unclicked_after`, page_region)) !== page_before);
    const closed = await key_and_state(instance, ["q"], tab_count_is(before));
    check(app, kind, `q closes the ${page} page with no click first`, main_window_tabs(closed).length === before, `tabs ${main_window_tabs(closed).length}, expected ${before}`);
    if (main_window_tabs(closed).length !== before) await instance.ask("remove_tab", 20000, { index: before });
  }
  for (const page of ["options", "help"]) {
    await open_page(page);
    // A click on empty page area puts the focus in the page document, as a user's first click does.
    await instance.click(1150, 450);
    await sleep(500);
    const closed = await key_and_state(instance, ["q"], tab_count_is(before));
    check(app, kind, `q closes the ${page} page`, main_window_tabs(closed).length === before, `tabs ${main_window_tabs(closed).length}, expected ${before}`);
  }
  // `/` sends the find to the page through tabs.sendMessage. A refusal shows a toast in the strip below the page, so the strip staying unchanged and the selection on screen show the page took the find.
  await open_page("options");
  await instance.click(1150, 450);
  await sleep(500);
  // The page scrolls to the match and draws under the strip, so a first find moves it and the compared find starts from the scrolled page, after any toast of the first has gone.
  const find_key_bindings = async () => {
    await instance.press(["/"]);
    await sleep(1500);
    await instance.press(["Key bindings"]);
    await sleep(400);
    await instance.press(["-k", "Return"]);
    await sleep(1500);
  };
  await find_key_bindings();
  await sleep(7000);
  const strip_before_find = await hud_pixels(instance, `${app}_own_find_before`);
  await find_key_bindings();
  await shot("options_find", "options page after / and Key bindings: the heading is selected");
  check(app, kind, "/ finds text on the options page with no refusal toast", (await hud_pixels(instance, `${app}_own_find_after`)) === strip_before_find);
  await instance.ask("remove_tab", 20000, { index: before });
  await wait_for_state(instance, tab_count_is(before));
  // A click on the first setting, a text input.
  await open_page("options");
  await instance.click(590, 250);
  await sleep(500);
  await shot("options_input_focused", "options page with the first control focused");
  const typed = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "q in an options input does not close the tab", main_window_tabs(typed).length === before + 1, `tabs ${main_window_tabs(typed).length}`);
  // Step 0 of the page keys: a keydown aimed at a remote page reaches the main-window listener. Alt+q closes the options tab with an input focused, and the page itself cannot have done it.
  const chord_closed = await key_and_state(instance, ["-M", "alt", "q", "-m", "alt"], tab_count_is(before));
  check(app, kind, "Alt+q closes a remote page tab, input focused", main_window_tabs(chord_closed).length === before, `tabs ${main_window_tabs(chord_closed).length}, expected ${before}`);
  await instance.ask("select_tab", 20000, { index: 0 });
  await wait_for_state(instance, active_is(0));
  // The readable tabs take q, : and g? through the main-window runtime. Each opens by its Thunderbird shortcut.
  // The address book focuses its search field, which keeps q as text, so a click on the folder list or the grid first puts the focus in the tab as a user's click does. g ? shows the root key list, and the next key removes it.
  for (const [name, open, click_at] of [["address book", () => instance.press(CTRL_SHIFT("b")), [165, 151]], ["calendar", () => instance.click(22, 112), [700, 400]]]) {
    await open();
    const opened = await wait_for_state(instance, last_tab_loaded(before + 1));
    await sleep(CHROME_TAB_MARGIN_MS);
    check(app, kind, `the ${name} tab opens`, main_window_tabs(opened).length === before + 1, `tabs ${main_window_tabs(opened).length}`);
    await instance.click(...click_at);
    await sleep(500);
    await shot(`${name.replace(" ", "_")}_tab`, `${name} tab before the keys`);
    const list_before = await hud_pixels(instance, `${app}_${name}_list_before`, KEY_LIST_REGION);
    await instance.press(["g"]);
    const helped = await key_and_state(instance, ["?"], 3000);
    check(app, kind, `g ? opens no tab from the ${name} tab`, main_window_tabs(helped).length === before + 1, `tabs ${main_window_tabs(helped).length}, expected ${before + 1}`);
    const list_shown = await hud_pixels(instance, `${app}_${name}_list_shown`, KEY_LIST_REGION);
    check(app, kind, `g ? shows the key list in the ${name} tab`, list_shown !== list_before);
    await shot(`${name.replace(" ", "_")}_key_list`, `${name} tab after g ?: the root key list shows`);
    await instance.press(["-k", "Escape"]);
    await sleep(1500);
    check(app, kind, `the next key removes the key list in the ${name} tab`, (await hud_pixels(instance, `${app}_${name}_list_gone`, KEY_LIST_REGION)) === list_before);
    await instance.press([":"]);
    await sleep(1500);
    await shot(`${name.replace(" ", "_")}_cmdline`, `${name} tab after the colon key: the command line shows`);
    await close_command_line(instance);
    const closed_here = await key_and_state(instance, ["q"], tab_count_is(before));
    check(app, kind, `q closes the ${name} tab`, main_window_tabs(closed_here).length === before, `tabs ${main_window_tabs(closed_here).length}, expected ${before}`);
  }
}

export const piece = {
  kind: "own_pages",
  section: "main",
  seeds: {},
  extra_script: OPEN_OWN_PAGES_SCRIPT,
  deadline_s: LONG_PIECE_DEADLINE_S,
  run: (instance, ctx) => run_own_pages(instance, ctx),
};
