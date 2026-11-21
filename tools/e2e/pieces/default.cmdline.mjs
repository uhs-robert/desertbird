// The command line.

import { sleep, same, leaves_row, window_has_focus, window_is_closed, QUIET_AFTER_ESCAPE_MS, sorted_by } from "../predicates.mjs";
import { section_piece, ensure_views_folder } from "./_default_shared.mjs";

// The command line, in the Views folder (`ensure_views_folder` shows it). `:` opens the overlay over the window and the keys go to it. Esc closes it and the list has focus again. A typed command runs.
// Focus back in the list is measured with Thunderbird's own Down key: it moves the list selection only while the list has focus, and the overlay is gone from the focus chain by then.
async function run_cmdline(instance, ctx) {
  const { app, kind, shot, check, wait_state, wait_for_state, show_folder, key_and_state, settled_state, open_command_line, press_in_command_line, close_command_line } = ctx;
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  const return_key = ["-k", "Return"];
  let state = await instance.ask("state");
  await ensure_views_folder(instance, ctx);
  state = await settled_state(instance, selection_of);
  let selected_before = selection_of(state);
  let folders_before = JSON.stringify(state.folders);
  // j and a typed with no pause after the colon: the key runtime holds plain keys until the overlay has the focus, so neither reaches the list.
  await open_command_line(instance, [":", "j", "a"]);
  await shot("cmdline_open", "the command line over the bottom of the window, with the completion list above its input");
  // Keys typed before the line was ready are dropped with no sign, so the margin is fixed.
  await sleep(QUIET_AFTER_ESCAPE_MS);
  state = await instance.ask("state");
  check(app, kind, ": then j a typed with no pause runs neither a motion nor archive", selection_of(state) === selected_before && JSON.stringify(state.folders) === folders_before, `selected ${selected_before} then ${selection_of(state)}, mail changed: ${JSON.stringify(state.folders) !== folders_before}`);
  // The line draws the two letters, which proves they reached the line and not the list.
  await press_in_command_line(instance, ["j", "a"]);
  state = await instance.ask("state");
  check(app, kind, "j and a typed into the open command line run nothing", selection_of(state) === selected_before && JSON.stringify(state.folders) === folders_before, `selected ${selected_before} then ${selection_of(state)}`);
  await shot("cmdline_typed", "the line after j and a were typed into it");
  await close_command_line(instance);
  await shot("cmdline_closed", "the window after Escape, with no command line");
  state = await key_and_state(instance, ["j"], leaves_row(selected_before));
  check(app, kind, "after Escape a bound key runs again", selection_of(state) !== selected_before, `selected ${selected_before} then ${selection_of(state)}`);
  const row_after_j = selection_of(state);
  state = await key_and_state(instance, ["-k", "Down"], leaves_row(row_after_j));
  check(app, kind, "after Escape the list has focus: Thunderbird's own Down moves the selection", selection_of(state) !== row_after_j && selection_of(state) !== "", `selected ${row_after_j} then ${selection_of(state)}`);

  // The widgets at the right end of the line: the folder and [n/m] at the normal width, none on a search line, none in a window under 30rem.
  await open_command_line(instance);
  await shot("cmdline_widgets", "the line at the normal width: the folder name and [n/m] at its right end");
  await close_command_line(instance);
  await open_command_line(instance, ["/"]);
  await shot("cmdline_widgets_search", "the search line: no widgets at its right end");
  await close_command_line(instance);
  const narrow = (await instance.ask("open_normal_window", 45000, { width: 400, height: 600 })).opened;
  await wait_for_state(instance, window_has_focus(narrow));
  await open_command_line(instance, [":"], { attempts: 3, timeout_ms: 3000 });
  await shot("cmdline_widgets_narrow", "the line in a window 400 px wide: the widgets are hidden");
  await close_command_line(instance);
  await instance.ask("close_normal_window", 10000, { id: narrow });
  await wait_for_state(instance, window_is_closed(narrow));

  // The keys column: archive, delete and reply are listed by msg. words, and sort by its own name.
  for (const word of ["msg.ar", "msg.del", "msg.rep", "sort"]) {
    await open_command_line(instance);
    await press_in_command_line(instance, [word]);
    await shot(`cmdline_keys_${word.replace(".", "_")}`, `the list for "${word}" with the keys column filled`);
    await close_command_line(instance);
  }
  await open_command_line(instance);
  await press_in_command_line(instance, ["sort --date --ascending"]);
  await shot("cmdline_sort", "the line with sort --date --ascending typed");
  await instance.press(return_key);
  state = await wait_for_state(instance, sorted_by("date", "ascending"));
  check(app, kind, ": sort --date --ascending runs the command", state.mail_tab?.sort_type === "date" && state.mail_tab?.sort_order === "ascending", `sort ${state.mail_tab?.sort_type} ${state.mail_tab?.sort_order}`);
  // The ascending date sort leaves the selection on the first row, where Up cannot move it, so the key is Down.
  const after_run = selection_of(state);
  state = await key_and_state(instance, ["-k", "Down"], leaves_row(after_run));
  check(app, kind, "after a command ran the list has focus again", selection_of(state) !== after_run, `selected ${after_run} then ${selection_of(state)}`);

  // The key m t opens the line with the command started, and the command acts on the message selected when the key was pressed.
  const target = state.selected[0]?.header_id;
  await instance.press(["m"]);
  await open_command_line(instance, ["t"]);
  await press_in_command_line(instance, ["Work"]);
  await instance.press(return_key);
  state = await wait_state(instance, "m t Work to tag the selected message", (current) => (current.flags[target]?.tags ?? []).includes("$label2"), { soft: true });
  check(app, kind, "m t then Work tags the selected message", target !== undefined && (state.flags[target]?.tags ?? []).includes("$label2"), `${target} tags ${JSON.stringify(state.flags[target]?.tags)}`);
  await open_command_line(instance);
  await press_in_command_line(instance, ["fil"]);
  await shot("cmdline_completions", "the line with fil typed: the matching rows above it, the box as wide as the window");
  await press_in_command_line(instance, ["-k", "Tab"]);
  await shot("cmdline_after_tab", "the line after Tab: the box keeps its size and position");
  await close_command_line(instance);

  // C-n and C-p belong to the line. Thunderbird binds them to a new message and to print, so a leak shows as a new window.
  // The page runs a row key only after the completion answer for the text in the line has come, so a read at a fixed time can come first. The input row is polled until it changes, and the row of C-p is compared with the one of C-n.
  const windows_before_ctrl = (await instance.ask("state")).windows;
  const input_row = "0,692 640x28";
  await open_command_line(instance);
  const { after: input_typed } = await press_in_command_line(instance, ["f"], input_row);
  const { after: input_after_n } = await press_in_command_line(instance, ["-M", "ctrl", "-k", "n", "-m", "ctrl"], input_row);
  check(app, kind, "C-n puts a row in the input line", input_after_n !== input_typed);
  const { after: input_after_p } = await press_in_command_line(instance, ["-M", "ctrl", "-k", "p", "-m", "ctrl"], input_row);
  check(app, kind, "C-p then puts another row in", input_after_p !== input_after_n);
  await shot("cmdline_ctrl_n_p", "the line after C-n and C-p: a row went into the line and no other window opened");
  const windows_after_ctrl = (await instance.ask("state")).windows;
  check(app, kind, "C-n and C-p in the open line open no window", same(windows_before_ctrl, windows_after_ctrl) && instance.exited() === null, `windows before ${windows_before_ctrl.length}, after ${windows_after_ctrl.length}`);
  await close_command_line(instance);

  // History: two sorts run, then a fresh line recalls them newest first, so Up twice is the older sort.
  for (const order of ["descending", "ascending"]) {
    await open_command_line(instance);
    await press_in_command_line(instance, [`sort --date --${order}`]);
    await instance.press(return_key);
    await wait_for_state(instance, sorted_by("date", order));
  }
  await open_command_line(instance);
  await press_in_command_line(instance, ["-k", "Up"]);
  await press_in_command_line(instance, ["-k", "Up"]);
  await shot("cmdline_history_recall", "the line after Up twice: the older sort command is in the input");
  await instance.press(return_key);
  state = await wait_for_state(instance, sorted_by("date", "descending"));
  check(app, kind, "Up twice in a fresh line recalls the older command and Enter runs it", state.mail_tab?.sort_order === "descending", `sort ${state.mail_tab?.sort_type} ${state.mail_tab?.sort_order}`);
  await open_command_line(instance);
  await press_in_command_line(instance, ["bogus"]);
  // The error shows in the note row, which is the one change this waits on.
  await press_in_command_line(instance, return_key);
  await shot("cmdline_error", "the line stays open and names the unknown command");
  await close_command_line(instance);
  check(app, kind, "the app survived the command line", instance.exited() === null);

  // The first Escape closes the list and keeps the line, the second closes the line. Keys m s toggle the star of the selected message when the list has them, and are typed into the line when it is open.
  // A key typed into the line has no state, so the refused case waits out the 900 ms margin that the positive case leaves early.
  const keys_reach_list = async () => {
    const id = (await instance.ask("state")).selected[0]?.header_id;
    const flagged = async () => (await instance.ask("state")).flags[id]?.flagged;
    const before = await flagged();
    await instance.press(["m"]);
    await instance.press(["s"]);
    await wait_state(instance, "m s to flip the star", (current) => current.flags[id]?.flagged !== before, { timeout_ms: 900, soft: true });
    if ((await flagged()) === before) return false;
    await instance.press(["m"]);
    await instance.press(["s"]);
    await wait_state(instance, "the second m s to put the star back", (current) => current.flags[id]?.flagged === before, { soft: true });
    return true;
  };
  await open_command_line(instance);
  await press_in_command_line(instance, ["-k", "Escape"]);
  await shot("cmdline_list_closed", "after the first Escape: the list is gone and the input line stays");
  check(app, kind, "the first Escape keeps the line open: m s is typed into it", !(await keys_reach_list()));
  await close_command_line(instance);
  check(app, kind, "after Escape three times the line is closed and keys reach the list", await keys_reach_list());
  await shot("cmdline_list_closed_twice", "after the Escapes: no command line");
  // A selected row puts its usage in the note row, and a missing value shows in the note in the error color.
  await open_command_line(instance);
  await press_in_command_line(instance, ["-k", "Tab"]);
  await press_in_command_line(instance, ["-k", "Tab"]);
  await shot("cmdline_selected_note", "the line after two Tabs: the second row is in the line and the note row above the input shows its usage");
  await close_command_line(instance);
  await open_command_line(instance);
  await press_in_command_line(instance, ["step.unread"]);
  await press_in_command_line(instance, return_key);
  await shot("cmdline_typed_error", "step.unread typed and run: the note row shows the error in the error color");
  await close_command_line(instance);
  check(app, kind, "the line is closed before the next scenario", await keys_reach_list());

  // Enter takes the highlighted row: a fuzzy word picks a folder without Tab.
  await show_folder(instance, "/Views");
  await open_command_line(instance, ["o"]);
  // Enter follows the letters at once, so the answer for the last letter may still be on its way.
  await instance.press(["inb"]);
  await instance.press(return_key);
  state = await wait_state(instance, "o inb Enter to show the Inbox", (current) => current.mail_tab?.folder === "/Inbox", { soft: true, timeout_ms: 10000 });
  check(app, kind, "o then inb Enter shows the highlighted folder, the Inbox", state.mail_tab?.folder === "/Inbox", `folder ${state.mail_tab?.folder}`);
  let listed_inbox = await wait_state(instance, "the Inbox to list its messages", (current) => current.listed.length > 0, { soft: true, timeout_ms: 10000 });
  // A long run remembers a selection in the Inbox. Run alone, the pick selects no row, so g g gives the m m a message to move.
  if (listed_inbox.selected.length === 0) {
    await instance.press(["g"]);
    listed_inbox = await key_and_state(instance, ["g"], { what: "g g to select the first row", until: (current) => current.selected.length > 0 });
  }
  const before_j = selection_of(listed_inbox);
  // The folder pick selects a row of its own. A probe on both apps (a Down after `o inb Enter` and 3 s) moved that selection, so the focus is in the list. A j straight after the pick moved nothing in full runs, and on main the check never saw it. The message to move is the one that is selected.
  const moved = before_j === "" ? undefined : before_j.split(",")[0];
  await instance.press(["m"]);
  await open_command_line(instance, ["m"]);
  await instance.press(["vie"]);
  await instance.press(return_key);
  state = await wait_state(instance, `${moved} to move to /Views`, (current) => current.folders["/Views"]?.includes(moved) === true && current.folders["/Inbox"]?.includes(moved) !== true, { soft: true, timeout_ms: 10000 });
  check(app, kind, "m m then vie Enter moves the message to the highlighted folder, /Views", moved !== undefined && state.folders["/Views"]?.includes(moved) === true && state.folders["/Inbox"]?.includes(moved) !== true, `${moved} in Views ${state.folders["/Views"]?.includes(moved)}, in Inbox ${state.folders["/Inbox"]?.includes(moved)}`);
}

export const piece = section_piece({ section: "cmdline", only: ["cmdline"], run: run_cmdline });
