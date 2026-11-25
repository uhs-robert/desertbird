import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sleep, CTRL_SHIFT, CTRL, first_selected, same, selects, at_bottom, at_top, leaves_row, listed_count, pane_is } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";
import { panes_helpers, show_inbox_listed } from "./_panes_shared.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";
import { insert_label } from "./_insert_label.mjs";

export const areas = ["panes"];

// A point in the body of the message pane, below the message header, in both apps.
const READING_PANE_POINT = [800, 500];

// Pane focus and folder row folds: native Down moves the selection of the pane that has focus, so it tells which pane a key focused. Then the chords, the hidden panes, the page keys and the leader.
async function run_panes_focus(instance, ctx) {
  const { app, kind, shot, check, note, wait_for_state } = ctx;
  const { folder_of, press_state, down, up, keys, tabs_of, folder_lands_on, folder_leaves, at_second_last, only_tab, opens_tab } = panes_helpers(instance, ctx);
  await show_inbox_listed(instance, ctx);
  await keys(["g", "e"]);
  await keys(["g", "g"], at_top);
  await keys(["g", "f"]);
  let state = await down(folder_leaves("/Inbox"));
  check(app, kind, "g f puts the focus in the folder pane: Down moves the folder, not the list", folder_of(state) !== "/Inbox" && folder_of(state) !== null, `folder ${folder_of(state)}`);
  await up(folder_lands_on("/Inbox"));
  // The row above the Inbox is the account row. h closes it, so Down finds no row below. l opens it, so Down reaches the Inbox.
  state = await up(folder_leaves("/Inbox"));
  const account_folder = folder_of(state);
  await keys(["h"]);
  await shot("panes_h", "the account row closed by h in the folder pane");
  state = await down();
  check(app, kind, "h in the folder pane closes the selected row, so Down stays on it", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  await up();
  await keys(["l"]);
  await shot("panes_l", "the account row opened by l in the folder pane");
  state = await down(folder_lands_on("/Inbox"));
  check(app, kind, "l in the folder pane opens the selected row, so Down reaches the Inbox", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);

  // j, k, g g and G move the folder selection while the folder pane has the focus. The account row is the first row and the Inbox the second.
  state = await keys(["j"], { what: "j to move the folder selection below the Inbox", until: (current) => ![null, "/Inbox", account_folder].includes(folder_of(current)), show: (current) => `folder ${folder_of(current)}` });
  const below_inbox = folder_of(state);
  check(app, kind, "j in the folder pane moves the folder selection down", ![null, "/Inbox", account_folder].includes(below_inbox), `folder ${below_inbox}`);
  state = await keys(["k"], folder_lands_on("/Inbox"));
  check(app, kind, "k in the folder pane moves the folder selection up", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);
  // Views is the last folder of the fixture. The thread list shows its messages, so the selection also opened the folder.
  const views_listed_in = (current) => same([...current.listed].sort(), [...(current.folders["/Views"] ?? [])].sort());
  state = await keys(["G"], { what: "G to select the last folder and list it", until: (current) => folder_of(current) === "/Views" && views_listed_in(current), show: (current) => `folder ${folder_of(current)}, ${current.listed.length} listed` });
  const views_listed = views_listed_in(state);
  check(app, kind, "G in the folder pane selects the last folder and the list shows it", folder_of(state) === "/Views" && views_listed, `folder ${folder_of(state)}, list shows the Views messages ${views_listed}`);
  await shot("panes_folder_G", "the last folder selected by G in the folder pane");
  state = await keys(["g", "g"], folder_lands_on(account_folder));
  check(app, kind, "g g in the folder pane selects the account row", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  state = await keys(["j"], folder_lands_on("/Inbox"));
  check(app, kind, "the folder pane keeps the focus after the motions, so j reaches the Inbox", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);

  // z M, z R and h fold folders. Native Down tells the tree state: with the account row closed it finds no row below, with it open it reaches the Inbox.
  await keys(["g", "g"], folder_lands_on(account_folder));
  await keys(["z", "M"]);
  await shot("panes_zM", "every folder closed by z M");
  state = await down();
  check(app, kind, "z M in the folder pane closes every folder, so Down stays on the account row", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  await shot("panes_zM_down", "the folder pane after Down from the closed account row");
  await keys(["z", "R"]);
  state = await down(folder_lands_on("/Inbox"));
  check(app, kind, "z R in the folder pane opens every folder, so Down reaches the Inbox", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);
  await keys(["g", "g"], folder_lands_on(account_folder));
  await keys(["h"]);
  state = await down();
  check(app, kind, "h on an open folder closes it, so Down stays on it", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  await keys(["z", "R"]);
  await keys(["g", "g"], folder_lands_on(account_folder));
  await keys(["j"], folder_lands_on("/Inbox"));

  // <C-d> and <C-u> in the thread list move ten rows: the fixture list is ten threads, so the first row goes to the last and back.
  await keys(["L"]);
  const top_state = await keys(["g", "g"], at_top);
  const first_row = first_selected(top_state);
  const row_ids = top_state.listed;
  const expected_down = row_ids[Math.min(row_ids.indexOf(first_row) + 10, row_ids.length - 1)];
  const after_down = first_selected(await press_state(CTRL("d"), selects(expected_down)));
  check(app, kind, "<C-d> in the thread list moves the selection ten rows down", after_down !== null && after_down === expected_down, `selected ${first_row} then ${after_down}, expected ${expected_down} of ${row_ids.length} rows`);
  const after_up = first_selected(await press_state(CTRL("u"), selects(first_row)));
  check(app, kind, "<C-u> in the thread list moves the selection back up", after_up === first_row, `selected ${first_row} then ${after_down} then ${after_up}`);
  await shot("panes_ctrl_d_u", "the selection after <C-d> then <C-u>");
  await keys(["H"]);

  // The chords move the focus one pane left or right. Native Down tells which pane has the focus: it moves the folder or the list selection, and in the message it moves no row.
  const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
  const list_moved = async (name, row_before) => {
    const after = first_selected(await down(leaves_row(row_before)));
    check(app, kind, name, after !== row_before && after !== null, `selected ${row_before} then ${after}`);
  };
  await keys(["L"]);
  await list_moved("L in the folder pane focuses the thread list: Down moves the selection", first_selected(await keys(["g", "g"], at_top)));
  await keys(["H"]);
  state = await down(folder_leaves("/Inbox"));
  check(app, kind, "H in the thread list focuses the folder pane: Down moves the folder", ![null, "/Inbox"].includes(folder_of(state)), `folder ${folder_of(state)}`);
  await up(folder_lands_on("/Inbox"));
  await list_moved("A-l in the folder pane focuses the thread list: Down moves the selection", first_selected(await press_state(ALT("l"))));
  // The message pane takes the focus only with one message shown: the Inbox threads open collapsed and show a summary, so each entry starts on the second last row, a single message. Down in the message moves no row, which proves A-l reached it.
  const enter_message = async () => {
    await keys(["G"], at_bottom);
    const row = first_selected(await keys(["k"], at_second_last));
    await press_state(ALT("l"), 1500);
    return { row, in_message: first_selected(await down()) === row };
  };
  let entered = await enter_message();
  check(app, kind, "A-l in the thread list focuses the message pane: Down leaves the selection alone", entered.in_message, `selected ${entered.row}`);
  await shot("panes_alt_l", "the message pane focused by A-l");
  // The body script takes the keys in the message, so the chords are bound there too.
  await list_moved("A-h in the message pane focuses the thread list: Down moves the selection", first_selected(await press_state(ALT("h"), 1500)));
  entered = await enter_message();
  await keys(["H"], 1500);
  state = await down(leaves_row(entered.row));
  check(app, kind, "H in the message pane focuses the thread list, the pane to its left: Down moves the selection", entered.in_message && first_selected(state) !== entered.row, `in the message ${entered.in_message}, selected ${entered.row} then ${first_selected(state)}`);
  entered = await enter_message();
  await keys(["H"], 1500);
  await keys(["H"], 1500);
  state = await down(folder_leaves("/Inbox"));
  check(app, kind, "a second H from the message pane reaches the folder pane: Down moves the folder", entered.in_message && ![null, "/Inbox"].includes(folder_of(state)), `in the message ${entered.in_message}, folder ${folder_of(state)}`);
  await up(folder_lands_on("/Inbox"));
  await keys(["L"]);

  // A hidden pane takes no focus: the keys stay in the thread list, so Down moves the selection. Each check starts on the first row, so Down has a row to reach.
  await keys(["g", "g"], at_top);
  state = await keys(["w", "f"], pane_is("folder", false));
  const folder_pane_hidden = state.mail_tab?.folder_pane_visible === false;
  let list_row = first_selected(await keys(["H"], 1500));
  state = await down(leaves_row(list_row));
  check(app, kind, "H with the folder pane hidden leaves the focus in the thread list", folder_pane_hidden && first_selected(state) !== list_row && folder_of(state) === "/Inbox", `hidden ${folder_pane_hidden}, selected ${list_row} then ${first_selected(state)}, folder ${folder_of(state)}`);
  await shot("panes_hidden_folder_H", "H with the folder pane hidden: the focus stays");
  await keys(["w", "f"], pane_is("folder", true));
  await keys(["g", "g"], at_top);
  state = await keys(["w", "m"], pane_is("message", false));
  const message_pane_hidden = state.mail_tab?.message_pane_visible === false;
  list_row = first_selected(await press_state(ALT("l"), 1500));
  await shot("panes_hidden_message_alt_l", "A-l with the message pane hidden: the focus stays");
  state = await down(leaves_row(list_row));
  check(app, kind, "A-l with the message pane hidden leaves the focus in the thread list", message_pane_hidden && first_selected(state) !== list_row, `hidden ${message_pane_hidden}, selected ${list_row} then ${first_selected(state)}, folder ${folder_of(state)}`);
  await keys(["w", "m"], pane_is("message", true));

  // A chord typed into a text field passes through to it: H types into the quick filter. After each chord an a typed next must still reach the field: no subject holds "Ha", so the list empties. Had the focus left for the list, a would archive instead.
  const listed_before = (await keys(["g", "g"], at_top)).listed.length;
  await instance.press(CTRL_SHIFT("k"));
  await sleep(800);
  state = await press_state(["H"], { what: "H to narrow the list in the quick filter", until: (current) => current.listed.length < listed_before, show: (current) => `${current.listed.length} listed` });
  const listed_after_h = state.listed.length;
  check(app, kind, "H in the quick filter types into it: the list narrows and the folder stays", state.listed.length < listed_before && folder_of(state) === "/Inbox", `listed ${listed_before} then ${state.listed.length}, folder ${folder_of(state)}`);
  state = await press_state(["a"], listed_count(0));
  check(app, kind, "after H the quick filter keeps the focus: a types into it", state.listed.length === 0, `listed ${state.listed.length}`);
  await press_state(["-k", "BackSpace"], listed_count(listed_after_h));
  await press_state(ALT("l"), 1500);
  state = await press_state(["a"], listed_count(0));
  check(app, kind, "after A-l the quick filter keeps the focus: a types into it", state.listed.length === 0 && folder_of(state) === "/Inbox", `listed ${state.listed.length}, folder ${folder_of(state)}`);
  await shot("panes_quick_filter_H", "H typed into the quick filter");
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  await instance.press(["-k", "Escape"]);
  await sleep(800);

  // g i opens the Inbox and moves the focus to its thread list, also from the folder pane: Down moves the selection and not the folder.
  await keys(["g", "f"]);
  state = await keys(["j"], { what: "j to open a folder below the Inbox", until: (current) => ![null, "/Inbox", account_folder].includes(folder_of(current)), show: (current) => `folder ${folder_of(current)}` });
  await keys(["g", "i"], folder_lands_on("/Inbox"));
  const row_after_gi = first_selected(await keys(["g", "g"], at_top));
  const after_gi = first_selected(await down(leaves_row(row_after_gi)));
  state = await instance.ask("state");
  check(app, kind, "g i from the folder pane opens the Inbox and focuses its thread list: Down moves the selection and not the folder", after_gi !== row_after_gi && after_gi !== null && folder_of(state) === "/Inbox", `selected ${row_after_gi} then ${after_gi}, folder ${folder_of(state)}`);
  // :open ends with the focus in the thread list too, although the command line gave the focus back to the folder pane first.
  await keys(["g", "f"]);
  await keys(["j"], { what: "j to open a folder below the Inbox", until: (current) => ![null, "/Inbox", account_folder].includes(folder_of(current)), show: (current) => `folder ${folder_of(current)}` });
  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["open /Inbox"]);
  await instance.press(["-k", "Return"]);
  await wait_for_state(instance, folder_lands_on("/Inbox"));
  const row_after_open = first_selected(await keys(["g", "g"], at_top));
  const after_open = first_selected(await down(leaves_row(row_after_open)));
  state = await instance.ask("state");
  check(app, kind, ":open /Inbox from the folder pane focuses the thread list: Down moves the selection and not the folder", after_open !== row_after_open && after_open !== null && folder_of(state) === "/Inbox", `selected ${row_after_open} then ${after_open}, folder ${folder_of(state)}`);

  const list_before = first_selected(await keys(["g", "e"]));
  state = await down(leaves_row(list_before));
  check(app, kind, "g e puts the focus in the thread list: Down moves the selection and not the folder", first_selected(state) !== list_before && folder_of(state) === "/Inbox", `selected ${list_before} then ${first_selected(state)}, folder ${folder_of(state)}`);
  await keys(["G"], at_bottom);
  const message_before = first_selected(await keys(["g", "m"]));
  state = await down();
  check(app, kind, "g m puts the focus in the message pane: Down leaves the selection alone", first_selected(state) === message_before, `selected ${message_before} then ${first_selected(state)}`);
  await shot("panes_gm", "the message pane focused by g m");
  await keys(["g", "e"]);

  // Each page opens in a tab of the window. The reset closes it so the next key runs in the mail tab.
  for (const [key, page, address] of [["a", "addons", "about:addons"], ["t", "themes", "about:addons"], ["c", "config", "about:config"]]) {
    state = await keys(["g", "p", key], opens_tab(`the ${page} page`, (tab) => tab === address));
    check(app, kind, `g p ${key} opens the ${page} page in a tab`, tabs_of(state).includes(address), `tabs ${tabs_of(state).join(" ")}`);
    await shot(`panes_gp${key}`, `the page g p ${key} opened`);
    await instance.ask("reset_tabs");
    await wait_for_state(instance, only_tab);
    await keys(["g", "e"]);
  }
  // The spaces and account pages. A page that is no plain URL tab matches by the tab type the helper reports. Each opens in a tab of the window, and g p m then the same key again switch between tabs without opening a second one.
  const tab_list = (current) => current.windows.flatMap((window) => window.tabs);
  const describe_tabs = (current) => tab_list(current).map((tab) => `${tab.type} ${tab.raw.url ?? tab.title}`).join(", ");
  const is_url = (address) => (tab) => tab.raw.url === address;
  const is_type = (type) => (tab) => tab.type === type;
  const active_is = (test) => ({ what: "the active tab to change", until: (current) => tab_list(current).some((tab) => tab.active && test(tab)), show: describe_tabs, timeout_ms: 8000 });
  for (const [key, page, is_page, takes_typing] of [
    ["i", "troubleshooting", is_url("about:support")],
    ["l", "calendar", is_type("calendar")],
    ["k", "tasks", is_type("tasks")],
    ["n", "account settings", is_url("about:accountsettings")],
    ["d", "saved files", is_url("about:downloads")],
    // These two focus a search field when they open, which takes g p m as typing, so the helper selects the mail tab for them.
    ["b", "address book", is_type("addressBook"), true],
    ["s", "settings", (tab) => tab.type === "special" || (tab.raw.url ?? "").includes("preferences"), true],
    // Betterbird opens the activity manager in a tab (mail.activity.managerInTab is on there). Thunderbird shows a window, checked below.
    ...(app === "betterbird" ? [["y", "activity manager", is_url("chrome://messenger/content/activity.xhtml")]] : []),
  ]) {
    state = await keys(["g", "p", key], { what: `the ${page} page to open in a tab`, until: (current) => tab_list(current).some(is_page), show: describe_tabs, timeout_ms: 15000 });
    check(app, kind, `g p ${key} opens the ${page} page in a tab`, tab_list(state).some(is_page), `tabs ${describe_tabs(state)}`);
    const count = tab_list(state).length;
    if (takes_typing) await instance.ask("select_tab", 20000, { index: 0 });
    else state = await keys(["g", "p", "m"], active_is(is_type("mail")));
    if (!takes_typing) check(app, kind, "g p m switches to the mail tab and opens no tab", tab_list(state).some((tab) => tab.active && tab.type === "mail") && tab_list(state).length === count, `tabs ${describe_tabs(state)}`);
    state = await keys(["g", "p", key], active_is(is_page));
    check(app, kind, `g p ${key} again switches to the ${page} tab and opens no second one`, tab_list(state).some((tab) => tab.active && is_page(tab)) && tab_list(state).length === count, `tabs ${describe_tabs(state)}`);
    await shot(`panes_gp${key}`, `the page g p ${key} opened`);
    await instance.ask("reset_tabs");
    await wait_for_state(instance, only_tab);
    await keys(["g", "e"]);
  }
  // Thunderbird shows the activity manager as a window of its own, so a changed middle of the screen shows it, and Escape closes it. Betterbird opens a tab, which the loop above checks.
  if (app !== "betterbird") {
    const activity_region = "400,200 480x320";
    const activity_pixels = async (name) => (await instance.shot_region(name, activity_region, "ppm")) && readFileSync(join(instance.out_dir, `${name}.ppm`));
    const before_activity = await activity_pixels("panes_gp_y_before");
    await keys(["g", "p", "y"], 2500);
    const with_activity = await activity_pixels("panes_gp_y_open");
    check(app, kind, "g p y opens the activity manager", !before_activity.equals(with_activity), "the middle of the window did not change");
    await shot("panes_gpy", "the activity manager g p y opened");
    await instance.press(["-k", "Escape"]);
    await sleep(800);
    const after_activity = await activity_pixels("panes_gp_y_after");
    check(app, kind, "Escape closes the activity manager", !after_activity.equals(with_activity), "the middle of the window still shows it");
    await keys(["g", "e"]);
  }
  // The e2e profile turns chat off, so g p h opens nothing.
  state = await keys(["g", "p", "h"], 2000);
  check(app, kind, "g p h opens no chat tab while chat is turned off", !tab_list(state).some(is_type("chat")) && tab_list(state).length === 1, `tabs ${describe_tabs(state)}`);
  // The leader: , h opens the help page and , s the options page, each in a tab of the window.
  for (const [key, page, fragment] of [["h", "help", "help/help.html"], ["s", "options", "options"]]) {
    const is_page = (tab) => tab.startsWith("moz-extension:") && tab.includes(fragment);
    state = await keys([",", key], opens_tab(`the ${page} page`, is_page));
    check(app, kind, `, ${key} opens the ${page} page in a tab`, tabs_of(state).some(is_page), `tabs ${tabs_of(state).join(" ")}`);
    await instance.ask("reset_tabs");
    await wait_for_state(instance, only_tab);
    await keys(["g", "e"]);
  }
  // The conversation command may be disabled and open nothing, so no state says it finished: this wait stays fixed.
  state = await keys(["g", "C"], 2500);
  note(app, kind, "g C", `tabs after: ${tabs_of(state).length}; the conversation command is ${tabs_of(state).length > 1 ? "enabled and opened a tab" : "disabled, so it opened nothing"}`);
  await instance.ask("reset_tabs");
  await wait_for_state(instance, only_tab);
  await keys(["g", "e"]);

  // Insert mode: `i` shows INSERT, plain keys then reach Thunderbird and run no binding, and Escape returns to NORMAL. Escape here starts in about:3pane, so this also proves it bubbles back to the window.
  const label = insert_label(instance, ctx);
  await keys(["g", "e"]);
  const list_top = first_selected(await keys(["g", "g"], at_top));
  let normal = await label.normal();
  let insert = await label.enter(normal);
  check(app, kind, "i in the thread list changes the label to insert", insert !== normal, `normal ${normal.slice(0, 8)}, insert ${insert.slice(0, 8)}`);
  // G is no Thunderbird key, so it reaches nothing here, and in normal mode it selects the last row.
  state = await keys(["G"], 1000);
  check(app, kind, "G in insert mode in the thread list moves no row, since no binding runs", first_selected(state) === list_top, `selected ${list_top} then ${first_selected(state)}`);
  check(app, kind, "Escape ends insert mode in the thread list and the label returns", (await label.leave(normal)) === normal);
  state = await keys(["G"], at_bottom);
  check(app, kind, "G moves the row again after Escape", first_selected(state) !== list_top, `selected ${list_top} then ${first_selected(state)}`);
  await keys(["g", "g"], at_top);
  // Focus moving into the reading pane with a click and no key ends insert and visual mode of the list at once, so the label is back to normal before any key. `g e` returns the focus to the list for the next run.
  for (const [name, key] of [["insert", "i"], ["visual", "v"]]) {
    normal = await label.normal();
    const entered = await label.enter(normal, key);
    await instance.click(...READING_PANE_POINT);
    const after = await label.leave(normal, null);
    check(app, kind, `${name} mode in the thread list ends when a click moves the focus into the reading pane, and the label returns with no key`, entered !== normal && after === normal, `normal ${normal.slice(0, 8)}, ${name} ${entered.slice(0, 8)}, after ${after.slice(0, 8)}`);
    await keys(["g", "e"]);
  }
  await keys(["g", "f"]);
  normal = await label.normal();
  insert = await label.enter(normal);
  check(app, kind, "i in the folder pane changes the label to insert", insert !== normal, `normal ${normal.slice(0, 8)}, insert ${insert.slice(0, 8)}`);
  state = await keys(["G"], 1000);
  check(app, kind, "G in insert mode in the folder pane moves no folder", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);
  // The folder tree cancels every key it handles, Escape included, so the runtime leaves on a cancelled Escape there.
  check(app, kind, "Escape ends insert mode in the folder pane and the label returns", (await label.leave(normal)) === normal);
  state = await keys(["G"], folder_lands_on("/Views"));
  check(app, kind, "G selects the last folder again after Escape", folder_of(state) === "/Views", `folder ${folder_of(state)}`);
  await keys(["g", "g"]);
  await keys(["j"], folder_lands_on("/Inbox"));
  await keys(["L"]);
}

export const piece = { ...section_piece({ section: "panes_focus", only: ["panes"], run: run_panes_focus }), deadline_s: LONG_PIECE_DEADLINE_S };
