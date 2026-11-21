import { sleep, first_selected, at_top, at_bottom, thread_shows } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";
import { panes_helpers, show_inbox_listed } from "./_panes_shared.mjs";

export const areas = ["panes", "mail_keys"];

// u and :undo, then the native Delete that u leaves alone.
async function run_panes_undo(instance, ctx) {
  const { app, kind, shot, check, wait_state, barrier, expect_absent } = ctx;
  const { keys, at_second_last, in_folder, messages_in_inbox, at_second, holds } = panes_helpers(instance, ctx);
  await show_inbox_listed(instance, ctx);
  // The undo checks below expect an older step on the stack, and the stack of a fresh app is empty, so one archive goes first.
  // The second last row is a single message, so the later u brings back exactly one. A collapsed thread root would archive its whole thread.
  await keys(["G"], at_bottom);
  const seed = first_selected(await keys(["k"], at_second_last));
  await keys(["a"], holds("a", "/Inbox", seed, false));
  let state;
  // u and :undo run DesertBird's own undo log. d d, a and the API delete record a step there. A delete by the native Delete key is Thunderbird's, so u leaves it alone.
  const undo_typed = async (id) => {
    await instance.press([":"]);
    await sleep(1200);
    await instance.press(["undo"]);
    await instance.press(["-k", "Return"]);
    return wait_state(instance, `:undo to bring ${id} back to the Inbox`, (current) => in_folder(current, id, "/Inbox"), { timeout_ms: 10000, show: (current) => `${current.folders["/Inbox"].length} in the Inbox` });
  };
  // No helper state marks the end of the queued undo steps, so the count of every folder must stay put for QUIET_MS. One undo step for a gone message takes about 3 s and changes no count, so the window spans two of them. Archived mail lands in a subfolder (/Archives/2025), so no fixed path list sees it.
  const wait_for_quiet_counts = async () => {
    const QUIET_MS = 7000;
    const counts_of = (current) => Object.keys(current.folders).sort().map((path) => `${path}:${current.folders[path].length}`).join(" ");
    let counts = counts_of(await instance.ask("state"));
    let since = Date.now();
    const give_up = Date.now() + 60000;
    while (Date.now() - since < QUIET_MS && Date.now() < give_up) {
      await sleep(250);
      const now_counts = counts_of(await instance.ask("state"));
      if (now_counts !== counts) { counts = now_counts; since = Date.now(); }
    }
    check(app, kind, "the undo queue drains after the 42 u: the folder counts hold still", Date.now() - since >= QUIET_MS, `counts ${counts}`);
  };
  await keys(["g", "t"]);
  await keys(["g", "i"], 2500);
  await keys(["g", "g"], at_top);
  let victim = first_selected(await keys(["j"], at_second));
  state = await keys(["d", "d"], holds("d d", "/Trash", victim, true));
  const in_trash = in_folder(state, victim, "/Trash");
  state = await keys(["u"], holds("u", "/Inbox", victim, true));
  check(app, kind, "u after d d moves the message back from Trash to the Inbox", in_trash && in_folder(state, victim, "/Inbox") && !in_folder(state, victim, "/Trash"), `${victim} in Trash after d d ${in_trash}, in the Inbox after u ${in_folder(state, victim, "/Inbox")}`);
  await shot("undo_after_dd", "Inbox after d d then u");
  await keys(["g", "e"]);
  await keys(["g", "g"], at_top);
  victim = first_selected(await keys(["j"], at_second));
  state = await keys(["a"], holds("a", "/Inbox", victim, false));
  const archived = !in_folder(state, victim, "/Inbox");
  state = await keys(["u"], holds("u", "/Inbox", victim, true));
  check(app, kind, "u after a moves the message back from Archives to the Inbox", archived && in_folder(state, victim, "/Inbox"), `${victim} out of the Inbox after a ${archived}, in the Inbox after u ${in_folder(state, victim, "/Inbox")}`);
  // A count reaches the rows below the current one. The fixture threads open collapsed, so z R opens them first: a count refuses to reach into a closed thread.
  await instance.press(["z"]);
  await instance.press(["R"]);
  await keys(["g", "g"], { what: "z R to open the first thread and g g to select its root", until: (current) => at_top.until(current) && thread_shows(true).until(current) });
  state = await keys(["j"], at_second);
  const counted = state.listed.slice(state.listed.indexOf(first_selected(state)), state.listed.indexOf(first_selected(state)) + 2);
  state = await keys(["2", "a"], { what: "2 a to archive both counted rows", until: (current) => counted.every((id) => !in_folder(current, id, "/Inbox")), timeout_ms: 10000 });
  const counted_archived = counted.filter((id) => !in_folder(state, id, "/Inbox"));
  state = await keys(["u"], { what: "one u to bring both counted rows back", until: (current) => counted.every((id) => in_folder(current, id, "/Inbox")), timeout_ms: 10000 });
  check(app, kind, "2 a archives the current row and the one below, and one u brings both back", counted.length === 2 && counted_archived.length === 2 && counted.every((id) => in_folder(state, id, "/Inbox")), `rows ${counted.join(" ")}, archived ${counted_archived.join(" ")}, back ${counted.filter((id) => in_folder(state, id, "/Inbox")).join(" ")}`);
  await keys(["g", "e"]);
  await keys(["g", "g"], at_top);
  victim = first_selected(await keys(["j"], at_second));
  state = await keys(["d", "d"], holds("d d", "/Trash", victim, true));
  state = await undo_typed(victim);
  check(app, kind, ":undo after d d moves the message back too", in_folder(state, victim, "/Inbox"), `${victim} in the Inbox after :undo ${in_folder(state, victim, "/Inbox")}`);
  const inbox_before = messages_in_inbox(state);
  // One stack serves the piece, so the next u steps back to an older entry: the archive that the setup made.
  state = await keys(["u"], { what: "the next u to undo the older a archive", until: (current) => messages_in_inbox(current) === inbox_before + 1, timeout_ms: 10000, show: (current) => `Inbox ${messages_in_inbox(current)}` });
  check(app, kind, "the next u undoes the older a archive, one message back in the Inbox", messages_in_inbox(state) === inbox_before + 1, `Inbox ${inbox_before} then ${messages_in_inbox(state)}`);
  // Empty the stack: it holds at most 20 entries, and a step whose message is gone takes a second u to drop. Most of these u change nothing, so no state shows each one land. The barrier proves the last u reached the key runtime. It does not prove the background has drained the queue: undo_newest runs the steps one after another, with retries. So the folder counts must then hold for a quiet period.
  for (let press = 0; press < 42; press++) {
    await instance.press(["u"]);
    await sleep(100);
  }
  await barrier(instance);
  await wait_for_quiet_counts();
  await keys(["g", "e"]);
  await keys(["g", "g"], at_top);
  victim = first_selected(await keys(["j"], at_second));
  await instance.press(["-k", "Delete"]);
  state = await wait_state(instance, `the native Delete to remove ${victim} from the Inbox`, (current) => !in_folder(current, victim, "/Inbox"), { timeout_ms: 10000 });
  const deleted = !in_folder(state, victim, "/Inbox");
  const inbox_after_delete = messages_in_inbox(state);
  await instance.press(["u"]);
  await expect_absent(instance, "with the stack empty, u leaves a native Delete to Thunderbird and changes no mail", (current) => (deleted && !in_folder(current, victim, "/Inbox") && messages_in_inbox(current) === inbox_after_delete ? null : `${victim} out of the Inbox after Delete ${deleted}, in the Inbox after u ${in_folder(current, victim, "/Inbox")}, Inbox ${inbox_after_delete} then ${messages_in_inbox(current)}`), { margin_ms: 4000, in_list: true });
}

export const piece = section_piece({ section: "panes_undo", only: ["panes"], run: run_panes_undo });
