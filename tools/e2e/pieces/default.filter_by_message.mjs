// The list and date filters by the selected message (F m l, F m d), which the `filter` Experiment applies, and their re-apply after F u, F s and the / search.

import { folder_shown, listed_count, pane_is, same, selects } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["views", "search"];

// The Lists folder of profile kind "lists": lists-0, 1, 3 and 6 are on the dev list, 2 and 4 on the ops list, 5 on none. Lists 0 to 2 share a day. Lists 1 is starred, Lists 3 and 6 are unread.
const ALL = 7;
const id = (index) => `lists-${index}@fixture.invalid`;
const ids = (...indexes) => indexes.map(id);
const sorted = (rows) => [...rows].sort();
// A point on the first row of the thread list in the 1280x720 output, below the Quick Filter bar and clear of the thread toggle.
const FIRST_THREAD_ROW = [550, 170];
const selected_ids = (state) => sorted(state.selected.map((message) => message.header_id));
const selects_all = (header_ids) => ({ what: `the selection to be ${header_ids}`, until: (state) => same(selected_ids(state), sorted(header_ids)), show: (state) => `selected ${selected_ids(state)}` });

async function run_filter_by_message(instance, ctx) {
  const { app, kind, check, shot, wait_for_state, key_and_state, open_command_line, press_in_command_line, toast_cycle } = ctx;
  await instance.ask("show_folder", 20000, { path: "/Lists" });
  await wait_for_state(instance, folder_shown("/Lists"));
  let state = await wait_for_state(instance, { ...listed_count(ALL), timeout_ms: 15000 });
  check(app, kind, "the helper shows the Lists folder with 7 messages", state.mail_tab?.folder === "/Lists" && state.listed.length === ALL, `folder ${state.mail_tab?.folder}, listed ${state.listed.length}`);
  const select = async (header_id) => {
    const rows = (await instance.ask("state")).listed;
    await instance.press(["g"]);
    await key_and_state(instance, ["g"], selects(rows[0]));
    for (let step = 0; step < rows.indexOf(header_id); step += 1) await key_and_state(instance, ["j"], selects(rows[step + 1]));
  };
  const keys_to_count = async (keys, count) => {
    for (const key of keys.slice(0, -1)) await instance.press([key]);
    return (await key_and_state(instance, keys.slice(-1), listed_count(count))).listed;
  };
  const shows = (rows, expected) => same(sorted(rows), sorted(expected));

  await select(id(0));
  let rows = await keys_to_count(["F", "m", "l"], 4);
  check(app, kind, "F m l shows only the mail of the selected message's list", shows(rows, ids(0, 1, 3, 6)), `listed ${rows}`);
  await shot("filter_by_list", "the Lists folder after F m l: four rows, the Quick Filter bar shown and its toggle pressed");
  rows = await keys_to_count(["F", "u"], 2);
  check(app, kind, "F u after F m l keeps the list filter and adds unread", shows(rows, ids(3, 6)), `listed ${rows}`);
  rows = await keys_to_count(["F", "r"], ALL);
  check(app, kind, "F r clears the list filter with the others", rows.length === ALL, `listed ${rows.length}`);

  await select(id(0));
  await keys_to_count(["F", "m", "l"], 4);
  rows = await keys_to_count(["F", "s"], 1);
  check(app, kind, "F s after F m l keeps the list filter and adds starred", shows(rows, ids(1)), `listed ${rows}`);
  rows = await keys_to_count(["F", "s"], 4);
  check(app, kind, "a second F s takes starred off and keeps the list filter", shows(rows, ids(0, 1, 3, 6)), `listed ${rows}`);

  await open_command_line(instance, ["/"]);
  await press_in_command_line(instance, ["Lists 3"]);
  state = await wait_for_state(instance, listed_count(1));
  check(app, kind, "/ after F m l keeps the list filter under the typed text", shows(state.listed, ids(3)), `listed ${state.listed}`);
  await press_in_command_line(instance, ["-k", "Escape"]);
  state = await wait_for_state(instance, listed_count(4));
  check(app, kind, "Escape ends the search and the list filter shows again", shows(state.listed, ids(0, 1, 3, 6)), `listed ${state.listed}`);

  await select(id(0));
  rows = await keys_to_count(["F", "m", "d"], 2);
  check(app, kind, "F m d after F m l shows the list's mail of the selected message's day", shows(rows, ids(0, 1)), `listed ${rows}`);
  await keys_to_count(["F", "r"], ALL);
  await select(id(0));
  rows = await keys_to_count(["F", "m", "d"], 3);
  check(app, kind, "F m d shows only the mail of the selected message's day", shows(rows, ids(0, 1, 2)), `listed ${rows}`);
  rows = await keys_to_count(["F", "r"], ALL);
  check(app, kind, "F r clears the date filter", rows.length === ALL, `listed ${rows.length}`);

  await select(id(5));
  const refused = await toast_cycle(instance, `${app}_list_none`, ["l"], ["F", "m"]);
  check(app, kind, "F m l on a message with no List-Id shows the refusal as a toast", refused.shown, `listed ${refused.state.listed.length}`);
  check(app, kind, "F m l on a message with no List-Id leaves the list as it was", refused.state.listed.length === ALL, `listed ${refused.state.listed.length}`);

  // The cursor alone: Space picks the read row and a second Space drops it, so nothing is selected, and j then moves only the cursor. A cursor move has no state of its own, so it gets a fixed wait.
  const listed = (await instance.ask("state")).listed;
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], selects(listed[0]));
  await key_and_state(instance, ["-k", "space"], 700);
  await key_and_state(instance, ["-k", "space"], 700);
  await key_and_state(instance, ["j"], 700);
  state = await key_and_state(instance, ["j"], 700);
  check(app, kind, "Space twice and j j leave no row selected", state.selected.length === 0, `selected ${state.selected.map((message) => message.header_id)}`);
  rows = await keys_to_count(["F", "m", "l"], 2);
  check(app, kind, "F m l with nothing selected filters on the list of the message at the cursor", shows(rows, ids(2, 4)), `listed ${rows}, cursor row 2 (${listed[2]})`);

  // A thread row: the Threads folder opens threaded with its thread of two closed. g g selects the closed thread, which selects both its messages.
  const thread = (index) => `threads-${index}@fixture.invalid`;
  await instance.ask("show_folder", 20000, { path: "/Threads" });
  await wait_for_state(instance, folder_shown("/Threads"));
  const thread_keys = async (keys, count, what) => {
    for (const key of keys.slice(0, -1)) await instance.press([key]);
    const after = await key_and_state(instance, keys.slice(-1), { ...listed_count(count), soft: true });
    check(app, kind, what, after.listed.length === count, `listed ${after.listed}, selected ${after.selected.map((message) => message.header_id)}`);
  };
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], 700);
  check(app, kind, "g g in the Threads folder selects the closed thread of two", same(sorted(state.selected.map((message) => message.header_id)), [thread(0), thread(1)]), `selected ${state.selected.map((message) => message.header_id)}`);
  // The list shows the closed thread as one row, so the list filter leaves that row and drops the ops row.
  await thread_keys(["F", "m", "l"], 1, "F m l on a closed thread filters on the list of its root");
  await thread_keys(["F", "r"], 2, "F r shows the Threads folder again");
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], 700);
  await thread_keys(["F", "m", "d"], 1, "F m d on a closed thread filters on the day of its root");
  await thread_keys(["F", "r"], 2, "F r shows the Threads folder again after F m d");
  // An open thread: l opens it, and g g then selects its root alone.
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], 700);
  await key_and_state(instance, ["l"], 700);
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], 700);
  check(app, kind, "l opens the thread and g g selects its root alone", same(state.selected.map((message) => message.header_id), [thread(0)]) && state.listed.length === 3, `selected ${state.selected.map((message) => message.header_id)}, listed ${state.listed}`);
  // The search rebuilds the view, which closes the thread again, so the filtered list is its one row.
  await thread_keys(["F", "m", "l"], 1, "F m l on an open thread root filters on its list");
  await thread_keys(["F", "m", "d"], 1, "F m d on the thread root adds its day");
  await thread_keys(["F", "r"], 2, "F r shows the Threads folder again after the open thread");
  // A mouse click on the closed thread row, as a user selects a thread. G first selects the single row, so only the click can select the thread. With the message pane shown the list is one row high and scrolled to the selection, so w m hides the pane for the click and shows it again, with the thread summary, before the keys.
  await key_and_state(instance, ["G"], selects(thread(2)));
  await instance.press(["w"]);
  await key_and_state(instance, ["m"], pane_is("message", false));
  await instance.click(...FIRST_THREAD_ROW);
  state = await wait_for_state(instance, { ...selects_all([thread(0), thread(1)]), timeout_ms: 5000, soft: true });
  check(app, kind, "a click on the closed thread row selects both its messages", same(selected_ids(state), [thread(0), thread(1)]), `selected ${selected_ids(state)}`);
  await instance.press(["w"]);
  await key_and_state(instance, ["m"], pane_is("message", true));
  await shot("filter_clicked_thread", "the Threads folder after a click on the closed thread: its row selected and the thread summary in the message pane");
  await thread_keys(["F", "m", "d"], 1, "F m d on a clicked thread filters on the day of its root");
  await thread_keys(["F", "m", "l"], 1, "F m l on a clicked thread adds the list of its root");
  await thread_keys(["F", "r"], 2, "F r shows the Threads folder again after the clicked thread");
  // The sender and subject keys read the root of the selected closed thread too, and refuse nothing.
  await thread_keys(["F", "m", "f"], 1, "F m f on a closed thread filters on the sender of its root");
  await thread_keys(["F", "r"], 2, "F r shows the Threads folder again after F m f");
  await thread_keys(["F", "m", "s"], 1, "F m s on a closed thread filters on the subject of its root");
  await thread_keys(["F", "r"], 2, "F r shows the Threads folder again after F m s");
}

export const piece = { ...section_piece({ section: "filter_by_message", run: run_filter_by_message }), profile_kind: "lists" };
