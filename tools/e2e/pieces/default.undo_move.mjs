import { sleep, first_selected, at_bottom } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";
import { panes_helpers, show_inbox_listed } from "./_panes_shared.mjs";

export const areas = ["panes", "mail_keys"];

// The fixture folder the move goes to. Its mbox is non-empty and has no summary file, and nothing in the piece shows it before u. The helper `state` lists folders without showing them, so it builds no summary.
const DESTINATION = "/Views";
const return_key = ["-k", "Return"];

// m m into a folder Thunderbird has never indexed, then u: undo parses the folder through folderpane.indexFolder and moves the message back, with the mail tab still on the Inbox.
async function run_undo_move(instance, ctx) {
  const { app, kind, shot, check, wait_for, open_command_line, press_in_command_line } = ctx;
  const { keys, at_second_last } = panes_helpers(instance, ctx);
  await show_inbox_listed(instance, ctx);
  // The second last row is a single message, so the move and the undo handle exactly one. A collapsed thread root would move its whole thread.
  await keys(["G"], at_bottom);
  const victim = first_selected(await keys(["k"], at_second_last));
  const inbox_ids = () => instance.ask("state").then((state) => state.folders["/Inbox"]);
  const before = await inbox_ids();
  check(app, kind, "the second row is in the Inbox before the move", before.includes(victim), `${victim} in ${before.length} Inbox messages`);

  await instance.press(["m"]);
  await open_command_line(instance, ["m"], { attempts: 2, timeout_ms: 4000 });
  await press_in_command_line(instance, [DESTINATION]);
  await instance.press(return_key);
  const gone = await wait_for(instance, `${victim} to leave the Inbox`, inbox_ids, (ids) => !ids.includes(victim), { timeout_ms: 15000 });
  check(app, kind, `m m then ${DESTINATION} moves the message out of the Inbox`, !gone.includes(victim), `Inbox ${gone.length} messages`);
  // The move into a folder with no summary leaves it unindexed, which is the case u must handle.
  await sleep(1500);
  await instance.press(["u"]);
  const back = await wait_for(instance, `u to bring ${victim} back to the Inbox`, inbox_ids, (ids) => ids.includes(victim), { timeout_ms: 30000 });
  check(app, kind, "u brings the message back from a folder with no summary file", back.includes(victim) && back.length === before.length, `Inbox ${back.length} messages, ${before.length} before, ${victim} back ${back.includes(victim)}`);
  await shot("undo_move_back", "the Inbox after m m moved a message into a folder with no summary and u brought it back");
  const tab = await instance.ask("selection");
  check(app, kind, "the mail tab still shows the Inbox: the parse showed no folder", tab.folder === "/Inbox", `folder ${tab.folder}`);
  const state = await instance.ask("state");
  const destination = state.folders[DESTINATION] ?? [];
  check(app, kind, `${DESTINATION} lists its own messages again and not the one that went back`, destination.length > 0 && !destination.includes(victim), `${destination.length} messages, victim in it ${destination.includes(victim)}`);
}

export const piece = section_piece({ section: "undo_move", run: run_undo_move });
