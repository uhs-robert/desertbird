import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { first_selected, selects } from "../predicates.mjs";
import { show_inbox_listed } from "./_panes_shared.mjs";

export const areas = ["panes"];

// Native Down moves the folder in the folder pane and the selection in the thread list, so it tells where the focus is. The probe puts the move back with Up.
export async function probe_pane(instance, ctx) {
  const { key_and_state } = ctx;
  const folder_of = (state) => state.mail_tab?.folder ?? null;
  // Down in a list with no current row moves nothing, so a row is selected first (through the helper, which moves no focus).
  let before = await instance.ask("state");
  if (before.selected.length === 0) {
    await instance.ask("select:" + before.listed[0], 30000);
    before = await ctx.wait_for_state(instance, selects(before.listed[0]));
  }
  const moved = (state) => folder_of(state) !== folder_of(before) || first_selected(state) !== first_selected(before);
  const after = await key_and_state(instance, ["-k", "Down"], { what: "native Down to move a folder or a row", until: moved, soft: true, timeout_ms: 1500 });
  if (folder_of(after) !== folder_of(before)) {
    await key_and_state(instance, ["-k", "Up"], { what: "Up to return to the folder", until: (state) => folder_of(state) === folder_of(before) });
    return "folders";
  }
  if (first_selected(after) !== first_selected(before)) {
    await key_and_state(instance, ["-k", "Up"], { what: "Up to return to the row", until: (state) => first_selected(state) === first_selected(before) });
    return "threads";
  }
  return "none";
}

// The first main window at launch gives the folder pane the keyboard focus when it is visible. The piece runs no Tab walk first.
async function run_startup_focus(instance, ctx) {
  const { app, kind, check, shot } = ctx;
  await show_inbox_listed(instance, ctx);
  await shot("startup_focus_launch", "the window as it launched, folder pane visible");
  const launch_pane = await probe_pane(instance, ctx);
  check(app, kind, "the folder pane has the focus at launch: Down moves the folder", launch_pane === "folders", `Down moved ${launch_pane}`);

  // A restart on the same profile restores the tab from session.json. The app quits on SIGTERM without saving a session, so the file written here is the one the restart reads.
  const tab = { mode: "mail3PaneTab", state: { firstTab: true, folderPaneVisible: false, folderURI: "mailbox://nobody@Local%20Folders/Inbox", messagePaneVisible: true }, ext: {} };
  writeFileSync(join(instance.profile_dir, "session.json"), JSON.stringify({ rev: 0, windows: [{ type: "3pane", tabs: { rev: 0, selectedIndex: 0, tabs: [tab] } }] }));
  await instance.restart();
  const hidden = (await instance.ask("state")).mail_tab?.folder_pane_visible === false;
  await show_inbox_listed(instance, ctx);
  await shot("startup_focus_hidden", "the window as it launched with the folder pane hidden");
  check(app, kind, "the restart restored a hidden folder pane", hidden);
  const hidden_pane = await probe_pane(instance, ctx);
  // Thunderbird itself leaves the focus on no element until a key or a click, so Down can move nothing here. What the launch must not do is hand the focus to the hidden folder tree.
  check(app, kind, "with the folder pane hidden at launch the focus does not go to the folder pane: Down moves no folder", hidden_pane !== "folders", `Down moved ${hidden_pane}`);
}

export const piece = { kind: "default", section: "startup_focus", toast_seed: true, only: ["panes"], run: run_startup_focus };
