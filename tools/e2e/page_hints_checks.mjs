// `f` in the page tabs: labels over the calendar, the settings and the address book, Escape, a key typed after the hold of the page keys, and a pick. Runs at the end of the `pages` kind, or alone with `E2E_ONLY=page_hints`. It takes the helpers of `run.mjs` as arguments, as `pages_checks.mjs` does.
// The routes and click positions are the ones `pages_checks.mjs` measured, copied so that file stays as it is.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CTRL_SHIFT = (key) => ["-M", "ctrl", "-M", "shift", key, "-m", "shift", "-m", "ctrl"];
const SPACES = { calendar: [22, 112], settings: [22, 653] };
// The whole window but the right edge, where an overlay scrollbar fades out on its own.
const WHOLE_WINDOW = "0,0 1264x720";
const MAIL_TAB_LABEL = { thunderbird: "al", betterbird: "al" };
// The page keys drop plain keys for 1.5 s after `f`. A key typed later meets the page keys, and only the marker of the pick keeps it from running there.
const PAST_THE_HOLD_MS = 2500;

export async function run_page_hints(instance, { check, note, shot, key_and_state, hud_pixels }) {
  const app = instance.app;
  const kind = "pages";
  const tabs_of = async () => (await instance.ask("state")).windows.find((window) => window.type === "normal")?.tabs ?? [];
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(500);
  const before = (await tabs_of()).length;

  async function hint_tab({ name, open, leave_field = null, page_pick = null, region = WHOLE_WINDOW }) {
    const slug = name.replace(/\W+/g, "_");
    const pixels = (step) => hud_pixels(instance, `${app}_hints_${slug}_${step}`, region);
    await open();
    await sleep(3000);
    if ((await tabs_of()).length !== before + 1) return check(app, kind, `hints: the ${name} tab opens`, false, `tabs ${(await tabs_of()).length}`);
    if (leave_field) {
      await leave_field();
      await sleep(800);
    }
    // One round of labels first: the first pick loads the bundle, and a click above leaves a hover mark that the labels end. The reference is taken after it.
    await instance.press(["f"]);
    await sleep(2000);
    await instance.press(["-k", "Escape"]);
    await sleep(800);
    const plain = await pixels("plain");

    await instance.press(["f"]);
    await sleep(1000);
    check(app, kind, `hints: f labels the ${name} tab`, (await pixels("labels")) !== plain);
    await shot(`hints_${slug}`, `${name} tab after f: a label on each control of the window and the page`);
    await instance.press(["-k", "Escape"]);
    await sleep(800);
    check(app, kind, `hints: Escape removes the labels of the ${name} tab`, (await pixels("escaped")) === plain);

    // `q` starts no label, so it ends the labels and is swallowed. With the page keys in charge it would close the tab.
    await instance.press(["f"]);
    await sleep(PAST_THE_HOLD_MS);
    check(app, kind, `hints: the ${name} labels still show past the hold`, (await pixels("past_hold")) !== plain);
    const after_q = await key_and_state(instance, ["q"], 1500);
    const open_tabs = (after_q.windows.find((window) => window.type === "normal")?.tabs ?? []).length;
    check(app, kind, `hints: q typed past the hold while the ${name} labels show closes no tab`, open_tabs === before + 1, `tabs ${open_tabs}, expected ${before + 1}`);
    check(app, kind, `hints: that q removes the labels of the ${name} tab`, (await pixels("q_ended")) === plain);

    if (page_pick) {
      const region_before = await hud_pixels(instance, `${app}_hints_${slug}_page_pick_before`, page_pick.region);
      await instance.press(["f"]);
      await sleep(1000);
      for (const letter of page_pick.label) await instance.press([letter]);
      await sleep(1000);
      check(app, kind, `hints: the label ${page_pick.label} in the ${name} tab ${page_pick.does}`, (await hud_pixels(instance, `${app}_hints_${slug}_page_pick_after`, page_pick.region)) !== region_before);
      await shot(`hints_${slug}_page_pick`, `${name} tab after the label ${page_pick.label}: it ${page_pick.does}`);
    }

    // The label of the mail tab on the tab strip, read from the shots. A pick of it selects the mail tab: the act of a pick in a page tab.
    await instance.press(["f"]);
    await sleep(1000);
    for (const letter of MAIL_TAB_LABEL[app]) await instance.press([letter]);
    await sleep(1000);
    const picked = (await instance.ask("state")).windows.find((window) => window.type === "normal")?.tabs ?? [];
    check(app, kind, `hints: the label ${MAIL_TAB_LABEL[app]} in the ${name} tab selects the mail tab`, picked.length === before + 1 && picked.findIndex((tab) => tab.active) === 0, `tabs ${JSON.stringify(picked.map((tab) => `${tab.type}${tab.active ? "*" : ""}`))}`);
    await shot(`hints_${slug}_picked`, `the mail tab after the label ${MAIL_TAB_LABEL[app]} was typed in the ${name} tab, no labels left`);

    await instance.ask("select_tab", 20000, { index: before });
    await sleep(800);
    await key_and_state(instance, ["q"], 2000);
    if ((await tabs_of()).length !== before) {
      await instance.ask("remove_tab", 20000, { index: before });
      await sleep(1000);
    }
    await instance.ask("select_tab", 20000, { index: 0 });
    await sleep(500);
  }

  // The week grid draws a line at the current time, which moves each minute, so the calendar compares the part of the window above the grid.
  await hint_tab({ name: "calendar", open: () => instance.click(...SPACES.calendar), region: "0,0 1264x320" });
  // The search field of each of these two has the focus on open, and `f` typed there is text. The clicks are those of `pages_checks.mjs`.
  await hint_tab({ name: "settings", open: () => instance.click(...SPACES.settings), leave_field: async () => { await instance.click(160, 321); await sleep(500); await instance.click(1220, 450); } });
  await hint_tab({ name: "address book", open: () => instance.press(CTRL_SHIFT("b")), leave_field: () => instance.click(165, 151), page_pick: { label: "sk", does: "selects the Personal Address Book row of its page", region: "45,130 240x100" } });
  check(app, kind, "hints: the app survived the page hint checks", instance.exited() === null);
}
