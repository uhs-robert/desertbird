// The launch-time check of the command line.

import { sleep, selects, QUIET_AFTER_ESCAPE_MS } from "../predicates.mjs";
import { section_piece, ensure_views_folder } from "./_default_shared.mjs";

// Issue 97: the overlay mount focuses its browser before its page loads, and keys typed right after the colon used to reach Thunderbird's shortcuts. The old check ran with no message selected, so j and a had nothing to move or archive.
async function run_cmdline_launch(instance, ctx) {
  const { app, kind, shot, check, wait_state, wait_for_state, open_command_line, press_in_command_line, close_command_line } = ctx;
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  await ensure_views_folder(instance, ctx);
  await instance.ask("select:views-0@fixture.invalid", 30000);
  const before = await wait_for_state(instance, selects("views-0@fixture.invalid"));
  check(app, kind, "a message is selected before the colon", selection_of(before) === "views-0@fixture.invalid", `selected ${selection_of(before)}`);
  await open_command_line(instance, [":", "j", "a"]);
  // The keys typed before the line was ready are dropped, so nothing shows that they are not still on their way. The margin gives a stray one time to act.
  await sleep(QUIET_AFTER_ESCAPE_MS);
  await shot("cmdline_launch", "the command line right after : j a typed with no pause and a message selected: the line is open and empty");
  const after = await instance.ask("state");
  check(app, kind, "with a message selected, : then j a typed with no pause moves nothing and archives nothing", selection_of(after) === selection_of(before) && JSON.stringify(after.folders) === JSON.stringify(before.folders), `selected ${selection_of(before)} then ${selection_of(after)}, mail changed: ${JSON.stringify(after.folders) !== JSON.stringify(before.folders)}`);
  // The check above shows the keys typed before ready were dropped, not replayed into the line. The line takes keys now: a typed command runs, which only the line can do.
  const order = before.mail_tab?.sort_order === "ascending" ? "descending" : "ascending";
  await press_in_command_line(instance, [`sort --date --${order}`]);
  await instance.press(["-k", "Return"]);
  const sorted = await wait_state(instance, `sort --date --${order} to run`, (state) => state.mail_tab?.sort_type === "date" && state.mail_tab?.sort_order === order, { show: (state) => `sort ${state.mail_tab?.sort_type} ${state.mail_tab?.sort_order}` });
  check(app, kind, "once the line is ready, a typed command reaches it and runs", sorted.mail_tab?.sort_type === "date" && sorted.mail_tab?.sort_order === order, `sort ${sorted.mail_tab?.sort_type} ${sorted.mail_tab?.sort_order}, wanted date ${order}`);
  await close_command_line(instance);
}

export const piece = section_piece({ section: "cmdline_launch", only: ["cmdline_launch"], run: run_cmdline_launch });
