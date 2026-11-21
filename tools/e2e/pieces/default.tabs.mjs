// The tab commands.

import { COLLAPSED_ROWS } from "../fixture_rows.mjs";
import { HUD_REGION, holds_twice, sleep, CTRL, first_selected, selects, at_bottom, main_window_tabs, active_index, tab_count_is, active_is } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["tabs"];

// Tab commands. The helper add-on opens, selects and closes tabs through the API, since wtype has no mouse.
async function run_tabs(instance, ctx) {
  const { check, note, shot, key_and_state, wait_state, wait_for_state, toast_cycle } = ctx;
  const app = instance.app;
  const kind = "default";
  const active_is_last = { what: "the last tab to be active", until: (state) => active_index(state) === main_window_tabs(state).length - 1, show: (state) => `active index ${active_index(state)} of ${main_window_tabs(state).length}` };
  const trash_count = (state) => state.folders["/Trash"]?.length ?? 0;
  const trash_is = (count) => ({ what: `Trash to hold ${count}`, until: (state) => trash_count(state) === count, show: (state) => `Trash holds ${trash_count(state)}`, timeout_ms: 10000 });
  const select_tab = async (index) => {
    await instance.ask("select_tab", 20000, { index });
    return wait_for_state(instance, active_is(index));
  };
  const reset_tabs = async () => {
    await instance.ask("reset_tabs");
    return wait_for_state(instance, tab_count_is(1));
  };
  const open_tab = async (command, count) => {
    const reply = await instance.ask(command);
    return { reply, state: await wait_for_state(instance, tab_count_is(count)) };
  };

  // q on the only mail tab: tabs.remove does nothing there, so q moves the focus to the thread list, shows no toast and the tab stays.
  const refused_q = await toast_cycle(instance, `${app}_q`, ["q"], [], { expect_toast: false });
  let state = refused_q.state;
  check(app, kind, "q on the only mail tab leaves it open", main_window_tabs(state).length === 1, `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => tab.type))}`);
  check(app, kind, "q on the only mail tab shows no refusal toast", !refused_q.shown, "the toast strip differs while a toast shows");

  // What the tabs API reports for the first mail tab and for a second one.
  const opened_second = await open_tab("open_mail_tab", 2);
  const second = opened_second.reply;
  state = opened_second.state;
  check(app, kind, "a second mail tab opens", main_window_tabs(state).length === 2, `reply ${JSON.stringify(second)}`);
  note(app, kind, "tab properties", JSON.stringify(main_window_tabs(state).map((tab) => tab.raw)));
  // q closes a second mail tab: the one tab a key can be pressed in and tabs.remove can close.
  state = await key_and_state(instance, ["q"], tab_count_is(1));
  check(app, kind, "q closes a second mail tab", main_window_tabs(state).length === 1, `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => `${tab.type}${tab.active ? "*" : ""}`))}`);
  await open_tab("open_mail_tab", 2);
  // The tabs API gives no property that marks the first mail tab. Can the API move it off index 0?
  const moved = await instance.ask("move_first_tab");
  await sleep(1000);
  state = await instance.ask("state");
  note(app, kind, "tabs.move of the first mail tab to index 1", `reply ${JSON.stringify(moved)}, tab ids by index now ${JSON.stringify(main_window_tabs(state).map((tab) => tab.id))}`);
  await reset_tabs();

  // Measured facts for tabs other than the mail tab.
  const opened_content = await open_tab("open_content_tab", 2);
  const content = opened_content.reply;
  state = opened_content.state;
  note(app, kind, "content tab opened", `id ${content.opened}, tabs ${JSON.stringify(main_window_tabs(state).map((tab) => `${tab.type}${tab.active ? "*" : ""}`))}`);
  state = await select_tab(0);
  check(app, kind, "tabs.update makes the mail tab active again", active_index(state) === 0, `active index ${active_index(state)}`);
  await shot("mail_tab_again", "main window back on the mail tab after the content tab opened");

  // J and K switch tabs, and C-j opens Saved Files again because DesertBird has no key on it.
  const before_chord = main_window_tabs(await instance.ask("state"));
  state = await key_and_state(instance, ["J"], active_is(1));
  check(app, kind, "J switches to the next tab", active_index(state) === 1, `active index ${active_index(state)}`);
  check(app, kind, "J opens no Saved Files tab", main_window_tabs(state).length === before_chord.length && !main_window_tabs(state).some((tab) => /saved/i.test(`${tab.title} ${tab.type}`)), `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => `${tab.type}:${tab.title}`))}`);
  await select_tab(0);

  // With a content tab beside it, K from the mail tab wraps to the last tab.
  state = await key_and_state(instance, ["K"], active_is_last);
  check(app, kind, "K switches to the previous tab, wrapping to the last", active_index(state) === main_window_tabs(state).length - 1, `active index ${active_index(state)} of ${main_window_tabs(state).length}`);
  await shot("after_k", "the content tab in front after K from the mail tab");

  // From the content tab no key works: record what a key does there.
  const log_before_content_key = instance.app_log().length;
  state = await key_and_state(instance, ["J"], 1500);
  note(app, kind, "J from a content tab", `active index ${active_index(state)} of ${main_window_tabs(state).length}, tab types ${JSON.stringify(main_window_tabs(state).map((tab) => tab.type))}, log grew ${instance.app_log().length - log_before_content_key} bytes`);
  await select_tab(0);

  // The t group does the same from the mail tab. A content tab runs no key but Alt+Q, so each press starts on the mail tab.
  await instance.press(["t"]);
  state = await key_and_state(instance, ["n"], active_is(1));
  check(app, kind, "t n switches to the next tab", active_index(state) === 1, `active index ${active_index(state)}`);
  await select_tab(0);
  await instance.press(["t"]);
  state = await key_and_state(instance, ["p"], active_is_last);
  check(app, kind, "t p switches to the previous tab, wrapping to the last", active_index(state) === main_window_tabs(state).length - 1, `active index ${active_index(state)} of ${main_window_tabs(state).length}`);
  await select_tab(0);
  // Ctrl+J is Thunderbird's again and opens Saved Files.
  const before_ctrl_j = main_window_tabs(await instance.ask("state")).length;
  state = await key_and_state(instance, CTRL("j"), tab_count_is(before_ctrl_j + 1));
  check(app, kind, "C-j opens Saved Files again, since DesertBird has no key on it", main_window_tabs(state).length === before_ctrl_j + 1, `tabs ${before_ctrl_j} then ${main_window_tabs(state).length}`);

  // The helper closes every extra tab. Then a fresh content tab measures tabs.remove away from the mail tab.
  await reset_tabs();
  await open_tab("open_content_tab", 2);
  const removed = await instance.ask("remove_tab", 20000, { index: 1 });
  state = await wait_for_state(instance, tab_count_is(1));
  check(app, kind, "tabs.remove closes a content tab", removed.removed === true && main_window_tabs(state).length === 1, `tabs left ${main_window_tabs(state).length}`);

  // A message tab: open one for the selected message, switch to it, and measure a key there.
  state = (await open_tab("open_message_tab", 2)).state;
  note(app, kind, "message tab opened", `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => `${tab.type}${tab.active ? "*" : ""}`))}`);
  const message_tab_count = main_window_tabs(state).length;
  await select_tab(0);
  state = await key_and_state(instance, ["J"], active_is(1));
  check(app, kind, "J reaches the message tab from the mail tab", active_index(state) === 1 && message_tab_count === 2, `active index ${active_index(state)} of ${main_window_tabs(state).length}`);
  state = await key_and_state(instance, ["K"], 1500);
  note(app, kind, "K from a message tab", `active index ${active_index(state)} of ${main_window_tabs(state).length}`);
  // q in the mail tab closes nothing: the main tab stays and the tab count holds.
  await select_tab(0);
  state = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "q in the mail tab closes no tab", main_window_tabs(state).length === message_tab_count && active_index(state) === 0, `tabs ${main_window_tabs(state).length}, active ${active_index(state)}`);
  await select_tab(1);
  state = await key_and_state(instance, ["q"], tab_count_is(1));
  check(app, kind, "q closes the message tab it is typed in", main_window_tabs(state).length === 1, `tabs left ${main_window_tabs(state).length}`);

  // db-sequence-reset: a d typed before a tab switch with no key between (a click) does not pair with a d typed after it.
  await open_tab("open_content_tab", 2);
  await select_tab(0);
  await instance.press(["g"]);
  state = await key_and_state(instance, ["G"], at_bottom);
  const trash_before = trash_count(state);
  await instance.press(["d"]);
  await select_tab(1);
  await select_tab(0);
  // No barrier here: its Escape would end the d that the next key must pair with.
  state = await key_and_state(instance, ["d"], 2500);
  check(app, kind, "a d typed before a tab switch does not pair with a d typed after it", (state.folders["/Trash"]?.length ?? 0) === trash_before, `Trash holds ${state.folders["/Trash"]?.length ?? 0}, it held ${trash_before}`);
  // One more d: it pairs with the d typed after the switch only if that d reached the app, so a lost first key fails here.
  const doomed = first_selected(state);
  state = await key_and_state(instance, ["d"], trash_is(trash_before + 1));
  check(app, kind, "the d after the switch counted, so the next d trashes", (state.folders["/Trash"]?.length ?? 0) === trash_before + 1, `Trash holds ${state.folders["/Trash"]?.length ?? 0}`);
  // A count is part of the half-typed state too: 3, a tab switch and back, then k moves one row. Three rows means the count survived. No move means the key was lost.
  const listed_index = (snapshot) => snapshot.listed.indexOf(first_selected(snapshot));
  // The trashed row has to leave the list first, or G can stop on it and last_row is one too far down.
  state = await key_and_state(instance, ["G"], { ...at_bottom, until: (now) => at_bottom.until(now) && !now.listed.includes(doomed) });
  const last_row = listed_index(state);
  await instance.press(["3"]);
  await select_tab(1);
  await select_tab(0);
  state = await key_and_state(instance, ["k"], { what: "k to move the selection off the last row", until: (now) => listed_index(now) !== last_row, show: (now) => `row ${listed_index(now)}` });
  check(app, kind, "a count typed before a tab switch is dropped, so k moves one row", listed_index(state) === last_row - 1, `row ${listed_index(state)} after k from row ${last_row}`);
  await instance.ask("remove_tab", 20000, { index: 1 });
  await wait_for_state(instance, tab_count_is(1));
  // A window blur ends the sequence too: d, another window takes focus and gives it back, then d. The popup takes focus when it opens, so the main window blurs.
  state = await key_and_state(instance, ["G"], at_bottom);
  const trash_before_blur = trash_count(state);
  await instance.press(["d"]);
  const popup = await instance.ask("open_popup_window", 20000);
  await wait_state(instance, "the popup window to take the focus", (now) => now.windows.some((window) => window.id === popup.opened && window.focused), { timeout_ms: 10000 });
  await instance.ask("close_popup_window", 20000, { id: popup.opened });
  await wait_state(instance, "the main window to get the focus back", (now) => now.windows.some((window) => window.type === "normal" && window.focused) && !now.windows.some((window) => window.id === popup.opened), { timeout_ms: 10000 });
  state = await key_and_state(instance, ["d"], 2500);
  check(app, kind, "a d typed before a window blur does not pair with a d typed after it", (state.folders["/Trash"]?.length ?? 0) === trash_before_blur, `Trash holds ${state.folders["/Trash"]?.length ?? 0}, it held ${trash_before_blur}`);
  // One more d: it pairs with the d typed after the blur only if that d reached the app, so a window that never got focus back fails here. It also leaves no d pending.
  state = await key_and_state(instance, ["d"], trash_is(trash_before_blur + 1));
  check(app, kind, "the d after the blur counted, so the next d trashes", (state.folders["/Trash"]?.length ?? 0) === trash_before_blur + 1, `Trash holds ${state.folders["/Trash"]?.length ?? 0}`);

}

// run_tabs starts with a selected row whose pane has loaded, and compares the bottom strip against a baseline it takes first, so the load has to end.
const select_last_row_loaded = async (instance, ctx) => {
  await ctx.key_and_state(instance, ["G"], selects(COLLAPSED_ROWS.at(-1)));
  await ctx.wait_message_loaded(instance, COLLAPSED_ROWS.at(-1));
  // The scroll to the last row leaves the list's scrollbar fading at the edge of the strip, which would read as a toast.
  await ctx.wait_pixels(instance, "the bottom strip to hold still", `${instance.app}_tabs_still`, HUD_REGION, holds_twice(), { timeout_ms: 8000 });
};

export const piece = section_piece({ section: "tabs", only: [], setup: select_last_row_loaded, run: run_tabs });
