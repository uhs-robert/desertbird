// Visual mode in the Inbox.

import { first_selected, same, drawn_since, back_to } from "../predicates.mjs";
import { LABEL_STRIP } from "./_mode_label.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["visual", "mail_keys", "mode_label"];

// Visual mode in the Inbox with every thread open, so each row is one message. The commands run on the real list: m s flags the range and a archives it.
// The mode label shows the mode and no state does, so v and Escape are waited for on the label's pixels.
async function run_visual(instance, ctx) {
  const { app, kind, shot, check, barrier, show_folder, key_and_state, hud_pixels, wait_pixels } = ctx;
  await show_folder(instance, "/Inbox");
  // "Escape" is a key name for wtype, which needs -k. Typed as text it would send six letters.
  const press_args = (key) => (key === "Escape" ? ["-k", "Escape"] : [key]);
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
  const rows = state.listed;
  await enter_visual();
  await keys(["j"], selects_rows(rows.slice(0, 2)));
  state = await keys(["j"], selects_rows(rows.slice(0, 3)));
  check(app, kind, "v then j j selects the three rows from the top", same(ids(state.selected), rows.slice(0, 3)), `selected ${ids(state.selected).join(" ")}`);
  await shot("visual_range", "three rows selected after v j j");
  state = await keys(["k"], selects_rows(rows.slice(0, 2)));
  check(app, kind, "k in visual mode shrinks the range back toward the anchor", same(ids(state.selected), rows.slice(0, 2)), `selected ${ids(state.selected).join(" ")}`);
  state = await leave_visual(selects_rows([rows[1]]));
  check(app, kind, "Escape ends visual mode on the current row", same(ids(state.selected), [rows[1]]), `selected ${ids(state.selected).join(" ")}`);
  state = await keys(["j"], selects_rows([rows[2]]));
  check(app, kind, "after Escape j moves one row again", same(ids(state.selected), [rows[2]]), `selected ${ids(state.selected).join(" ")}`);
  // A range upward from row 5, then m s flags the whole range and keeps the mode on.
  await keys(["g", "g"], selects_rows([rows[0]]));
  await keys(["5", "j"], selects_rows([rows[5]]));
  await enter_visual();
  state = await keys(["2", "k"], selects_rows(rows.slice(3, 6)));
  const range = ids(state.selected);
  check(app, kind, "v then 2 k selects rows 3 to 5", same(range, rows.slice(3, 6)), `selected ${range.join(" ")}`);
  const flagged_before = range.map((id) => state.flags[id]?.flagged === true);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], { what: "m s to flag every message of the range", until: (current) => range.every((id) => current.flags[id]?.flagged === true), show: (current) => `flagged ${range.map((id) => current.flags[id]?.flagged === true).join()}`, timeout_ms: 8000 });
  const flagged_after = range.map((id) => state.flags[id]?.flagged === true);
  check(app, kind, "m s in visual mode flags every message of the range", flagged_after.every(Boolean), `before ${flagged_before.join()}, after ${flagged_after.join()}`);
  check(app, kind, "m s keeps the range selected", same(ids(state.selected), range), `selected ${ids(state.selected).join(" ")}`);
  const after_escape = first_selected(await leave_visual({ what: "Escape to shrink the range to one row", until: (current) => current.selected.length === 1, show: (current) => `${current.selected.length} selected` }));
  state = await keys(["j"], { what: "j to select the next row", until: (current) => current.selected.length === 1 && first_selected(current) !== after_escape });
  check(app, kind, "Escape ends visual mode, so j selects one row", state.selected.length === 1, `selected ${state.selected.length}`);
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
