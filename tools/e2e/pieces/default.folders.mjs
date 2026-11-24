// The folder commands, with one restart of the app.

import { sleep, CTRL, folder_shown, main_window_tabs, active_index } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["folders"];

// Restarts the app, so it goes after the checks that need the session as it is.
async function run_folders(instance, ctx) {
  const { check, note, wait_state, wait_for_state, restart, open_command_line } = ctx;
  const app = instance.app;
  const kind = "default";
  // db-folders-jumps: special folder keys, marks, the jump history and its chords. Local Folders holds an Inbox and a Trash and no Drafts or Sent.
  // The wait is for `wanted`. A key that leaves the folder where it was has no change to wait on, so it keeps a fixed margin, which also covers a key that must not move the folder.
  const shown_folder = async (keys, wanted) => {
    const was = (await instance.ask("state")).mail_tab?.folder;
    for (const key of keys.slice(0, -1)) await instance.press(typeof key === "string" ? [key] : key);
    const last = keys.at(-1);
    await instance.press(typeof last === "string" ? [last] : last);
    if (was === wanted) {
      await sleep(1500);
      return (await instance.ask("state")).mail_tab?.folder;
    }
    return (await wait_state(instance, `${keys.map((key) => (typeof key === "string" ? key : "C-key")).join(" ")} to show ${wanted}`, (state) => state.mail_tab?.folder === wanted, { soft: true, timeout_ms: 10000 })).mail_tab?.folder;
  };
  // M a and M b store a mark and change no state.
  const set_mark = async (letter) => {
    await instance.press(["M"]);
    await instance.press([letter]);
    await sleep(700);
  };
  await instance.ask("select_tab", 20000, { index: 0 });
  await wait_state(instance, "the mail tab to be the active tab", (state) => main_window_tabs(state)[0]?.active === true, { soft: true });
  check(app, kind, "g i shows the Inbox", (await shown_folder(["g", "i"], "/Inbox")) === "/Inbox");
  await set_mark("a");
  check(app, kind, "g t shows Trash", (await shown_folder(["g", "t"], "/Trash")) === "/Trash");
  check(app, kind, "' a returns to the Inbox marked with M a", (await shown_folder(["'", "a"], "/Inbox")) === "/Inbox");
  check(app, kind, "C-o walks back to Trash", (await shown_folder([CTRL("o")], "/Trash")) === "/Trash");
  check(app, kind, "a second C-o walks back to the Inbox", (await shown_folder([CTRL("o")], "/Inbox")) === "/Inbox");
  check(app, kind, "C-i walks forward to Trash", (await shown_folder([CTRL("i")], "/Trash")) === "/Trash");
  check(app, kind, "a second C-i walks forward to the Inbox", (await shown_folder([CTRL("i")], "/Inbox")) === "/Inbox");
  // Marks and the history live in storage, so the restart is of the whole app on the same profile.
  await shown_folder(["g", "t"], "/Trash");
  await set_mark("b");
  await restart(instance, app, kind, "restart");
  const start_folder = (await instance.ask("state")).mail_tab?.folder;
  note(app, kind, "folder shown after the restart", String(start_folder));
  check(app, kind, "g i after the restart shows the Inbox", (await shown_folder(["g", "i"], "/Inbox")) === "/Inbox");
  // The app restores the folder it last showed, or another. C-o goes back to the folder shown at the start, and from a start on the Inbox it goes back to Trash.
  const back_to_folder = start_folder && start_folder.length > 1 && start_folder !== "/Inbox" ? start_folder : "/Trash";
  check(app, kind, `C-o after the restart walks back to ${back_to_folder}`, (await shown_folder([CTRL("o")], back_to_folder)) === back_to_folder);
  await shown_folder(["g", "i"], "/Inbox");
  check(app, kind, "the mark set before the restart survives it", (await shown_folder(["'", "b"], "/Trash")) === "/Trash");
  // A special folder this account lacks changes nothing and the app stays up.
  await shown_folder(["g", "i"], "/Inbox");
  check(app, kind, "g s with no Sent folder leaves the view where it was", (await shown_folder(["g", "s"], "/Inbox")) === "/Inbox");
  // The history rests on the display event, so measure it: an API display of a never shown folder throws in the API call and still fires the event.
  await instance.ask("folder_events_start");
  const first_display = await instance.ask("show_folder", 20000, { path: "/Views" });
  await wait_for_state(instance, folder_shown("/Views"));
  // The event fires in the same step as the display, so a second one would follow at once. The margin is for that negative read.
  await sleep(500);
  const events = (await instance.ask("folder_events_read")).events;
  check(app, kind, "onDisplayedFolderChanged fires once for a folder the API shows for the first time", events.length === 1 && events[0].path === "/Views", `events ${JSON.stringify(events.map((event) => event.path))}`);
  note(app, kind, "first display of /Views through the API", `update error ${first_display.update_error}, query right after ${first_display.query_error ?? first_display.shown_right_after}`);
  check(app, kind, "g i after the API display shows the Inbox again", (await shown_folder(["g", "i"], "/Inbox")) === "/Inbox");
  // O opens the command line on `open --tab `: the folder shows in a new front tab and the first tab keeps its folder.
  const tabs_before = main_window_tabs(await instance.ask("state")).length;
  await open_command_line(instance, ["O"]);
  await instance.press(["/Trash"]);
  await instance.press(["-k", "Return"]);
  const with_new_tab = await wait_state(instance, "O /Trash Enter to open a new active tab on Trash", (state) => main_window_tabs(state).length === tabs_before + 1 && active_index(state) === tabs_before && state.mail_tab?.folder === "/Trash", { soft: true, timeout_ms: 10000 });
  check(app, kind, "O /Trash opens one new tab, active, showing Trash", main_window_tabs(with_new_tab).length === tabs_before + 1 && active_index(with_new_tab) === tabs_before && with_new_tab.mail_tab?.folder === "/Trash", `tabs ${main_window_tabs(with_new_tab).length}, active ${active_index(with_new_tab)}, folder ${with_new_tab.mail_tab?.folder}`);
  await instance.ask("select_tab", 20000, { index: 0 });
  const first_tab = await wait_state(instance, "the first tab to be active", (state) => active_index(state) === 0 && state.mail_tab?.folder !== undefined, { soft: true });
  check(app, kind, "the first tab keeps the Inbox after O /Trash", first_tab.mail_tab?.folder === "/Inbox", `folder ${first_tab.mail_tab?.folder}`);
  check(app, kind, "the app survived the folder keys", instance.exited() === null);
}

export const piece = section_piece({ section: "folders", only: [], run: run_folders });
