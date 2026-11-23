// Visual mode and Space picks in the Inbox.

import { first_selected, same, drawn_since, back_to } from "../predicates.mjs";
import { LABEL_STRIP } from "./_mode_label.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["visual", "mail_keys", "mode_label"];

// Visual mode and Space in the Inbox with every thread open, so each row is one message. The commands run on the real list: m r and m s act on a kept selection, and a archives a pick and a range.
// A move of the cursor alone has no state of its own, so a key that must leave the selection as it is gets a fixed wait, longer than the 270 ms Thunderbird's own Space takes to select a row.
// The mode label shows the mode and no state does, so v and Escape are waited for on the label's pixels.
async function run_visual(instance, ctx) {
  const { app, kind, shot, check, barrier, show_folder, key_and_state, hud_pixels, wait_pixels } = ctx;
  await show_folder(instance, "/Inbox");
  // "Escape" and "space" are key names for wtype, which needs -k. Typed as text they would send their letters.
  const press_args = (key) => (key === "Escape" || key === "space" ? ["-k", key] : [key]);
  const shown = (current) => current.displayed.map((message) => message.header_id);
  const ids = (selected) => selected.map((message) => message.header_id);
  const selects_rows = (rows) => ({ what: `the selection to be ${rows.length} rows from ${rows[0]}`, until: (current) => same(ids(current.selected), rows), show: (current) => `selected ${ids(current.selected).join(" ")}` });
  const keys = async (sequence, wanted) => {
    for (const key of sequence.slice(0, -1)) await instance.press(press_args(key));
    return key_and_state(instance, press_args(sequence.at(-1)), wanted);
  };
  const label_strip = (name) => hud_pixels(instance, `${app}_visual_${name}`, LABEL_STRIP);
  const normal_label = await label_strip("normal");
  const enter_visual = async () => {
    await instance.press(["v"]);
    return wait_pixels(instance, "the mode label to show visual mode", `${app}_visual_label`, LABEL_STRIP, drawn_since(normal_label), { timeout_ms: 5000 });
  };
  const leave_visual = async (wanted) => {
    const state = await keys(["Escape"], wanted);
    await wait_pixels(instance, "the mode label to return to normal", `${app}_visual_label`, LABEL_STRIP, back_to(normal_label), { timeout_ms: 5000 });
    return state;
  };
  // z R opens every thread. It has no state of its own, so the barrier shows that it has landed.
  await instance.press(["z"]);
  await instance.press(["R"]);
  await barrier(instance);
  await instance.press(["g"]);
  let state = await key_and_state(instance, ["g"], { what: "g g to select the first row", until: (current) => current.selected.length === 1 && first_selected(current) === current.listed[0] });
  let rows = state.listed;
  await enter_visual();
  await keys(["j"], selects_rows(rows.slice(0, 2)));
  state = await keys(["j"], selects_rows(rows.slice(0, 3)));
  check(app, kind, "v then j j selects the three rows from the top", same(ids(state.selected), rows.slice(0, 3)), `selected ${ids(state.selected).join(" ")}`);
  await shot("visual_range", "three rows selected after v j j");
  state = await keys(["k"], selects_rows(rows.slice(0, 2)));
  check(app, kind, "k in visual mode shrinks the range back toward the anchor", same(ids(state.selected), rows.slice(0, 2)), `selected ${ids(state.selected).join(" ")}`);
  state = await leave_visual(selects_rows(rows.slice(0, 2)));
  check(app, kind, "Escape ends visual mode and keeps the range", same(ids(state.selected), rows.slice(0, 2)), `selected ${ids(state.selected).join(" ")}`);
  state = await keys(["j", "j"], 700);
  check(app, kind, "with two rows kept, j moves only the cursor", same(ids(state.selected), rows.slice(0, 2)), `selected ${ids(state.selected).join(" ")}`);
  const kept = [rows[0], rows[1], rows[3]];
  state = await keys(["space"], selects_rows(kept));
  check(app, kind, "Space adds the row under the cursor to the kept range", same(ids(state.selected), kept), `selected ${ids(state.selected).join(" ")}`);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["r"], { what: "m r to mark the kept rows read", until: (current) => same(ids(current.selected), kept) && current.selected.every((message) => message.read === true), show: (current) => `selected ${ids(current.selected).join(" ")}, read ${current.selected.map((message) => message.read).join()}`, timeout_ms: 8000 });
  check(app, kind, "m r marks every kept row read and keeps them selected", same(ids(state.selected), kept) && state.selected.every((message) => message.read === true), `selected ${ids(state.selected).join(" ")}`);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], { what: "m s to flag the same kept rows", until: (current) => kept.every((id) => current.flags[id]?.flagged === true), show: (current) => `flagged ${kept.map((id) => current.flags[id]?.flagged === true).join()}`, timeout_ms: 8000 });
  check(app, kind, "m s after m r flags the same three rows", same(ids(state.selected), kept) && kept.every((id) => state.flags[id]?.flagged === true), `selected ${ids(state.selected).join(" ")}`);
  state = await keys(["Escape"], selects_rows([rows[3]]));
  check(app, kind, "Escape in normal mode drops the kept rows to the current row", same(ids(state.selected), [rows[3]]), `selected ${ids(state.selected).join(" ")}`);
  const selects_and_shows = (row) => ({ what: `${row} to be selected and shown`, until: (current) => same(ids(current.selected), [row]) && same(shown(current), [row]), show: (current) => `selected ${ids(current.selected).join(" ")}, shown ${shown(current).join(" ")}` });
  state = await keys(["j"], selects_and_shows(rows[4]));
  check(app, kind, "with one row selected, j selects and shows the next message", same(shown(state), [rows[4]]), `shown ${shown(state).join(" ")}`);
  state = await keys(["k"], selects_and_shows(rows[3]));
  check(app, kind, "with one row selected, k selects and shows the message above", same(shown(state), [rows[3]]), `shown ${shown(state).join(" ")}`);
  // A range upward from row 6, then m s flags the whole range and keeps the mode on.
  await keys(["g", "g"], selects_rows([rows[0]]));
  await keys(["6", "j"], selects_rows([rows[6]]));
  await enter_visual();
  state = await keys(["2", "k"], selects_rows(rows.slice(4, 7)));
  const range = ids(state.selected);
  check(app, kind, "v then 2 k selects rows 4 to 6", same(range, rows.slice(4, 7)), `selected ${range.join(" ")}`);
  const flagged_before = range.map((id) => state.flags[id]?.flagged === true);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], { what: "m s to flag every message of the range", until: (current) => range.every((id) => current.flags[id]?.flagged === true), show: (current) => `flagged ${range.map((id) => current.flags[id]?.flagged === true).join()}`, timeout_ms: 8000 });
  const flagged_after = range.map((id) => state.flags[id]?.flagged === true);
  check(app, kind, "m s in visual mode flags every message of the range", flagged_after.every(Boolean), `before ${flagged_before.join()}, after ${flagged_after.join()}`);
  check(app, kind, "m s keeps the range selected", same(ids(state.selected), range), `selected ${ids(state.selected).join(" ")}`);
  state = await leave_visual(selects_rows(range));
  check(app, kind, "Escape after m s ends visual mode and keeps the flagged range", same(ids(state.selected), range), `selected ${ids(state.selected).join(" ")}`);
  await keys(["Escape"], selects_rows([rows[4]]));
  // Space picks rows one at a time. The first Space keeps the row being read, and j then moves only the cursor, so a pick of one row survives it.
  await keys(["g", "g"], selects_rows([rows[0]]));
  state = await keys(["space"], 700);
  check(app, kind, "the first Space keeps the read row selected", same(ids(state.selected), [rows[0]]), `selected ${ids(state.selected).join(" ")}`);
  state = await keys(["j", "j"], 700);
  check(app, kind, "in a pick of one row, j moves only the cursor", same(ids(state.selected), [rows[0]]), `selected ${ids(state.selected).join(" ")}`);
  await shot("pick_cursor_unselected", "a pick of row 0 with the cursor on unselected row 2");
  await keys(["space"], selects_rows([rows[0], rows[2]]));
  const picked = ids((await keys(["j", "j", "space"], selects_rows([rows[0], rows[2], rows[4]]))).selected);
  check(app, kind, "Space picks three rows apart", same(picked, [rows[0], rows[2], rows[4]]), `selected ${picked.join(" ")}`);
  await shot("pick_cursor_selected", "a pick of rows 0, 2 and 4 with the cursor on selected row 4");
  // The folder contents and the listed rows come from different calls, so the wait needs both before `rows` is read from the list.
  state = await keys(["a"], { what: "a to archive the three picked rows", until: (current) => picked.every((id) => !current.folders["/Inbox"]?.includes(id) && !current.listed.includes(id)) && current.selected.length > 0, timeout_ms: 10000 });
  const picked_left = picked.filter((id) => state.folders["/Inbox"]?.includes(id));
  check(app, kind, "a archives every picked row", picked_left.length === 0, `still in the Inbox ${picked_left.join(" ")}`);
  rows = state.listed;
  // a archives the range once. `.` then archives once more, the one row selected at the dot, since u can undo it.
  await keys(["g", "g"], selects_rows([rows[0]]));
  await enter_visual();
  await keys(["j"], selects_rows(rows.slice(0, 2)));
  const archive_range = ids((await keys(["j"], selects_rows(rows.slice(0, 3)))).selected);
  // The . below repeats on the selected row, so the wait also needs the selection to have left the archived rows.
  state = await keys(["a"], { what: "a to archive the whole range and select a remaining row", until: (current) => archive_range.every((id) => !current.folders["/Inbox"]?.includes(id)) && current.selected.length > 0 && current.selected.every((message) => !archive_range.includes(message.header_id)), timeout_ms: 10000 });
  const in_inbox = archive_range.filter((id) => state.folders["/Inbox"]?.includes(id));
  check(app, kind, "a in visual mode archives the whole range", archive_range.length === 3 && in_inbox.length === 0, `range ${archive_range.join(" ")}, still in the Inbox ${in_inbox.join(" ")}`);
  const after_x = state.folders["/Inbox"]?.length;
  const dotted = first_selected(state);
  state = await keys(["."], { what: ". to archive one more row", until: (current) => current.folders["/Inbox"]?.length === after_x - 1, timeout_ms: 10000 });
  check(app, kind, ". after a in visual mode archives the one selected row", state.folders["/Inbox"]?.length === after_x - 1, `Inbox ${after_x} then ${state.folders["/Inbox"]?.length}`);
  state = await keys(["u"], { what: "u to bring the . archive back", until: (current) => current.folders["/Inbox"]?.includes(dotted) === true, timeout_ms: 10000 });
  check(app, kind, "u undoes the . archive, one row back in the Inbox", state.folders["/Inbox"]?.includes(dotted) === true && state.folders["/Inbox"]?.length === after_x, `${dotted} in the Inbox ${state.folders["/Inbox"]?.includes(dotted)}, Inbox ${after_x - 1} then ${state.folders["/Inbox"]?.length}`);
  await shot("visual_after_a", "Inbox after a archived the range");
  check(app, kind, "the app survived visual mode", instance.exited() === null);
}

export const piece = section_piece({ section: "visual", only: [], run: run_visual });
