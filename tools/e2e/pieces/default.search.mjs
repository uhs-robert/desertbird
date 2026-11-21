// The / and ? search of the thread list.

import { COLLAPSED_ROWS } from "../fixture_rows.mjs";
import { selects, listed_count } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["search", "views"];

// / and ? search the thread list with the Quick Filter: rows narrow while typing, Escape restores, Enter keeps the filter and selects, n and N step. The fixture subjects "Single 1" and "Single 10".."Single 19" give 11 rows in the Inbox.
async function run_search(instance, ctx) {
  const { app, kind, shot, check, wait_state, wait_for_state, key_and_state, open_command_line, press_in_command_line } = ctx;
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  // The search line is the command line page, so its drawn panel is the signal that it takes keys.
  const open_search = async (key, text) => {
    await open_command_line(instance, [key]);
    await press_in_command_line(instance, [text]);
  };
  // Escape ends the line, so the change the wait sees is the line going. The quick filter then restores in the background, which the caller reads from the list.
  const escape_search = () => press_in_command_line(instance, ["-k", "Escape"]);
  const clear_filter = async () => {
    await instance.press(["F"]);
    return key_and_state(instance, ["r"], listed_count(full));
  };
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], selects(COLLAPSED_ROWS[0]));
  const full = (await instance.ask("state")).listed.length;
  await open_search("/", "Single 1");
  let state = await wait_state(instance, "the list to narrow to the typed text", (current) => current.listed.length > 0 && current.listed.length < full, { soft: true });
  check(app, kind, "/ then text narrows the list while the line is open", state.listed.length > 0 && state.listed.length < full, `listed ${state.listed.length} of ${full}`);
  await shot("search_typing", "the search line at the bottom with the narrowed list above it");
  await escape_search();
  state = await wait_for_state(instance, listed_count(full));
  check(app, kind, "Escape restores the earlier list", state.listed.length === full, `listed ${state.listed.length}, expected ${full}`);
  await shot("search_escaped", "the full list after Escape, with no search line");
  const before_j = selection_of(await instance.ask("state"));
  state = await key_and_state(instance, ["j"], { what: "j to move the selection after Escape", until: (current) => selection_of(current) !== "" && selection_of(current) !== before_j, show: (current) => `selected ${selection_of(current)}` });
  check(app, kind, "after Escape a bound key runs again", selection_of(state) !== "" && selection_of(state) !== before_j, `selected ${before_j} then ${selection_of(state)}`);

  // The typed text sits on top of the filter that was set before.
  await instance.press(["F"]);
  state = await key_and_state(instance, ["u"], { what: "F u to narrow the list to the unread rows", until: (current) => current.listed.length < full, timeout_ms: 3000, soft: true });
  const unread = state.listed.length;
  await open_search("/", "Single");
  await escape_search();
  state = await wait_for_state(instance, listed_count(unread));
  check(app, kind, "Escape after F u restores the unread list", state.listed.length === unread, `listed ${state.listed.length}, expected ${unread}`);
  await clear_filter();

  await open_search("/", "Single 1");
  const narrowed = (await wait_state(instance, "the list to narrow to the typed text", (current) => current.listed.length > 0 && current.listed.length < full, { soft: true })).listed;
  await instance.press(["-k", "Return"]);
  state = await wait_for_state(instance, selects(narrowed[0]));
  const first = selection_of(state);
  check(app, kind, "Enter keeps the narrowed list and selects its first row", state.listed.length === narrowed.length && first === narrowed[0], `listed ${state.listed.length}, selected ${first}, first ${narrowed[0]}`);
  await shot("search_entered", "the narrowed list with the first row selected and the match count as a toast");
  state = await key_and_state(instance, ["n"], selects(narrowed[1]));
  check(app, kind, "n selects the next row", selection_of(state) === narrowed[1], `selected ${selection_of(state)}, expected ${narrowed[1]}`);
  state = await key_and_state(instance, ["N"], selects(narrowed[0]));
  check(app, kind, "N goes back one row", selection_of(state) === narrowed[0], `selected ${selection_of(state)}, expected ${narrowed[0]}`);
  state = await key_and_state(instance, ["N"], selects(narrowed.at(-1)));
  check(app, kind, "N from the first row wraps to the last", selection_of(state) === narrowed.at(-1), `selected ${selection_of(state)}, expected ${narrowed.at(-1)}`);

  // Escape ended nothing here: the filter stays, so clear it, then n narrows it again from the register.
  await clear_filter();
  state = await key_and_state(instance, ["n"], listed_count(narrowed.length));
  check(app, kind, "n after the filter was cleared narrows the list to the register again", state.listed.length === narrowed.length, `listed ${state.listed.length}, expected ${narrowed.length}`);

  await clear_filter();
  await open_search("?", "Single 1");
  await shot("search_backward", "the backward search line with the ? prompt");
  await instance.press(["-k", "Return"]);
  state = await wait_for_state(instance, selects(narrowed.at(-1)));
  check(app, kind, "? then Enter selects the last matching row", selection_of(state) === narrowed.at(-1), `selected ${selection_of(state)}, expected ${narrowed.at(-1)}`);
  await clear_filter();
}

export const piece = section_piece({ section: "search", only: ["search"], run: run_search });
