// The `pages` kind: the keys of every tab that is not the mail tab, each opened by its own route and with no click first. A route whose click position is not pinned yet records NOTE lines and no FAIL, so the first run can measure it.
// Departs from `run_own_pages`, which keeps the after-a-click case of the address book and calendar: this file covers the no-click case and the other tabs. It takes the helpers of `run.mjs` as arguments, as `run_tabs` does.

import { back_to } from "./predicates.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
const CTRL_SHIFT = (key) => ["-M", "ctrl", "-M", "shift", key, "-m", "shift", "-m", "ctrl"];

// Where the spaces toolbar buttons sit at the e2e window size. The calendar position is measured. The tasks button and the settings gear were read from a screenshot. Chat has no button in this profile, so it has no row.
const SPACES = { calendar: [22, 112], tasks: [22, 157], settings: [22, 653] };
const PAGE_REGION = "0,150 1260x480";

export async function run_pages(instance, { check, note, wait_window_focus, open_key_list, shot, key_and_state, hud_pixels, wait_pixels, open_inbox, close_command_line, key_list_region }) {
  const app = instance.app;
  const kind = "pages";
  await open_inbox(instance);
  const tabs_of = async () => (await instance.ask("state")).windows.find((window) => window.type === "normal")?.tabs ?? [];
  const before = (await tabs_of()).length;

  // The tab's own keys. `pinned` is false for a route measured for the first time: its outcomes are notes.
  async function read_tab({ name, open, pinned = true, field_autofocused = false, leave_field = null, scrolls = true }) {
    const slug = name.replace(/\W+/g, "_");
    const verdict = (label, ok, detail = "") => (pinned ? check(app, kind, label, ok, detail) : note(app, kind, label, `${ok ? "as expected" : "not as expected"} ${detail}`));
    await open();
    await sleep(3000);
    await wait_window_focus(instance);
    const opened = await tabs_of();
    verdict(`the ${name} tab opens`, opened.length === before + 1, `tabs ${JSON.stringify(opened.map((tab) => tab.type))}`);
    if (opened.length !== before + 1) return;
    await shot(`${slug}_no_click`, `${name} tab, no click yet`);

    if (field_autofocused) {
      const typed = await key_and_state(instance, ["q"], 1500);
      verdict(`q types into the autofocused field of the ${name} tab and closes no tab`, (typed.windows.find((window) => window.type === "normal")?.tabs ?? []).length === before + 1);
      // The page takes the focus back into its field after a click (about:config), so only the typing check can run there.
      if (!leave_field) {
        await instance.ask("remove_tab", 20000, { index: before });
        await sleep(1000);
        await instance.ask("select_tab", 20000, { index: 0 });
        return;
      }
      await leave_field();
      await sleep(500);
    }

    const list_before = await hud_pixels(instance, `${app}_${slug}_list_before`, key_list_region);
    const { helped, list_shown } = await open_key_list(instance, { slug, list_before });
    verdict(`g ? opens no tab from the ${name} tab`, (helped.windows.find((window) => window.type === "normal")?.tabs ?? []).length === before + 1);
    verdict(`g ? shows the key list in the ${name} tab`, list_shown !== list_before);
    await shot(`${slug}_key_list`, `${name} tab after g ?: the key list shows`);
    await instance.press(["-k", "Escape"]);
    const list_gone = await wait_pixels(instance, `the key list of the ${name} tab to go`, `${app}_${slug}_list_gone`, key_list_region, back_to(list_before), { timeout_ms: 3000 });
    verdict(`the next key removes the key list in the ${name} tab`, list_gone === list_before);

    // A half-typed t lists the tab keys after the which-key delay.
    await instance.press(["t"]);
    await sleep(1500);
    verdict(`a half-typed t shows the key list in the ${name} tab`, (await hud_pixels(instance, `${app}_${slug}_pending_shown`, key_list_region)) !== list_before);
    await shot(`${slug}_pending_t`, `${name} tab after t: the tab keys show`);
    await instance.press(["-k", "Escape"]);
    await sleep(1500);
    verdict(`the next key removes the half-typed key list in the ${name} tab`, (await hud_pixels(instance, `${app}_${slug}_pending_gone`, key_list_region)) === list_before);

    await instance.press([":"]);
    await sleep(1500);
    await shot(`${slug}_cmdline`, `${name} tab after the colon key: the command line shows`);
    await close_command_line(instance);

    // j changes the page, or the tab has no scrolling area and this is only a note.
    const page_before = await hud_pixels(instance, `${app}_${slug}_page_before`, PAGE_REGION);
    for (let count = 0; count < 5; count++) await instance.press(["j"]);
    await sleep(500);
    const scrolled_pixels = await hud_pixels(instance, `${app}_${slug}_page_after`, PAGE_REGION);
    const scrolled = scrolled_pixels !== page_before;
    if (scrolls) verdict(`j scrolls the ${name} tab`, scrolled);
    else note(app, kind, `j in the ${name} tab`, scrolled ? "the page pixels changed" : "the page pixels did not change");
    await shot(`${slug}_after_j`, `${name} tab after five j`);
    // Ctrl+F is Find in Thunderbird, so the page must move, and Ctrl+B must bring it back to where it was.
    if (scrolls) {
      await instance.press(CTRL("f"));
      await sleep(500);
      const paged = await hud_pixels(instance, `${app}_${slug}_page_down`, PAGE_REGION);
      await instance.press(CTRL("b"));
      await sleep(500);
      const back = await hud_pixels(instance, `${app}_${slug}_page_up`, PAGE_REGION);
      verdict(`Ctrl+F scrolls the ${name} tab a page and Ctrl+B scrolls it back`, paged !== scrolled_pixels && back === scrolled_pixels);
    }
    await instance.press(["g"]);
    await instance.press(["g"]);

    const closed = await key_and_state(instance, ["q"], 2000);
    const left = (closed.windows.find((window) => window.type === "normal")?.tabs ?? []).length;
    verdict(`q closes the ${name} tab`, left === before, `tabs ${left}, expected ${before}`);
    if (left !== before) {
      await instance.ask("remove_tab", 20000, { index: before });
      await sleep(1000);
    }
    await instance.ask("select_tab", 20000, { index: 0 });
    await sleep(500);
  }

  await read_tab({ name: "address book", open: () => instance.press(CTRL_SHIFT("b")), field_autofocused: true, leave_field: () => instance.click(165, 151), scrolls: false });
  await read_tab({ name: "calendar", open: () => instance.click(...SPACES.calendar), scrolls: false });
  await read_tab({ name: "tasks", open: () => instance.click(...SPACES.tasks), scrolls: false });
  // The settings search field has the focus on open. `leave_field` clicks a long pane to move the focus off that field, then clicks the empty area beside the pane to move it into the page. `j` then scrolls the settings page, and this row checks that.
  await read_tab({ name: "settings", open: () => instance.click(...SPACES.settings), field_autofocused: true, leave_field: async () => { await instance.click(160, 321); await sleep(500); await instance.click(1220, 450); } });
  await read_tab({ name: "about:addons", open: async () => { await instance.press(["g"]); await instance.press(["p"]); await instance.press(["a"]); }, scrolls: false });
  // The page puts the focus back into its search field on any key or click, so only the typing check runs there.
  await read_tab({ name: "about:config", open: async () => { await instance.press(["g"]); await instance.press(["p"]); await instance.press(["c"]); }, field_autofocused: true });

  // The control: the mail tab keeps its own keys, and the pages bundle takes none of them.
  const mail_before = (await instance.ask("state")).selected[0]?.header_id ?? null;
  const moved = (await key_and_state(instance, ["j"], 700)).selected[0]?.header_id ?? null;
  check(app, kind, "j in the mail tab still moves the list row", moved !== mail_before, `${mail_before} then ${moved}`);
  const mail_q = await key_and_state(instance, ["q"], 1000);
  check(app, kind, "q in the mail tab closes no tab", (mail_q.windows.find((window) => window.type === "normal")?.tabs ?? []).length === before);

  // A message tab: the body takes the keys while it has the focus, and the pages bundle takes them with the focus in the header. F6 moves the focus between the two, so each route runs the same keys and the shots show where the focus was.
  const message_region = "0,150 1260x480";
  for (const route of ["opened", "after F6"]) {
    await instance.ask("select_tab", 20000, { index: 0 });
    await sleep(500);
    await instance.ask("open_message_tab");
    await sleep(2500);
    await wait_window_focus(instance);
    const message_tabs = await tabs_of();
    check(app, kind, `a message tab opens (${route})`, message_tabs.length === before + 1, `tabs ${JSON.stringify(message_tabs.map((tab) => tab.type))}`);
    if (route === "after F6") {
      await instance.press(["-k", "F6"]);
      await sleep(500);
    }
    await shot(`message_tab_${route.replace(" ", "_")}`, `message tab ${route}, before the keys`);
    const body_before = await hud_pixels(instance, `${app}_message_tab_${route.replace(" ", "_")}_before`, message_region);
    for (let count = 0; count < 5; count++) await instance.press(["j"]);
    await sleep(500);
    note(app, kind, `message tab ${route}: j changed the page pixels`, String((await hud_pixels(instance, `${app}_message_tab_${route.replace(" ", "_")}_after`, message_region)) !== body_before));
    await instance.press([":"]);
    await sleep(1500);
    await shot(`message_tab_${route.replace(" ", "_")}_cmdline`, `message tab ${route} after the colon key`);
    await close_command_line(instance);
    const closed = await key_and_state(instance, ["q"], 2000);
    check(app, kind, `q closes the message tab (${route})`, (closed.windows.find((window) => window.type === "normal")?.tabs ?? []).length === before, `tabs ${(closed.windows.find((window) => window.type === "normal")?.tabs ?? []).length}`);
  }
  // The tab keys on three tabs: the mail tab and two message tabs. The helper add-on switches tabs by the tabs API, which is what `tl` reads.
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(500);
  for (let count = 0; count < 2; count++) {
    await instance.ask("open_message_tab");
    await sleep(2500);
    await instance.ask("select_tab", 20000, { index: 0 });
    await sleep(500);
  }
  const active_index = async () => (await tabs_of()).find((tab) => tab.active)?.index;
  const order_of = async () => (await tabs_of()).map((tab) => tab.id);
  const start_order = await order_of();
  check(app, kind, "two message tabs open for the tab keys", start_order.length === before + 2, `tabs ${start_order.length}, expected ${before + 2}`);
  await instance.press(["t"]);
  await instance.press(["$"]);
  await sleep(1000);
  check(app, kind, "t$ goes to the last tab", (await active_index()) === before + 1, `active ${await active_index()}`);
  await instance.press(["t"]);
  await instance.press(["l"]);
  await sleep(1000);
  check(app, kind, "tl goes back to the tab t$ left", (await active_index()) === 0, `active ${await active_index()}`);
  await instance.press(["t"]);
  await instance.press(["l"]);
  await sleep(1000);
  check(app, kind, "tl a second time returns to the last tab", (await active_index()) === before + 1, `active ${await active_index()}`);
  // tm types the command in, so one more key and Enter move the last tab to place 2.
  await instance.press(["t"]);
  await instance.press(["m"]);
  await sleep(1500);
  await shot("tab_move_cmdline", "the last message tab after tm: the command line shows tab.move");
  await instance.press(["2"]);
  await instance.press(["-k", "Return"]);
  await sleep(1500);
  const moved_order = await order_of();
  check(app, kind, "tm then 2 moves the last tab to place 2", moved_order[1] === start_order[2] && moved_order[2] === start_order[1] && moved_order[0] === start_order[0], `before ${JSON.stringify(start_order)}, after ${JSON.stringify(moved_order)}`);
  // tM types the offset flag. The tab sits at place 2 after tm, so 1 moves it back to the end and -5 moves it to place 2 again, stopping before the mail tab.
  for (const [typed, expected, label] of [[[["1"]], [start_order[0], start_order[1], start_order[2]], "tM then 1 moves the tab one place later"], [[["-k", "minus"], ["5"]], [start_order[0], start_order[2], start_order[1]], "tM then -5 stops before the mail tab"]]) {
    await instance.press(["t"]);
    await instance.press(["M"]);
    await sleep(1500);
    for (const key of typed) await instance.press(key);
    await instance.press(["-k", "Return"]);
    await sleep(1500);
    const order = await order_of();
    check(app, kind, label, JSON.stringify(order) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, after ${JSON.stringify(order)}`);
  }
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(500);
  for (let count = 0; count < 2; count++) await instance.ask("remove_tab", 20000, { index: before });
  await sleep(1000);
  check(app, kind, "the tab key rows leave no tab behind", (await tabs_of()).length === before);
}
