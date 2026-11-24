import { FLAT_ROWS, COLLAPSED_ROWS } from "../fixture_rows.mjs";
import { sleep, CTRL_SHIFT, first_selected, same, selects, flag_becomes, compose_opens } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["motions", "mail_keys", "compose", "panes"];

// The key checks of the Inbox: motions, the keys that must do nothing, the context menu, the quick filter, a restart, archive and delete, the reading pane focus, C-l, the message state keys and the compose keys.
// Row bookkeeping (`gone`, `live_rows`, `row_of`) lives inside this one piece, so no piece reads another's.
async function run_keys(instance, ctx, start) {
  const { check, note, open_inbox, wait_state, barrier, expect_absent, key_and_state, restart, close_compose, wait_for_clipboard, shot } = ctx;
  const app = instance.app;
  const kind = "default";

  // gg to the top. If the list has no selection yet, this also proves the first key after the Tab focus change works.
  let state;
  const rows = COLLAPSED_ROWS;
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], selects(rows[0]));
  check(app, kind, "g g selects the first row", first_selected(state) === FLAT_ROWS[0], `selected ${JSON.stringify(state.selected.map((m) => m.header_id))}`);
  note(app, kind, "selection of a collapsed or flat thread root", `${state.selected.length} message(s) selected at row 0, listed ${state.listed.length} messages`);
  state = await key_and_state(instance, ["j"], selects(rows[1]));
  const after_j = first_selected(state);
  const collapsed = after_j === COLLAPSED_ROWS[1];
  // The Inbox opens with its threads collapsed, so the row list stays the collapsed one even when j failed.
  check(app, kind, "j moves exactly one row and skips collapsed children", collapsed, `after j: ${after_j}, expected ${COLLAPSED_ROWS[1]}`);
  check(app, kind, "keys API answers (j moved the selection)", after_j !== null && after_j !== FLAT_ROWS[0]);
  state = await key_and_state(instance, ["k"], selects(rows[0]));
  check(app, kind, "k moves back one row", first_selected(state) === rows[0], `selected ${first_selected(state)}`);
  state = await key_and_state(instance, ["G"], selects(rows.at(-1)));
  check(app, kind, "G selects the last row", first_selected(state) === rows.at(-1), `selected ${first_selected(state)}`);
  await shot("after_G", "Inbox scrolled to the last row, last message selected");
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], selects(rows[0]));
  check(app, kind, "g g returns to the first row", first_selected(state) === rows[0], `selected ${first_selected(state)}`);
  await instance.press(["j"]);
  state = await key_and_state(instance, ["."], selects(rows[2]));
  check(app, kind, ". repeats the last motion", first_selected(state) === rows[2], `selected ${first_selected(state)}, expected ${rows[2]}`);
  await instance.press(["g"]);
  await instance.press(["g"]);
  await instance.press(["5"]);
  state = await key_and_state(instance, ["j"], selects(rows[5]));
  check(app, kind, "5j moves five rows", first_selected(state) === rows[5], `selected ${first_selected(state)}, expected ${rows[5]}`);
  await expect_absent(instance, "no message is junk after the motions", (now) => (Object.values(now.flags).some((flags) => flags.junk) ? "a message is junk" : null), { margin_ms: 1500, in_list: true });

  // s, x and 1 must change nothing: same selection, folders and flags. The m key leads the message state keys now, so a lone m followed by a break key stands in for it: the stray m is dropped. x is unbound in every default tree (a archives, so it cannot stand here).
  const before = await instance.ask("state");
  for (const key of ["s", "m", "x", "1"]) await instance.press([key]);
  // The barrier's Escape ends the count 1, so its w m runs once.
  await expect_absent(instance, "s, m x and 1 do nothing", (after) => (same(before.selected, after.selected) && same(before.folders, after.folders) && same(before.flags, after.flags) && same(before.windows, after.windows) ? null : "the selection, folders, flags or windows changed"), { margin_ms: 1200, in_list: true });

  // With the thread list's context menu open (Shift+F10), keys belong to the menu: j and k move its selection and the list stays where it is. (k was the access key of Mark once, and now moves the menu up.)
  const before_menu = first_selected(await instance.ask("state"));
  await instance.press(["-M", "shift", "-k", "F10", "-m", "shift"]);
  // The open menu is chrome and has no helper state, so this wait stays fixed.
  await sleep(1000);
  // The open menu swallows the barrier's w and m, and its Escape would close the menu, so these waits stay fixed.
  state = await key_and_state(instance, ["j"], 700);
  const after_menu_j = first_selected(state);
  state = await key_and_state(instance, ["k"], 700);
  await shot("menu_keys", "thread context menu open after j and k moved its selection");
  check(app, kind, "with the context menu open, j and k act on the menu, not the list", after_menu_j === before_menu && first_selected(state) === before_menu, `selected ${before_menu}, after j ${after_menu_j}, after k ${first_selected(state)}`);
  await instance.press(["-k", "Escape"]);
  await instance.press(["-k", "Escape"]);
  await barrier(instance);
  state = await key_and_state(instance, ["j"], selects(rows[rows.indexOf(before_menu) + 1]));
  check(app, kind, "after the menu closes, j moves the list again", first_selected(state) === rows[rows.indexOf(before_menu) + 1], `selected ${first_selected(state)}`);

  // Typing in the quick filter passes through.
  await instance.press(CTRL_SHIFT("k"));
  // Focus in the quick filter has no helper state, and the barrier's keys would type into it, so this wait stays fixed.
  await sleep(800);
  const filtered = await key_and_state(instance, ["Single 1"], { what: "the quick filter to narrow the list", until: (now) => now.listed.length > 0 && now.listed.length < start.listed.length });
  check(app, kind, "typing in the quick filter passes through", filtered.listed.length > 0 && filtered.listed.length < start.listed.length, `listed ${filtered.listed.length} of ${start.listed.length} after typing "Single 1"`);
  await shot("quick_filter", "quick filter holds the typed text and the list is narrowed");
  await key_and_state(instance, ["a"], { what: "the quick filter to take the a and list nothing", until: (now) => now.listed.length === 0 });
  // The list empties before an archive could land, so the check keeps its fixed margin after that.
  await expect_absent(instance, "a typed into the quick filter archives nothing", (now) => (same(now.folders["/Inbox"], before.folders["/Inbox"]) && now.listed.length === 0 ? null : `listed ${now.listed.length}, Inbox ${now.folders["/Inbox"]?.length}`), { margin_ms: 1500, in_list: false });
  // Escape clears the filter text, and Escape in an empty filter returns focus to the thread list (measured on both apps).
  await instance.press(["-k", "Escape"]);
  const cleared = await wait_state(instance, "Escape to clear the quick filter", (now) => now.listed.length === start.listed.length, { soft: true });
  note(app, kind, "quick filter after Escape", `listed ${cleared.listed.length}`);
  await instance.press(["-k", "Escape"]);
  await barrier(instance);

  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], { what: "g g to reach the top with the full list", until: (now) => first_selected(now) === rows[0] && now.listed.length === start.listed.length });
  check(app, kind, "after the quick filter, focus is back in the list and g g reaches the top", first_selected(state) === rows[0] && state.listed.length === start.listed.length, `selected ${first_selected(state)}, listed ${state.listed.length}`);
  await shot("after_filter_cleared", "Inbox after the quick filter was cleared");

  // management.setEnabled is refused for an add-on in the profile folder, so the only real restart of DesertBird is a restart of the app.
  await restart(instance, app, kind, "reload");
  check(app, kind, "after the restart, the Inbox opens with keys", (await open_inbox(instance, { expanded: true })) === "/Inbox");
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], selects(rows[0]));
  const top_after_restart = first_selected(state);
  state = await key_and_state(instance, ["j"], selects(rows[1]));
  check(app, kind, "after the restart, g g reaches the top and one j moves exactly one row", top_after_restart === rows[0] && first_selected(state) === rows[1], `top ${top_after_restart}, after j ${first_selected(state)}, expected ${rows[1]}`);

  // a and d d at two places: the middle of the list and the last row. The note says which row Thunderbird leaves selected.
  const gone = new Set();
  const live_rows = () => rows.filter((id) => !gone.has(id));
  const row_of = (id) => (id === null || id === undefined ? "none" : live_rows().indexOf(id));
  // `row` counts from the first live row. The selection is awaited by the id that row holds, so `gone` has to list every message that left the Inbox before the call.
  const go_to_row = async (row) => {
    await instance.press(["g"]);
    await instance.press(["g"]);
    for (const digit of String(row)) await instance.press([digit]);
    return key_and_state(instance, ["j"], selects(live_rows()[row]));
  };
  const homes_in = (state, id) => Object.entries(state.folders).filter(([, ids]) => ids.includes(id)).map(([path]) => path);
  for (const where of ["middle", "last"]) {
    for (const command of ["a", "dd"]) {
      state = where === "middle" ? await go_to_row(12) : await key_and_state(instance, ["G"], selects(live_rows().at(-1)));
      const target = first_selected(state);
      const target_row = row_of(target);
      const rows_total = live_rows().length;
      // The selection check below reads the same state, so the wait also needs the selection to have left the removed row.
      const removed_to = (home_is) => ({ what: `${command} to move ${target} and the selection to leave it`, until: (now) => home_is(homes_in(now, target)) && now.selected.length > 0 && first_selected(now) !== target, timeout_ms: 8000 });
      if (command === "a") state = await key_and_state(instance, ["a"], removed_to((homes) => homes.length === 1 && /Archive/i.test(homes[0])));
      else {
        await instance.press(["d"]);
        state = await key_and_state(instance, ["d"], removed_to((homes) => same(homes, ["/Trash"])));
      }
      const homes = Object.entries(state.folders).filter(([, ids]) => ids.includes(target)).map(([path]) => path);
      const done = command === "a" ? homes.length === 1 && /Archive/i.test(homes[0]) : same(homes, ["/Trash"]);
      check(app, kind, `${command === "a" ? "a archives" : "d d trashes"} the ${where} row's message`, done, `${target} is in ${JSON.stringify(homes)}`);
      if (done) gone.add(target);
      const after = state.selected.map((m) => m.header_id);
      // DesertBird does not reselect. Thunderbird keeps a row selected: the next message, or the previous one at the end of the list.
      const expected_next = live_rows()[Math.min(target_row, live_rows().length - 1)];
      check(app, kind, `Thunderbird keeps a row selected after ${command} on the ${where} row`, done && after.length > 0 && after[0] === expected_next, `removed row ${target_row} of ${rows_total}; now selected ${JSON.stringify(after)} at row ${row_of(after[0])} of ${live_rows().length}, expected ${expected_next}`);
      await shot(`after_${command}_${where}`, `list after ${command} on the ${where} row, see the selection note`);
      if (!done) {
        // The key failed, so measure what Thunderbird itself leaves selected after an API call on the same message.
        await instance.ask(command === "a" ? "api_archive" : "api_delete");
        state = await wait_state(instance, `the API ${command === "a" ? "archive" : "delete"} to move ${target}`, (now) => !now.folders["/Inbox"].includes(target) && first_selected(now) !== target, { timeout_ms: 8000, soft: true });
        gone.add(target);
        note(app, kind, `selection after an API ${command === "a" ? "archive" : "delete"} on the ${where} row, no key`, `now selected ${JSON.stringify(state.selected.map((m) => m.header_id))} at row ${row_of(state.selected[0]?.header_id)}`);
      }
    }
  }
  check(app, kind, "a and d d ran four times without a refusal", gone.size === 4 && !instance.app_log().includes("unexpected error"), "a refused key leaves the message in place");

  // a and j in one wtype call reach the app back to back. j moves the selection before the background acts, and a must still archive the row it was pressed on.
  state = await go_to_row(12);
  const race_target = first_selected(state);
  const race_next = live_rows()[row_of(race_target) + 1];
  const homes_of = (id) => homes_in(state, id);
  state = await key_and_state(instance, ["aj"], { what: "a then j to archive the row a was pressed on", until: (now) => { const homes = homes_in(now, race_target); return homes.length === 1 && /Archive/i.test(homes[0]); }, timeout_ms: 8000 });
  const race_archived = homes_of(race_target).length === 1 && /Archive/i.test(homes_of(race_target)[0]);
  check(app, kind, "a then j at once archives the row a was pressed on and leaves the next one", race_archived && same(homes_of(race_next), ["/Inbox"]), `${race_target} is in ${JSON.stringify(homes_of(race_target))}, ${race_next} is in ${JSON.stringify(homes_of(race_next))}`);
  if (race_archived) gone.add(race_target);
  await shot("after_a_then_j", "list after a and j typed back to back");

  const probe = await instance.ask("probe_plain_text");
  check(app, kind, "messengerUtilities.convertToPlainText decodes entities, drops the title and separates cells", probe.converted === "It's \u00e9\nA\tB", JSON.stringify(probe));
  // Yank: the background page writes the clipboard on a key, with no user activation of its own. The helper reads it back.
  await instance.press(["G"]);
  state = await key_and_state(instance, ["k"], selects(live_rows().at(-2)));
  const yank_row = first_selected(state);
  const yank_id = yank_row.replace("@fixture.invalid", "");
  const yank_expected = {
    y: `Body of ${yank_id}.\nSecond line of ${yank_id}.`,
    s: state.selected[0].subject,
    f: `Fixture Sender <${state.selected[0].subject.toLowerCase().replace(" ", "")}@fixture.invalid>`,
    a: `${state.selected[0].subject.toLowerCase().replace(" ", "")}@fixture.invalid`,
    i: yank_row,
  };
  for (const [key, expected] of Object.entries(yank_expected)) {
    await instance.ask("clear_clipboard");
    await instance.press(["y"]);
    await instance.press([key]);
    const text = await wait_for_clipboard(instance, `y ${key} to write the clipboard`);
    check(app, kind, `y ${key} writes the clipboard`, text.replace(/\r\n/g, "\n").trim() === expected.trim(), `clipboard ${JSON.stringify(text)}, expected ${JSON.stringify(expected)}`);
  }

  // A collapsed thread root selects the whole thread. The first selected message decides, so yank still copies one body.
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], { what: "g g to select the first root with its thread displayed", until: (now) => first_selected(now) === rows[0] && now.displayed.length > 1 });
  await instance.ask("clear_clipboard");
  await instance.press(["y"]);
  await instance.press(["y"]);
  const root_text = await wait_for_clipboard(instance, "y y to write the clipboard");
  const root_id = first_selected(state).replace("@fixture.invalid", "");
  check(app, kind, "y y on a collapsed thread root copies the body of the first selected message", state.displayed.length > 1 && root_text.replace(/\r\n/g, "\n").trim() === `Body of ${root_id}.\nSecond line of ${root_id}.`, `displayed ${state.displayed.length}, selected ${first_selected(state)}, clipboard ${JSON.stringify(root_text)}`);

  // r on a collapsed thread root.
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], { what: "g g to select the first root with its thread displayed", until: (now) => first_selected(now) === rows[0] && now.displayed.length > 1 });
  const root_displayed = state.displayed;
  state = await key_and_state(instance, ["r"], compose_opens((tab) => (tab.body ?? "").includes("Body of")));
  // A collapsed root displays the whole thread. r replies to its newest message. Thunderbird keeps a single "Re: " on the subject.
  const newest = [...root_displayed].sort((left, right) => right.date - left.date)[0];
  const root_compose = state.windows.find((window) => window.type === "messageCompose");
  const root_tab = root_compose?.tabs.find((tab) => tab.subject);
  const expected_subject = `Re: ${newest?.subject.replace(/^Re: /, "")}`;
  const quotes_newest = newest !== undefined && (root_tab?.body ?? "").includes(`Body of ${newest.header_id.replace("@fixture.invalid", "")}.`);
  check(app, kind, "r on a collapsed thread root replies to the newest message of the thread", state.windows.filter((window) => window.type === "messageCompose").length === 1 && root_tab?.subject === expected_subject && quotes_newest, `displayed ${root_displayed.length}, newest ${newest?.header_id}, compose subject ${JSON.stringify(root_tab?.subject)}, expected ${JSON.stringify(expected_subject)}, quotes the newest: ${quotes_newest}`);
  await shot("after_r_root", "compose window replying to the newest message of the collapsed thread");
  await close_compose(instance);

  // r opens a reply.
  state = await key_and_state(instance, ["G"], selects(live_rows().at(-1)));
  const reply_to = first_selected(state);
  const reply_subject = state.selected[0]?.subject;
  state = await key_and_state(instance, ["r"], compose_opens((tab) => Boolean(tab.subject)));
  const compose = state.windows.find((window) => window.type === "messageCompose");
  const subject = compose?.tabs.map((tab) => tab.subject).find(Boolean);
  check(app, kind, "r opens Re: <subject>", compose !== undefined && subject === `Re: ${reply_subject}`, `replied to ${reply_to}, compose subject ${JSON.stringify(subject)}`);
  await shot("after_r", "a compose window with the reply, or the mail window if none opened");
  state = await close_compose(instance);
  check(app, kind, "the app survived the reply", instance.exited() === null && !state.windows.some((window) => window.type === "messageCompose"));

  // Reading pane: with a message shown, one F6 from the thread list puts focus in the message body (measured on both apps through the focus chain).
  // Plain printable keys are swallowed there, so j neither runs a motion nor reaches Thunderbird's junk shortcut.
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], selects(rows[0]));
  const pane_list_focus = first_selected(state) === rows[0];
  // Up one from the last row, so a j that runs as a motion shows as a move to the last row.
  await instance.press(["G"]);
  state = await key_and_state(instance, ["k"], selects(live_rows().at(-2)));
  const pane_message = first_selected(state);
  check(app, kind, "the list has focus and a message shows before the reading pane check", pane_list_focus && pane_message === live_rows().at(-2), `g g reached the top: ${pane_list_focus}, selected ${pane_message}`);
  await instance.press(["-k", "F6"]);
  // The focus in the message body has no helper state, and the body takes no barrier keys, so the waits here stay fixed.
  await sleep(500);
  await shot("reading_pane_focus", "message body has focus after one F6 from the list");
  const junk_before = Object.values((await instance.ask("state")).flags).filter((flags) => flags.junk).length;
  await instance.press(["j"]);
  await expect_absent(instance, "j with focus in the message body neither junks nor moves the selection", (now) => {
    const junk_after = Object.values(now.flags).filter((flags) => flags.junk).length;
    return junk_after === junk_before && first_selected(now) === pane_message ? null : `message ${pane_message}, selected after ${first_selected(now)}, junk flags ${junk_before} then ${junk_after}`;
  }, { margin_ms: 2500, in_list: false });
  await shot("after_reading_pane_j", "state after j with focus in the message body");
  // Shift+F6 goes back one pane. j then moves one row, which proves the j above ran one pane after the list, in the message body.
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  await sleep(500);
  state = await key_and_state(instance, ["j"], selects(live_rows().at(-1)));
  check(app, kind, "Shift+F6 from the body returns to the list, where j moves one row", first_selected(state) === live_rows().at(-1), `selected ${first_selected(state)}, expected ${live_rows().at(-1)}`);

  // <C-l> on a collapsed thread root (several messages) refuses and opens no tab. On one message it opens a tab.
  const tab_count = (current) => current.windows.filter((window) => window.type === "normal").flatMap((window) => window.tabs).length;
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], { what: "g g to select the first root with its thread displayed", until: (now) => first_selected(now) === rows[0] && now.displayed.length > 1 });
  const tabs_before = tab_count(state);
  const log_offset = instance.app_log().length;
  await instance.press(["-k", "Control_L"]);
  await instance.press(["-M", "ctrl", "l", "-m", "ctrl"]);
  // A tab that C-l opened late would also pass the wait of the next C-l check, so this one keeps its fixed margin.
  await expect_absent(instance, "C-l on a collapsed thread root opens no tab", (now) => (now.displayed.length > 1 && tab_count(now) === tabs_before ? null : `displayed ${now.displayed.length}, tabs ${tabs_before} then ${tab_count(now)}`), { margin_ms: 1500, in_list: true });
  note(app, kind, "C-l refusal", `libnotify warning in the log after the key: ${/libnotify/.test(instance.app_log().slice(log_offset))}`);
  await key_and_state(instance, ["G"], { what: "G to leave the first row", until: (now) => first_selected(now) !== rows[0] && first_selected(now) !== null });
  await instance.press(["-k", "Control_L"]);
  await instance.press(["-M", "ctrl", "l", "-m", "ctrl"]);
  state = await wait_state(instance, "C-l to open the message in a tab", (now) => tab_count(now) === tabs_before + 1);
  check(app, kind, "C-l on one message opens it in a tab", tab_count(state) === tabs_before + 1, `tabs ${tabs_before} then ${tab_count(state)}`);
  // The new tab draws after it counts, and a message tab takes no barrier keys, so this pause before the screenshot stays fixed.
  await sleep(1000);
  await shot("after_ctrl_l", "a message tab after C-l");
  // Close the message tab again, so the view checks that follow act on the mail tab.
  await instance.press(["-k", "Control_L"]);
  await instance.press(["-M", "ctrl", "w", "-m", "ctrl"]);
  state = await wait_state(instance, "Ctrl+W to close the message tab", (now) => tab_count(now) === tabs_before);
  check(app, kind, "Ctrl+W closes the message tab again", tab_count(state) === tabs_before, `tabs ${tabs_before} then ${tab_count(state)}`);
  // Message state keys. Each key acts on the ids selected when it was pressed; flags are read back through the helper.
  const flag_of = (state, id, name) => state.flags[id]?.[name];
  state = await go_to_row(3);
  const flag_target = first_selected(state);
  const flagged_before = flag_of(state, flag_target, "flagged") === true;
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], flag_becomes(flag_target, "flagged", !flagged_before));
  check(app, kind, "m s flips the star of the selected message", flag_of(state, flag_target, "flagged") === !flagged_before, `${flag_target} flagged ${flagged_before} -> ${flag_of(state, flag_target, "flagged")}`);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], flag_becomes(flag_target, "flagged", flagged_before));
  check(app, kind, "m s again flips it back", flag_of(state, flag_target, "flagged") === flagged_before, `flagged ${flag_of(state, flag_target, "flagged")}`);

  await instance.press(["m"]);
  state = await key_and_state(instance, ["u"], flag_becomes(flag_target, "read", false));
  check(app, kind, "m u marks the selected message unread", flag_of(state, flag_target, "read") === false, `read ${flag_of(state, flag_target, "read")}`);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["r"], flag_becomes(flag_target, "read", true));
  check(app, kind, "m r marks the selected message read", flag_of(state, flag_target, "read") === true, `read ${flag_of(state, flag_target, "read")}`);

  await instance.press(["m"]);
  state = await key_and_state(instance, ["j"], flag_becomes(flag_target, "junk", true));
  check(app, kind, "m j marks the selected message junk", flag_of(state, flag_target, "junk") === true, `junk ${flag_of(state, flag_target, "junk")}`);
  const junk_home = Object.entries(state.folders).filter(([, ids]) => ids.includes(flag_target)).map(([path]) => path);
  note(app, kind, "where the message is after m j", JSON.stringify(junk_home));
  await instance.press(["m"]);
  state = await key_and_state(instance, ["j"], flag_becomes(flag_target, "junk", false));
  check(app, kind, "m j again clears junk", flag_of(state, flag_target, "junk") === false, `junk ${flag_of(state, flag_target, "junk")}`);

  // A collapsed thread root selects the whole thread, so one key must reach every message of it.
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"], { what: "g g to select the first root with its thread", until: (now) => first_selected(now) === rows[0] && now.selected.length > 1 });
  const thread_ids = state.selected.map((message) => message.header_id);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], { what: "m s to flag every message of the thread", until: (now) => thread_ids.every((id) => flag_of(now, id, "flagged") === true) });
  const flagged_ids = thread_ids.filter((id) => flag_of(state, id, "flagged") === true);
  note(app, kind, "ids selected on a collapsed thread root", `${thread_ids.length}`);
  check(app, kind, "m s on a collapsed thread root flags every selected message", thread_ids.length > 0 && flagged_ids.length === thread_ids.length, `${flagged_ids.length} of ${thread_ids.length} flagged`);
  await instance.press(["m"]);
  await key_and_state(instance, ["s"], { what: "m s to unflag the thread again", until: (now) => thread_ids.every((id) => flag_of(now, id, "flagged") === false), soft: true });

  // m R marks the whole displayed folder read. First make one message unread.
  state = await go_to_row(5);
  const unread_target = first_selected(state);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["u"], flag_becomes(unread_target, "read", false));
  const was_unread = flag_of(state, unread_target, "read") === false;
  await instance.press(["m"]);
  await instance.press(["R"]);
  state = await wait_state(instance, "m R to mark the Inbox read", (now) => now.folders["/Inbox"].every((id) => flag_of(now, id, "read") !== false), { timeout_ms: 8000 });
  const still_unread = Object.entries(state.flags).filter(([id]) => state.folders["/Inbox"].includes(id) && flag_of(state, id, "read") === false);
  check(app, kind, "m R marks every message of the shown folder read", was_unread && still_unread.length === 0, `an unread message existed: ${was_unread}, unread left in Inbox: ${still_unread.length}`);
  await shot("after_m_R", "Inbox with no unread count after m R");

  // m z <preset> snoozes the selected message into a Snoozed folder of its account. The wake needs a clock run of minutes to hours, so it is a hand check.
  state = await go_to_row(9);
  const snooze_target = first_selected(state);
  const homes_after_snooze = (state, id) => Object.entries(state.folders).filter(([, ids]) => ids.includes(id)).map(([path]) => path);
  await instance.press(["m"]);
  await instance.press(["z"]);
  state = await key_and_state(instance, ["t"], { what: "m z t to move the message to /Snoozed", until: (now) => same(homes_after_snooze(now, snooze_target), ["/Snoozed"]), timeout_ms: 8000 });
  check(app, kind, "m z t moves the selected message to a Snoozed folder and out of the Inbox", same(homes_after_snooze(state, snooze_target), ["/Snoozed"]), `${snooze_target} is in ${JSON.stringify(homes_after_snooze(state, snooze_target))}`);
  const snoozed_before = state.folders["/Snoozed"]?.length ?? 0;
  // The first target has left the Inbox, so the second go_to_row counts rows without it.
  if (same(homes_after_snooze(state, snooze_target), ["/Snoozed"])) gone.add(snooze_target);
  state = await go_to_row(9);
  const second_snooze_target = first_selected(state);
  await instance.press(["m"]);
  await instance.press(["z"]);
  state = await key_and_state(instance, ["m"], { what: "m z m to move the second message to /Snoozed", until: (now) => same(homes_after_snooze(now, second_snooze_target), ["/Snoozed"]) && (now.folders["/Snoozed"]?.length ?? 0) === snoozed_before + 1, timeout_ms: 8000 });
  check(app, kind, "a second snooze reuses the Snoozed folder", same(homes_after_snooze(state, second_snooze_target), ["/Snoozed"]) && (state.folders["/Snoozed"]?.length ?? 0) === snoozed_before + 1, `${second_snooze_target} is in ${JSON.stringify(homes_after_snooze(state, second_snooze_target))}, Snoozed holds ${state.folders["/Snoozed"]?.length ?? 0}`);
  gone.add(snooze_target);
  gone.add(second_snooze_target);
  await shot("after_snooze", "Inbox after two snoozes; the Snoozed folder holds both messages");

  // Compose keys. R replies to all, g F forwards, c writes a new message.
  const compose_of = (state) => state.windows.find((window) => window.type === "messageCompose");
  const compose_subject = (state) => compose_of(state)?.tabs.map((tab) => tab.subject).find((subject) => subject !== null && subject !== undefined);
  state = await go_to_row(8);
  const compose_source = state.selected[0];
  state = await key_and_state(instance, ["R"], compose_opens((tab) => Boolean(tab.subject)));
  check(app, kind, "R opens Re: <subject> as a reply to all", compose_subject(state) === `Re: ${compose_source?.subject}`, `compose subject ${JSON.stringify(compose_subject(state))}`);
  await shot("after_R", "compose window replying to all");
  await close_compose(instance);
  await instance.press(["g"]);
  state = await key_and_state(instance, ["F"], compose_opens((tab) => Boolean(tab.subject)));
  check(app, kind, "g F opens Fwd: <subject>", compose_subject(state) === `Fwd: ${compose_source?.subject}`, `compose subject ${JSON.stringify(compose_subject(state))}`);
  await shot("after_gF", "compose window forwarding the selected message");
  await close_compose(instance);
  state = await key_and_state(instance, ["c"], compose_opens(() => true));
  check(app, kind, "c opens an empty new message", compose_of(state) !== undefined && !compose_subject(state), `compose windows ${state.windows.filter((window) => window.type === "messageCompose").length}, subject ${JSON.stringify(compose_subject(state))}`);
  await shot("after_c", "empty compose window");
  state = await close_compose(instance);
  check(app, kind, "the app survived the compose keys", instance.exited() === null && !state.windows.some((window) => window.type === "messageCompose"));
}

export const piece = section_piece({ section: "keys", only: ["keys"], run: run_keys });
