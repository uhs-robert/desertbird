// The helpers of the three panes pieces: the folder selection, the keys with their waits, and the wait descriptions each key's effect has in the helper state.

import { first_selected } from "../predicates.mjs";

export function panes_helpers(instance, ctx) {
  const { key_and_state } = ctx;
  const folder_of = (state) => state.mail_tab?.folder ?? null;
  const press_state = (args, wait = 1200) => key_and_state(instance, args, wait);
  const down = (wait) => press_state(["-k", "Down"], wait);
  const up = (wait) => press_state(["-k", "Up"], wait);
  const keys = async (sequence, wait = 1200) => {
    for (const key of sequence.slice(0, -1)) await instance.press([key]);
    return press_state([sequence.at(-1)], wait);
  };
  const tabs_of = (state) => state.windows.flatMap((window) => window.tabs.map((tab) => tab.raw.url ?? tab.title));
  const in_folder = (state, id, path) => state.folders[path]?.includes(id) === true;
  const messages_in_inbox = (current) => current.folders["/Inbox"].length;

  // Waits on what each key changes in the helper state. A key that only moves the focus, hides a toast or folds a tree row has no state, so those keep their fixed wait.
  const folder_lands_on = (path) => ({ what: `the folder selection to reach ${path}`, until: (state) => folder_of(state) === path, show: (state) => `folder ${folder_of(state)}` });
  const folder_leaves = (path) => ({ what: `the folder selection to leave ${path}`, until: (state) => folder_of(state) !== path && folder_of(state) !== null, show: (state) => `folder ${folder_of(state)}` });
  const at_second_last = { what: "the selection to reach the second last row", until: (state) => first_selected(state) !== null && first_selected(state) === state.listed.at(-2), show: (state) => `selected ${first_selected(state)}` };
  const at_second = { what: "the selection to reach the second row", until: (state) => first_selected(state) !== null && state.listed.indexOf(first_selected(state)) === 1, show: (state) => `selected ${first_selected(state)}` };
  const holds = (what, path, id, present) => ({ what: `${id} ${present ? "in" : "out of"} ${path} (${what})`, until: (state) => in_folder(state, id, path) === present, timeout_ms: 10000 });
  const only_tab = { what: "the extra tabs to close", until: (state) => tabs_of(state).length === 1, show: (state) => `tabs ${tabs_of(state).join(" ")}` };
  const opens_tab = (what, is_page) => ({ what: `${what} to open in a tab`, until: (state) => tabs_of(state).some(is_page), show: (state) => `tabs ${tabs_of(state).join(" ")}`, timeout_ms: 15000 });
  return { folder_of, press_state, down, up, keys, tabs_of, in_folder, messages_in_inbox, folder_lands_on, folder_leaves, at_second_last, at_second, holds, only_tab, opens_tab };
}

// Every panes piece starts in the Inbox with its rows listed.
export async function show_inbox_listed(instance, ctx) {
  const { wait_state } = ctx;
  const folder_of = (state) => state.mail_tab?.folder ?? null;
  await instance.ask("show_folder", 20000, { path: "/Inbox" });
  await wait_state(instance, "the Inbox to list its messages", (current) => folder_of(current) === "/Inbox" && current.listed.length > 0, { timeout_ms: 10000 });
}
