// Wait descriptions, regions and small readers that need no running app, shared by the pieces and the helpers in ctx.mjs.
import { readFileSync } from "node:fs";
import { E2E_SETTINGS } from "./profile.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const CTRL_SHIFT = (key) => ["-M", "ctrl", "-M", "shift", key, "-m", "shift", "-m", "ctrl"];
export const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
export const first_selected = (state) => state.selected[0]?.header_id ?? null;
export const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
// Wait descriptions for key_and_state, one per kind of result the keys of the default section cause.
export const selects = (id) => ({ what: `the selection to reach ${id}`, until: (state) => first_selected(state) === id, show: (state) => `selected ${first_selected(state)}` });
export const at_bottom = { what: "the selection to reach the last row", until: (state) => first_selected(state) !== null && first_selected(state) === state.listed.at(-1), show: (state) => `selected ${first_selected(state)}` };
export const at_top = { what: "the selection to reach the first row", until: (state) => first_selected(state) !== null && first_selected(state) === state.listed[0], show: (state) => `selected ${first_selected(state)}` };
export const leaves_row = (row) => ({ what: `the selection to leave ${row}`, until: (state) => first_selected(state) !== null && first_selected(state) !== row, show: (state) => `selected ${first_selected(state)}` });
export const listed_count = (count) => ({ what: `the list to show ${count} rows`, until: (state) => state.listed.length === count, show: (state) => `${state.listed.length} listed` });
export const pane_is = (pane, visible) => ({ what: `the ${pane} pane to be ${visible ? "shown" : "hidden"}`, until: (state) => state.mail_tab?.[`${pane}_pane_visible`] === visible, show: (state) => `message/folder pane ${state.mail_tab?.message_pane_visible}/${state.mail_tab?.folder_pane_visible}` });
export const flag_becomes = (id, name, value) => ({ what: `${name} of ${id} to become ${value}`, until: (state) => state.flags[id]?.[name] === value, show: (state) => `${name} ${state.flags[id]?.[name]}` });
// A compose window opens late: the subject and the quote arrive after the window, and Thunderbird can take many seconds.
export const compose_opens = (tab_is_ready) => ({ what: "a compose window with its content", until: (state) => state.windows.some((window) => window.type === "messageCompose" && window.tabs.some(tab_is_ready)), timeout_ms: 15000 });
// A collapsed thread root selects its whole thread and an open one selects only itself, so the selection count shows a fold of the selected root.
export const thread_shows = (open) => ({ what: `the selected thread to ${open ? "open" : "close"}`, until: (state) => (open ? state.selected.length === 1 : state.selected.length > 1), show: (state) => `${state.selected.length} selected` });
// A folder shown through the API lists its messages only once Thunderbird has read its mbox, so the folder alone is not the signal.
export const folder_shown = (path) => ({ what: `${path} to show with its messages`, until: (state) => state.mail_tab?.folder === path && state.listed.length > 0, show: (state) => `folder ${state.mail_tab?.folder}, ${state.listed.length} listed`, timeout_ms: 10000 });
// A main window the helper opened or closed: it counts when the window list shows it and, for a new one, gives it the focus that keys need.
// The normal (mail) window reports the focus that keys need.
export const normal_window_focused = (state) => state.windows.some((window) => window.type === "normal" && window.focused === true);
export const window_has_focus = (id) => ({ what: `main window ${id} to open and take focus`, until: (state) => state.windows.some((window) => window.id === id && window.focused === true), timeout_ms: 15000 });
export const window_is_closed = (id) => ({ what: `main window ${id} to close`, until: (state) => !state.windows.some((window) => window.id === id) && normal_window_focused(state), timeout_ms: 10000 });
// A hash of the bottom 80 px of the window, where the panel and the toasts draw, without the scrollbar strip. The mode label sits in it too and stays the same while the mode does. Higher up a message pane can still be loading.
export const HUD_REGION = "0,640 1260x80";
// A hash that has not moved between two reads in a row, so the region is done drawing. It reads the region again and again, so build one per poll.
export const holds_twice = () => {
  let last = null;
  return (now) => {
    const held = now === last;
    last = now;
    return held;
  };
};
// The region draws something other than `baseline` and holds it. A panel or toast is shown when this ends before the ceiling.
export const drawn_since = (baseline) => {
  const held = holds_twice();
  return (now) => held(now) && now !== baseline;
};
export const back_to = (baseline) => (now) => now === baseline;
// The region the root key list and the command line list fill: it is about twelve rows tall above the status bar, taller than the strip of a toast.
export const KEY_LIST_REGION = "0,300 1260x420";
// Escape until an Escape changes nothing: the first hides the list, the second closes the line, the third goes to the mail list, where it does nothing. The line is closed when no pixel moves for `QUIET_AFTER_ESCAPE_MS` after an Escape, which is a negative read and keeps that fixed window.
export const QUIET_AFTER_ESCAPE_MS = 500;
// The toast time of the e2e profile (`E2E_SETTINGS`), and the time a toast needs to be gone with some margin. Nothing shows that no toast is up, so a read that needs none waits this long after the last toast key.
export const TOAST_EXPIRY_MS = E2E_SETTINGS.toast_error_ms + 500;
// The sort a typed command left, as a wait.
export const sorted_by = (sort_type, sort_order) => ({ what: `sort ${sort_type} ${sort_order} to take effect`, until: (state) => state.mail_tab?.sort_type === sort_type && state.mail_tab?.sort_order === sort_order, show: (state) => `sort ${state.mail_tab?.sort_type} ${state.mail_tab?.sort_order}` });
export const main_window_tabs = (state) => state.windows.find((window) => window.type === "normal")?.tabs ?? [];
export const active_index = (state) => main_window_tabs(state).findIndex((tab) => tab.active);
export const PAINT_MARGIN_MS = 2000;
// The address book and the calendar paint later than an own page. At 2000 ms on Thunderbird the click landed before the grid was ready.
export const CHROME_TAB_MARGIN_MS = 3000;
export const tab_count_is = (count) => ({ what: `${count} tab${count === 1 ? "" : "s"} in the main window`, until: (state) => main_window_tabs(state).length === count, show: (state) => `${main_window_tabs(state).length} tabs`, timeout_ms: 10000 });
export const active_is = (index) => ({ what: `tab ${index} to be active`, until: (state) => active_index(state) === index, show: (state) => `active index ${active_index(state)}` });
// The new tab is the last one. A tab that reports no status counts as loaded, and a loaded page can still be unpainted, so callers add `PAINT_MARGIN_MS` where a click or a pixel read follows.
export const last_tab_loaded = (count) => ({ what: `tab ${count} to open and finish loading`, until: (state) => main_window_tabs(state).length === count && main_window_tabs(state).at(-1).raw?.status !== "loading", show: (state) => `tabs ${main_window_tabs(state).length}, last ${main_window_tabs(state).at(-1)?.raw?.status}`, timeout_ms: 15000 });
// The colors of a grim ppm capture (P6: a three line text header, then raw RGB) as a map from "#rrggbb" to its pixel count.
export function ppm_colors(path) {
  const ppm = readFileSync(path);
  let body = 0;
  for (let newlines = 0; newlines < 3; body++) if (ppm[body] === 10) newlines++;
  const counts = new Map();
  for (let at = body; at + 2 < ppm.length; at += 3) {
    const color = `#${ppm.subarray(at, at + 3).toString("hex")}`;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return counts;
}
export const luminance_of = (color) => [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255).reduce((sum, channel, index) => sum + [0.2126, 0.7152, 0.0722][index] * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0);
// The image a stored draft gives back: a draft with a data image Thunderbird embeds is saved and opened again, and a NOTE records the `src` of each image. The external editor keeps only the image sources its allowlist names.
// The compose helpers below share these. A reply to inbox-s2 is loaded once its subject, its quote and its signature are in.
export const compose_tab = (state) => state.windows.find((window) => window.type === "messageCompose")?.tabs.find((tab) => tab.subject);
export const reply_is_loaded = (tab) => Boolean(tab.subject) && tab.is_plain !== null && (tab.body ?? "").includes("Body of inbox-s2.") && (tab.body ?? "").includes("E2E signature line");
// The mail window has the focus and a mail tab, so F6 reaches the thread list.
export const mail_window_ready = { what: "the mail window to have a mail tab and the focus", until: (state) => state.mail_tab !== null && normal_window_focused(state), timeout_ms: 10000 };
export const selects_inbox_s2 = selects("inbox-s2@fixture.invalid");