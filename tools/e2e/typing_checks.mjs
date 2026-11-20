// The `pages` kind, typing keys: Escape, i and Alt+j or Alt+k in a text field of a page tab and in the quick filter of the mail tab. Takes the helpers of `run.mjs` as arguments, as `pages_checks.mjs` does.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CTRL_SHIFT = (key) => ["-M", "ctrl", "-M", "shift", key, "-m", "shift", "-m", "ctrl"];
const ALT = (key) => ["-M", "alt", "-k", key, "-m", "alt"];
// Where the settings gear sits at the e2e window size (the same pin as `pages_checks.mjs`).
const SETTINGS_BUTTON = [22, 653];

export async function run_typing(instance, { check, shot, key_and_state, open_inbox }) {
  const app = instance.app;
  const kind = "pages";
  await open_inbox(instance);
  const normal_window = (state) => state.windows.find((window) => window.type === "normal");
  const tabs_of = async () => normal_window(await instance.ask("state"))?.tabs ?? [];
  const active_index = async () => (await tabs_of()).find((tab) => tab.active)?.index;
  const before = (await tabs_of()).length;

  // Keys sent right after the click that opens settings can be lost while the page loads. Alt+j is the probe: it is sent again until the tab changes, and Alt+k brings the tab back, so every later key lands.
  async function press_until_active(keys, wanted) {
    for (let attempt = 0; attempt < 8; attempt++) {
      if ((await active_index()) === wanted) return true;
      await instance.press(keys);
      await sleep(1000);
    }
    return (await active_index()) === wanted;
  }
  async function open_settings() {
    await instance.click(...SETTINGS_BUTTON);
    await sleep(3000);
    if ((await tabs_of()).length !== before + 1) return false;
    const settings = await active_index();
    const probed = await press_until_active(ALT("j"), 0);
    return (await press_until_active(ALT("k"), settings)) && probed;
  }
  async function close_extra_tabs() {
    await instance.ask("reset_tabs", 20000);
    await sleep(800);
  }

  // The settings search field has the focus on open.
  check(app, kind, "the settings tab opens for the typing checks", await open_settings());
  const settings_index = await active_index();
  await instance.press(ALT("j"));
  await sleep(1000);
  const after_alt_j = await active_index();
  check(app, kind, "Alt+j in the settings search field switches tab exactly once", after_alt_j !== settings_index && (await tabs_of()).length === before + 1, `tab ${settings_index} then ${after_alt_j}, tabs ${(await tabs_of()).length}`);
  await instance.press(ALT("k"));
  await sleep(1000);
  check(app, kind, "Alt+k in the field of the tab it came from switches back", (await active_index()) === settings_index, `active ${await active_index()}, expected ${settings_index}`);

  await instance.press(["-k", "Escape"]);
  await sleep(700);
  await shot("typing_after_escape", "settings tab after Escape in its search field: the field has lost the focus");
  const closed = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "Escape leaves the settings search field, so q then closes the tab", (normal_window(closed)?.tabs ?? []).length === before, `tabs ${(normal_window(closed)?.tabs ?? []).length}, expected ${before}`);
  await close_extra_tabs();

  // i: every plain key reaches the page until Escape.
  check(app, kind, "the settings tab opens again for insert mode", await open_settings());
  await instance.press(["-k", "Escape"]);
  await sleep(700);
  await instance.press(["i"]);
  await sleep(700);
  const typed = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "after i, q closes no tab", (normal_window(typed)?.tabs ?? []).length === before + 1, `tabs ${(normal_window(typed)?.tabs ?? []).length}`);
  await instance.press(ALT("j"));
  await sleep(1000);
  check(app, kind, "Alt+j still switches tab in insert mode", (await active_index()) !== before, `active ${await active_index()}`);
  await instance.press(ALT("k"));
  await sleep(1000);
  await instance.press(["-k", "Escape"]);
  await sleep(700);
  const left_insert = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "Escape ends insert mode, so q closes the tab again", (normal_window(left_insert)?.tabs ?? []).length === before, `tabs ${(normal_window(left_insert)?.tabs ?? []).length}`);
  await close_extra_tabs();

  // The insert flag belongs to the tab: it does not follow the user to another tab.
  check(app, kind, "the settings tab opens a third time for the tab-change check", await open_settings());
  await instance.press(["-k", "Escape"]);
  await instance.press(["i"]);
  await sleep(500);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(800);
  await instance.ask("select_tab", 20000, { index: before });
  await sleep(800);
  const reset = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "insert mode ends on a tab change, so q closes the tab", (normal_window(reset)?.tabs ?? []).length === before, `tabs ${(normal_window(reset)?.tabs ?? []).length}`);
  await close_extra_tabs();

  // The mail tab's quick filter. A second tab gives Alt+j somewhere to go.
  await instance.ask("open_content_tab", 20000);
  await sleep(1500);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(800);
  await instance.press(CTRL_SHIFT("k"));
  await sleep(800);
  const full = (await instance.ask("state")).listed.length;
  await key_and_state(instance, ["Single 1"], 1500);
  await instance.press(ALT("j"));
  await sleep(1000);
  check(app, kind, "Alt+j in the quick filter switches tab exactly once", (await active_index()) === 1, `active ${await active_index()}`);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(800);
  await instance.press(["-k", "Escape"]);
  await sleep(1000);
  const cleared = await instance.ask("state");
  check(app, kind, "Escape in a quick filter with text clears it", cleared.listed.length === full, `listed ${cleared.listed.length} of ${full}`);
  const stays = await key_and_state(instance, ["a"], 1500);
  check(app, kind, "that Escape was Thunderbird's own, so the field keeps the focus and a archives nothing", JSON.stringify(stays.folders["/Inbox"]) === JSON.stringify(cleared.folders["/Inbox"]), `Inbox ${stays.folders["/Inbox"]?.length} then ${cleared.folders["/Inbox"]?.length}`);
  await shot("typing_quick_filter", "quick filter after Escape cleared its text and a was typed into it");
  await instance.press(["-k", "Escape"]);
  await sleep(1000);
  await instance.press(["-k", "Escape"]);
  await sleep(1000);
  await instance.press(["g"]);
  const at_top = (await key_and_state(instance, ["g"], 1000)).selected[0]?.header_id ?? null;
  const moved = (await key_and_state(instance, ["j"], 1000)).selected[0]?.header_id ?? null;
  check(app, kind, "after Escape out of the quick filter, g g and j move the list again", at_top !== null && moved !== null && moved !== at_top, `top ${at_top}, after j ${moved}`);
  await close_extra_tabs();
}
