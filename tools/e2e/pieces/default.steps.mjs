// The step keys in the Views folder.

import { sleep, first_selected, selects, at_bottom, at_top } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

// The step keys in the Views folder (6 messages: unread v0 to v2, starred v0 and v1, an attachment on v0). The row order comes from the listing, not from a fixed order.
// The oracle walks that order: the steps must visit the matching rows in turn and stay on the last one.
async function run_steps(instance, ctx) {
  const { app, kind, shot, check, note, barrier, show_folder, key_and_state } = ctx;
  await show_folder(instance, "/Views");
  // Showing a folder through the API leaves the focus and the selection where they were, so focus the list and select the first row here. g e only moves the focus, so it keeps its margin.
  await instance.press(["g"]);
  await instance.press(["e"]);
  await sleep(1000);
  await instance.press(["g"]);
  let state = await key_and_state(instance, ["g"], at_top);
  const listed = state.listed;
  const has = { u: (id, now) => now.flags[id]?.read === false, s: (id, now) => now.flags[id]?.flagged === true, a: (id) => id === "views-0@fixture.invalid" };
  // Selecting a message can mark it read, so each press is judged against the flags read just before it.
  // A press that has a row to go to waits for that row. A press at the end of the run stays put, so it keeps a margin and then reads through the barrier.
  const press_step = async (key, backward) => {
    const before = await instance.ask("state");
    const at = before.listed.indexOf(first_selected(before));
    const ahead = backward ? before.listed.slice(0, at).reverse() : before.listed.slice(at + 1);
    const want = ahead.find((id) => has[key](id, before)) ?? first_selected(before);
    await instance.press([backward ? "[" : "]"]);
    let after;
    if (want !== first_selected(before)) after = await key_and_state(instance, [key], selects(want));
    else {
      await instance.press([key]);
      await sleep(1200);
      after = await barrier(instance);
    }
    const got = first_selected(after);
    return got === want ? null : `from ${first_selected(before)} got ${got}, want ${want}`;
  };
  for (const [key, name] of [["u", "unread"], ["s", "starred"], ["a", "attachment"]]) {
    await instance.press(["g"]);
    await key_and_state(instance, ["g"], at_top);
    for (const backward of [false, true]) {
      const misses = [];
      for (let press = 0; press < 4; press++) misses.push(await press_step(key, backward));
      check(app, kind, `${backward ? "[" : "]"} ${key} goes to the ${backward ? "previous" : "next"} ${name} row and stays at the end`, misses.every((miss) => miss === null), misses.filter(Boolean).join("; ") || `list ${listed.join(" ")}`);
    }
  }
  note(app, kind, "unread counts the step reads", JSON.stringify((await instance.ask("folder_unread")).counts));
  // The setup marked every Inbox message read, so m u first makes one Inbox message unread. ] U from the end of Views must then land on it.
  await show_folder(instance, "/Inbox");
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], at_top);
  await instance.press(["m"]);
  const marked = (await key_and_state(instance, ["u"], { what: "m u to mark the selected row unread", until: (current) => current.selected.length > 0 && current.selected.every((message) => current.flags[message.header_id]?.read === false), timeout_ms: 8000 })).selected.map((message) => message.header_id);
  await show_folder(instance, "/Views");
  await key_and_state(instance, ["G"], at_bottom);
  await instance.press(["]"]);
  const moved = await key_and_state(instance, ["U"], { what: "] U to open the Inbox with an unread row selected", until: (current) => current.mail_tab?.folder === "/Inbox" && marked.includes(first_selected(current)), show: (current) => `folder ${current.mail_tab?.folder}, selected ${first_selected(current)}`, timeout_ms: 15000 });
  const landed = first_selected(moved);
  check(app, kind, "] U with no later unread row opens the folder that has unread mail and selects it", moved.mail_tab?.folder === "/Inbox" && marked.includes(landed), `folder ${moved.mail_tab?.folder}, selected ${landed}, marked unread ${marked.join(" ")}`);
  await shot("step_unread_all_folders", "the folder ] U opened, with an unread message selected");
}

// The `] U` check expects the one message that `m u` makes unread to be the only unread one, so the Inbox is marked read first.
// The attachment checks need the attachment message (views-0) off the first row, so one Inbox message moves into Views first, which also makes it 7 rows.
const prepare_inbox_and_views = async (instance, ctx) => {
  const { wait_state, key_and_state, open_command_line } = ctx;
  await instance.press(["m"]);
  await instance.press(["R"]);
  await wait_state(instance, "m R to mark the Inbox read", (now) => now.folders["/Inbox"].every((id) => now.flags[id]?.read !== false), { timeout_ms: 8000 });
  const moved = first_selected(await key_and_state(instance, ["G"], at_bottom));
  await instance.press(["m"]);
  await open_command_line(instance, ["m"]);
  await instance.press(["vie"]);
  await instance.press(["-k", "Return"]);
  await wait_state(instance, `${moved} to leave the Inbox for /Views`, (now) => !now.folders["/Inbox"].includes(moved), { timeout_ms: 10000 });
};

export const piece = section_piece({ section: "steps", only: ["steps"], setup: prepare_inbox_and_views, run: run_steps });
