// The view settings, read as row counts of the Views folder.

import { same, listed_count, pane_is, selects, sorted_by } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["views", "cmdline"];

// The view settings, read as row counts of the Views folder (6 messages: 3 unread, 2 starred, 1 with an attachment, 2 tagged).
// The tag and search forms have no default key, so the helper applies the same arguments the handlers send, straight through the API.
async function run_view_settings(instance, ctx) {
  const { app, kind, check, note, wait_state, wait_for_state, key_and_state, open_command_line, press_in_command_line, close_command_line } = ctx;
  const prepared = await instance.ask("prepare_views", 30000);
  check(app, kind, "the helper shows the Views folder and tags two messages", prepared.prepared === true, prepared.error ?? JSON.stringify(prepared.seen));
  let state = await wait_state(instance, "the Views folder to list its 6 messages", (current) => current.mail_tab?.folder === "/Views" && current.listed.length === 6, { soft: true, timeout_ms: 10000 });
  check(app, kind, "the Views folder is displayed with 6 messages", state.mail_tab?.folder === "/Views" && state.listed.length === 6, `folder ${state.mail_tab?.folder}, listed ${state.listed.length}`);
  const listed_after = async (args, count) => (await key_and_state(instance, args, listed_count(count))).listed.length;
  for (const [name, keys, expected] of [["unread", ["F", "u"], 3], ["starred", ["F", "s"], 2], ["attachment", ["F", "a"], 1], ["reset", ["F", "r"], 6]]) {
    await instance.press([keys[0]]);
    const count = await listed_after([keys[1]], expected);
    check(app, kind, `F ${keys[1]} (${name}) shows ${expected} rows`, count === expected, `listed ${count}`);
  }
  // F s from the unfiltered list, with no F u before it, must switch starred on and a second F s off again.
  await instance.press(["F"]);
  const starred_alone = await listed_after(["s"], 2);
  await instance.press(["F"]);
  const starred_off = await listed_after(["s"], 6);
  check(app, kind, "F s on its own shows 2 rows and a second F s shows all 6 again", starred_alone === 2 && starred_off === 6, `listed ${starred_alone} then ${starred_off}`);
  // F f is no filter key: it opens the command line, where j types text instead of moving, and Escape closes it.
  const selection_of = (current) => current.selected.map((message) => message.header_id).join(",");
  const selected_before_f = selection_of(await instance.ask("state"));
  await instance.press(["F"]);
  await open_command_line(instance, ["f"]);
  // The line draws the j, which proves it took the key and the list did not.
  await press_in_command_line(instance, ["j"]);
  state = await instance.ask("state");
  check(app, kind, "F f opens the command line, so j typed into it moves no selection", selection_of(state) === selected_before_f, `selected ${selected_before_f} then ${selection_of(state)}`);
  await close_command_line(instance);
  state = await key_and_state(instance, ["j"], { what: "j to move the selection after the line closed", until: (current) => selection_of(current) !== selected_before_f, show: (current) => `selected ${selection_of(current)}` });
  check(app, kind, "Escape closes the command line, so j moves the selection again", selection_of(state) !== selected_before_f, `selected ${selected_before_f} then ${selection_of(state)}`);
  await instance.ask("api_view", 20000, { filter: { tags: { mode: "any", tags: { $label1: true } } } });
  state = await wait_for_state(instance, listed_count(2));
  const tagged = Object.entries(state.flags).filter(([, flags]) => flags.tags?.length).map(([id]) => id);
  check(app, kind, "the tag filter the handler sends shows the 2 tagged rows", state.listed.length === 2, `listed ${state.listed.length}, tagged messages ${JSON.stringify(tagged)}`);
  await instance.ask("api_view", 20000, { filter: { text: { text: "Views 3", subject: true, author: true } } });
  state = await wait_for_state(instance, listed_count(1));
  check(app, kind, "the text filter search.threads sends shows 1 row", state.listed.length === 1);
  await instance.ask("api_view", 20000, { filter: {} });
  state = await wait_for_state(instance, listed_count(6));
  check(app, kind, "clearing with {} restores 6 rows", state.listed.length === 6);
  // F m f, s and t read (F m r has no row count to show here, since every Views message has the same recipient, and the unit tests cover it) the selected message. Each sender and subject in the folder is its own, so one row stays, and the two tagged rows stay for the tag. The sender names hold spaces, so the sender row also shows that a name with spaces matches.
  const rows = state.listed;
  const select_row = async (header_id) => {
    await instance.press(["g"]);
    await key_and_state(instance, ["g"], selects(rows[0]));
    for (let step = 0; step < rows.indexOf(header_id); step += 1) await key_and_state(instance, ["j"], selects(rows[step + 1]));
  };
  const filtered_by = async (field_key, count) => {
    await instance.press(["F"]);
    await instance.press(["m"]);
    return (await key_and_state(instance, [field_key], listed_count(count))).listed;
  };
  const clear_to_all = async () => {
    await instance.press(["F"]);
    await key_and_state(instance, ["r"], listed_count(6));
  };
  await select_row(rows[3]);
  check(app, kind, "F m f shows only the mail of the selected sender", same(await filtered_by("f", 1), [rows[3]]));
  await clear_to_all();
  check(app, kind, "F m s shows only the mail with the selected subject", same(await filtered_by("s", 1), [rows[3]]));
  await clear_to_all();
  await select_row("views-4@fixture.invalid");
  check(app, kind, "F m t shows the mail with a tag of the selected message", same(await filtered_by("t", 2), ["views-4@fixture.invalid", "views-5@fixture.invalid"]));
  await clear_to_all();
  await select_row("views-1@fixture.invalid");
  await instance.press(["F"]);
  await key_and_state(instance, ["s"], listed_count(2));
  check(app, kind, "F s then F m s keeps the starred filter and adds the subject", same(await filtered_by("s", 1), ["views-1@fixture.invalid"]));
  await clear_to_all();
  // The Views messages rise in date and subject with their number, and the sender names follow the order in profile.mjs, so each sort key shows as the row order.
  const views_rows = (by, order) => {
    const ascending = by === "author" ? [2, 4, 0, 3, 5, 1] : [0, 1, 2, 3, 4, 5];
    return (order === "ascending" ? ascending : [...ascending].reverse()).map((index) => `views-${index}@fixture.invalid`);
  };
  for (const [name, keys, sort_type, sort_order] of [
    ["date", ["d"], "date", "descending"],
    ["subject", ["j"], "subject", "ascending"],
    ["current column, order toggled", ["o"], "subject", "descending"],
    ["author", ["f"], "author", "ascending"],
    ["current column, order toggled", ["o"], "author", "descending"],
  ]) {
    await instance.press(["s"]);
    const sorted = sorted_by(sort_type, sort_order);
    state = await key_and_state(instance, keys, { ...sorted, until: (current) => sorted.until(current) && same(current.listed, views_rows(sort_type, sort_order)) });
    check(app, kind, `s ${keys[0]} (${name}) sets ${sort_type} ${sort_order}`, state.mail_tab?.sort_type === sort_type && state.mail_tab?.sort_order === sort_order, `sortType ${state.mail_tab?.sort_type}, sortOrder ${state.mail_tab?.sort_order}`);
    check(app, kind, `s ${keys[0]} (${name}) orders the rows`, same(state.listed, views_rows(sort_type, sort_order)), state.listed.join(" "));
  }
  // Measurement for the sort.set `by` enum: does mailTabs.update accept these two column names? A refused name changes nothing, so only an accepted one is waited for.
  for (const sort_type of ["received", "priority"]) {
    const answer = await instance.ask("api_view", 20000, { update: { sortType: sort_type, sortOrder: "ascending" } });
    state = answer.error ? await instance.ask("state") : await wait_state(instance, `the tab to report sortType ${sort_type}`, (current) => current.mail_tab?.sort_type === sort_type, { soft: true, timeout_ms: 3000 });
    note(app, kind, `mailTabs.update sortType ${sort_type}`, `${answer.error ? `error ${answer.error}` : "accepted"}, tab then reports sortType ${state.mail_tab?.sort_type}`);
  }
  const panes = (current) => `${current.mail_tab?.message_pane_visible}/${current.mail_tab?.folder_pane_visible}`;
  const before = await instance.ask("state");
  await instance.press(["w"]);
  state = await key_and_state(instance, ["m"], pane_is("message", !before.mail_tab?.message_pane_visible));
  check(app, kind, "w m toggles the message pane", state.mail_tab?.message_pane_visible === !before.mail_tab?.message_pane_visible, `message/folder pane ${panes(before)} then ${panes(state)}`);
  await instance.press(["w"]);
  state = await key_and_state(instance, ["m"], pane_is("message", before.mail_tab?.message_pane_visible));
  check(app, kind, "a second w m restores the message pane", state.mail_tab?.message_pane_visible === before.mail_tab?.message_pane_visible, `message/folder pane ${panes(state)}`);
  await instance.press(["w"]);
  const folder_toggled = await key_and_state(instance, ["f"], pane_is("folder", !before.mail_tab?.folder_pane_visible));
  check(app, kind, "w f toggles the folder pane", folder_toggled.mail_tab?.folder_pane_visible === !before.mail_tab?.folder_pane_visible, `message/folder pane ${panes(before)} then ${panes(folder_toggled)}`);
  await instance.press(["w"]);
  state = await key_and_state(instance, ["f"], pane_is("folder", before.mail_tab?.folder_pane_visible));
  check(app, kind, "a second w f restores the folder pane", state.mail_tab?.folder_pane_visible === before.mail_tab?.folder_pane_visible);
  check(app, kind, "the view keys changed no mail", instance.exited() === null);
}

export const piece = section_piece({
  section: "view_settings",
  run: async (instance, ctx) => {
    await run_view_settings(instance, ctx);
    await ctx.shot("after_view_settings", "Views folder after the view setting keys");
  },
});
