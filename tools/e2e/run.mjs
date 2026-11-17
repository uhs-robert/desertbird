// End-to-end run in a headless labwc session:
//   node tools/e2e/run.mjs [thunderbird|betterbird]... [--xpi path] [--binary app=path]
// With no --xpi it only proves the setup: each app starts in a fresh profile and one screenshot is taken.
// Scratch files go to $E2E_DIR (default /tmp/desertbird-e2e). Thunderbird comes from tools/measure/fetch_thunderbird.sh. Betterbird is /usr/bin/betterbird.
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { start_app } from "./harness.mjs";

const e2e_dir = resolve(process.env.E2E_DIR ?? "/tmp/desertbird-e2e");
const measure_dir = resolve(process.env.MEASURE_DIR ?? "/tmp/desertbird-measure");
const binaries = {
  thunderbird: join(measure_dir, "thunderbird-153.7.0esr", "thunderbird", "thunderbird"),
  betterbird: "/usr/bin/betterbird",
};

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const [, value] = args.splice(at, 2);
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
};
const xpi_path = option("--xpi");
for (let value; (value = option("--binary")); ) { const [name, path] = value.split("="); binaries[name] = path; }
const apps = args.length ? args : ["thunderbird", "betterbird"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CTRL_SHIFT = (key) => ["-M", "ctrl", "-M", "shift", key, "-m", "shift", "-m", "ctrl"];
const header_id = (index) => (index.kind === "thread" ? `inbox-t${index.n}-m0` : `inbox-s${index.n}`) + "@fixture.invalid";

// Row order of the fixture Inbox, sorted by date ascending. Collapsed threads show only their root (m0).
const FLAT_ROWS = [
  ...Array.from({ length: 10 }, (_, thread) => Array.from({ length: 4 }, (_, position) => `inbox-t${thread}-m${position}@fixture.invalid`)).flat(),
  ...Array.from({ length: 20 }, (_, single) => `inbox-s${single}@fixture.invalid`),
];
const COLLAPSED_ROWS = [...Array.from({ length: 10 }, (_, thread) => header_id({ kind: "thread", n: thread })), ...Array.from({ length: 20 }, (_, single) => header_id({ kind: "single", n: single }))];

// Evidence for the report: one line per check, plus the shots and any free-form observations.
const report = { checks: [], shots: [], notes: [] };
function check(app, kind, name, ok, detail = "") {
  report.checks.push({ app, kind, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${app}/${kind} ${name}${detail ? ` -- ${detail}` : ""}`);
  return ok;
}
function note(app, kind, name, detail) {
  report.notes.push({ app, kind, name, detail });
  console.log(`NOTE ${app}/${kind} ${name} -- ${detail}`);
}

// Opens the Inbox with keys only. `folder_row_tabs` Tabs (seven) reach the Local Folders row, Right expands it, Down selects the Inbox and F6 moves focus to the thread list.
// With no identity the New Message button is disabled and skipped by Tab, so the folder row is one Tab sooner.
// F6 cycles the panes: folder pane, thread list, message body (when a message shows), spaces toolbar, global search. Measured on both apps through the focus chain.
// Counted Tabs from the folder pane are not used: on Betterbird three Tabs end on a column header.
async function open_inbox(instance, folder_row_tabs = 7) {
  for (let count = 0; count < folder_row_tabs; count++) await instance.press(["-k", "Tab"]);
  await instance.press(["-k", "Right"]);
  await sleep(300);
  await instance.press(["-k", "Down"]);
  await sleep(1500);
  const opened = (await instance.ask("state")).mail_tab?.folder;
  await instance.press(["-k", "F6"]);
  return opened;
}

async function key_and_state(instance, args, wait_ms = 700) {
  await instance.press(args);
  await sleep(wait_ms);
  return instance.ask("state");
}

const first_selected = (state) => state.selected[0]?.header_id ?? null;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function run_default(instance) {
  const app = instance.app;
  const kind = "default";
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };

  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  const start = await instance.ask("state");
  check(app, kind, "helper add-on and DesertBird both enabled", start.desertbird_enabled === true);
  await shot("inbox_opened");

  // gg to the top. If the list has no selection yet, this also proves the first key after the Tab focus change works.
  let state;
  const rows = COLLAPSED_ROWS;
  await instance.press(["g"]);
  state = await key_and_state(instance, ["g"]);
  check(app, kind, "g g selects the first row", first_selected(state) === FLAT_ROWS[0], `selected ${JSON.stringify(state.selected.map((m) => m.header_id))}`);
  note(app, kind, "selection of a collapsed or flat thread root", `${state.selected.length} message(s) selected at row 0, listed ${state.listed.length} messages`);
  state = await key_and_state(instance, ["j"]);
  const after_j = first_selected(state);
  const collapsed = after_j === COLLAPSED_ROWS[1];
  // The Inbox opens with its threads collapsed, so the row list stays the collapsed one even when j failed.
  check(app, kind, "j moves exactly one row and skips collapsed children", collapsed, `after j: ${after_j}, expected ${COLLAPSED_ROWS[1]}`);
  check(app, kind, "keys API answers (j moved the selection)", after_j !== null && after_j !== FLAT_ROWS[0]);
  state = await key_and_state(instance, ["k"]);
  check(app, kind, "k moves back one row", first_selected(state) === rows[0], `selected ${first_selected(state)}`);
  state = await key_and_state(instance, ["G"]);
  check(app, kind, "G selects the last row", first_selected(state) === rows.at(-1), `selected ${first_selected(state)}`);
  await shot("after_G", "Inbox scrolled to the last row, last message selected");
  state = await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  check(app, kind, "g g returns to the first row", first_selected(state) === rows[0], `selected ${first_selected(state)}`);
  await instance.press(["j"]);
  state = await key_and_state(instance, ["."]);
  check(app, kind, ". repeats the last motion", first_selected(state) === rows[2], `selected ${first_selected(state)}, expected ${rows[2]}`);
  await instance.press(["g"]);
  await key_and_state(instance, ["g"]);
  state = await (await instance.press(["5"]), key_and_state(instance, ["j"]));
  check(app, kind, "5j moves five rows", first_selected(state) === rows[5], `selected ${first_selected(state)}, expected ${rows[5]}`);
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "no message is junk after the motions", Object.values(state.flags).every((flags) => !flags.junk));

  // s, a and 1 must change nothing: same selection, folders and flags. The m key leads the message state keys now, so a lone m followed by a break key stands in for it: the stray m is dropped and a is unbound.
  const before = await instance.ask("state");
  for (const key of ["s", "m", "a", "1"]) await instance.press([key]);
  await sleep(1200);
  const after = await instance.ask("state");
  check(app, kind, "s, m a and 1 do nothing", same(before.selected, after.selected) && same(before.folders, after.folders) && same(before.flags, after.flags) && same(before.windows, after.windows), "selection, folders, read, flagged, junk, tags and windows compared");

  // With the thread list's context menu open (Shift+F10), keys belong to the menu: j moves nothing and k is the menu's access key for Mark.
  const before_menu = first_selected(await instance.ask("state"));
  await instance.press(["-M", "shift", "-k", "F10", "-m", "shift"]);
  await sleep(1000);
  state = await key_and_state(instance, ["j"]);
  const after_menu_j = first_selected(state);
  state = await key_and_state(instance, ["k"]);
  await shot("menu_access_key", "thread context menu open with its Mark submenu opened by k");
  check(app, kind, "with the context menu open, j and k act on the menu, not the list", after_menu_j === before_menu && first_selected(state) === before_menu, `selected ${before_menu}, after j ${after_menu_j}, after k ${first_selected(state)}`);
  await instance.press(["-k", "Escape"]);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  state = await key_and_state(instance, ["j"]);
  check(app, kind, "after the menu closes, j moves the list again", first_selected(state) === rows[rows.indexOf(before_menu) + 1], `selected ${first_selected(state)}`);

  // Typing in the quick filter passes through.
  await instance.press(CTRL_SHIFT("k"));
  await sleep(800);
  const filtered = await key_and_state(instance, ["Single 1"], 1500);
  check(app, kind, "typing in the quick filter passes through", filtered.listed.length > 0 && filtered.listed.length < start.listed.length, `listed ${filtered.listed.length} of ${start.listed.length} after typing "Single 1"`);
  await shot("quick_filter", "quick filter holds the typed text and the list is narrowed");
  const bound = await key_and_state(instance, ["x"], 1500);
  check(app, kind, "x typed into the quick filter archives nothing", same(bound.folders["/Inbox"], before.folders["/Inbox"]) && bound.listed.length === 0, `listed ${bound.listed.length}, Inbox ${bound.folders["/Inbox"]?.length}`);
  // Escape clears the filter text, and Escape in an empty filter returns focus to the thread list (measured on both apps).
  await instance.press(["-k", "Escape"]);
  await sleep(1000);
  const cleared = await instance.ask("state");
  note(app, kind, "quick filter after Escape", `listed ${cleared.listed.length}`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);

  await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  check(app, kind, "after the quick filter, focus is back in the list and g g reaches the top", first_selected(state) === rows[0] && state.listed.length === start.listed.length, `selected ${first_selected(state)}, listed ${state.listed.length}`);
  await shot("after_filter_cleared", "Inbox after the quick filter was cleared");

  // runtime.reload(): the helper switches DesertBird off and on, which tears down and restarts the add-on.
  const reload_started = Date.now();
  await instance.ask("reload_desertbird", 30000);
  await sleep(6000);
  note(app, kind, "reload", `off and on took ${Date.now() - reload_started} ms including the wait`);
  state = await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  const top_after_reload = first_selected(state);
  state = await key_and_state(instance, ["j"]);
  check(app, kind, "after reload, g g reaches the top and one j moves exactly one row", top_after_reload === rows[0] && first_selected(state) === rows[1], `top ${top_after_reload}, after j ${first_selected(state)}, expected ${rows[1]}`);

  // x and d d at two places: the middle of the list and the last row. The note says which row Thunderbird leaves selected.
  const gone = new Set();
  const live_rows = () => rows.filter((id) => !gone.has(id));
  const row_of = (id) => (id === null || id === undefined ? "none" : live_rows().indexOf(id));
  const go_to_row = async (row) => {
    await key_and_state(instance, ["g"]);
    await key_and_state(instance, ["g"]);
    for (const digit of String(row)) await instance.press([digit]);
    return key_and_state(instance, ["j"]);
  };
  for (const where of ["middle", "last"]) {
    for (const command of ["x", "dd"]) {
      state = where === "middle" ? await go_to_row(12) : await key_and_state(instance, ["G"]);
      const target = first_selected(state);
      const target_row = row_of(target);
      const rows_total = live_rows().length;
      if (command === "x") state = await key_and_state(instance, ["x"], 2500);
      else {
        await instance.press(["d"]);
        await sleep(150);
        state = await key_and_state(instance, ["d"], 2500);
      }
      const homes = Object.entries(state.folders).filter(([, ids]) => ids.includes(target)).map(([path]) => path);
      const done = command === "x" ? homes.length === 1 && /Archive/i.test(homes[0]) : same(homes, ["/Trash"]);
      check(app, kind, `${command === "x" ? "x archives" : "d d trashes"} the ${where} row's message`, done, `${target} is in ${JSON.stringify(homes)}`);
      if (done) gone.add(target);
      const after = state.selected.map((m) => m.header_id);
      // DesertBird does not reselect. Thunderbird keeps a row selected: the next message, or the previous one at the end of the list.
      const expected_next = live_rows()[Math.min(target_row, live_rows().length - 1)];
      check(app, kind, `Thunderbird keeps a row selected after ${command} on the ${where} row`, done && after.length > 0 && after[0] === expected_next, `removed row ${target_row} of ${rows_total}; now selected ${JSON.stringify(after)} at row ${row_of(after[0])} of ${live_rows().length}, expected ${expected_next}`);
      await shot(`after_${command}_${where}`, `list after ${command} on the ${where} row, see the selection note`);
      if (!done) {
        // The key failed, so measure what Thunderbird itself leaves selected after an API call on the same message.
        await instance.ask(command === "x" ? "api_archive" : "api_delete");
        await sleep(2500);
        state = await instance.ask("state");
        gone.add(target);
        note(app, kind, `selection after an API ${command === "x" ? "archive" : "delete"} on the ${where} row, no key`, `now selected ${JSON.stringify(state.selected.map((m) => m.header_id))} at row ${row_of(state.selected[0]?.header_id)}`);
      }
    }
  }
  check(app, kind, "x and d d ran four times without a refusal", gone.size === 4 && !instance.app_log().includes("unexpected error"), "a refused key leaves the message in place");

  // x and j in one wtype call reach the app back to back. j moves the selection before the background acts, and x must still archive the row it was pressed on.
  state = await go_to_row(12);
  const race_target = first_selected(state);
  const race_next = live_rows()[row_of(race_target) + 1];
  state = await key_and_state(instance, ["xj"], 2500);
  const homes_of = (id) => Object.entries(state.folders).filter(([, ids]) => ids.includes(id)).map(([path]) => path);
  const race_archived = homes_of(race_target).length === 1 && /Archive/i.test(homes_of(race_target)[0]);
  check(app, kind, "x then j at once archives the row x was pressed on and leaves the next one", race_archived && same(homes_of(race_next), ["/Inbox"]), `${race_target} is in ${JSON.stringify(homes_of(race_target))}, ${race_next} is in ${JSON.stringify(homes_of(race_next))}`);
  if (race_archived) gone.add(race_target);
  await shot("after_x_then_j", "list after x and j typed back to back");

  const probe = await instance.ask("probe_plain_text");
  check(app, kind, "messengerUtilities.convertToPlainText decodes entities, drops the title and separates cells", probe.converted === "It's \u00e9\nA\tB", JSON.stringify(probe));
  // Yank: the background page writes the clipboard on a key, with no user activation of its own. The helper reads it back.
  await key_and_state(instance, ["G"]);
  state = await key_and_state(instance, ["k"]);
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
    await sleep(150);
    await instance.press([key]);
    await sleep(1200);
    const text = (await instance.ask("read_clipboard")).text;
    check(app, kind, `y ${key} writes the clipboard`, text.replace(/\r\n/g, "\n").trim() === expected.trim(), `clipboard ${JSON.stringify(text)}, expected ${JSON.stringify(expected)}`);
  }

  // A collapsed thread root selects the whole thread. The first selected message decides, so yank still copies one body.
  await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  await instance.ask("clear_clipboard");
  await instance.press(["y"]);
  await sleep(150);
  await instance.press(["y"]);
  await sleep(1200);
  const root_text = (await instance.ask("read_clipboard")).text;
  const root_id = first_selected(state).replace("@fixture.invalid", "");
  check(app, kind, "y y on a collapsed thread root copies the body of the first selected message", state.displayed.length > 1 && root_text.replace(/\r\n/g, "\n").trim() === `Body of ${root_id}.\nSecond line of ${root_id}.`, `displayed ${state.displayed.length}, selected ${first_selected(state)}, clipboard ${JSON.stringify(root_text)}`);

  // r on a collapsed thread root.
  await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  const root_displayed = state.displayed;
  state = await key_and_state(instance, ["r"], 6000);
  // A collapsed root displays the whole thread. r replies to its newest message. Thunderbird keeps a single "Re: " on the subject.
  const newest = [...root_displayed].sort((left, right) => right.date - left.date)[0];
  const root_compose = state.windows.find((window) => window.type === "messageCompose");
  const root_tab = root_compose?.tabs.find((tab) => tab.subject);
  const expected_subject = `Re: ${newest?.subject.replace(/^Re: /, "")}`;
  const quotes_newest = newest !== undefined && (root_tab?.body ?? "").includes(`Body of ${newest.header_id.replace("@fixture.invalid", "")}.`);
  check(app, kind, "r on a collapsed thread root replies to the newest message of the thread", state.windows.filter((window) => window.type === "messageCompose").length === 1 && root_tab?.subject === expected_subject && quotes_newest, `displayed ${root_displayed.length}, newest ${newest?.header_id}, compose subject ${JSON.stringify(root_tab?.subject)}, expected ${JSON.stringify(expected_subject)}, quotes the newest: ${quotes_newest}`);
  await shot("after_r_root", "compose window replying to the newest message of the collapsed thread");
  await instance.ask("close_compose");
  await sleep(1500);

  // r opens a reply.
  state = await key_and_state(instance, ["G"]);
  const reply_to = first_selected(state);
  const reply_subject = state.selected[0]?.subject;
  state = await key_and_state(instance, ["r"], 6000);
  const compose = state.windows.find((window) => window.type === "messageCompose");
  const subject = compose?.tabs.map((tab) => tab.subject).find(Boolean);
  check(app, kind, "r opens Re: <subject>", compose !== undefined && subject === `Re: ${reply_subject}`, `replied to ${reply_to}, compose subject ${JSON.stringify(subject)}`);
  await shot("after_r", "a compose window with the reply, or the mail window if none opened");
  await instance.ask("close_compose");
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "the app survived the reply", instance.exited() === null && !state.windows.some((window) => window.type === "messageCompose"));

  // Reading pane: with a message shown, one F6 from the thread list puts focus in the message body (measured on both apps through the focus chain).
  // Plain printable keys are swallowed there, so j neither runs a motion nor reaches Thunderbird's junk shortcut.
  await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  const pane_list_focus = first_selected(state) === rows[0];
  // Up one from the last row, so a j that runs as a motion shows as a move to the last row.
  await key_and_state(instance, ["G"]);
  state = await key_and_state(instance, ["k"]);
  const pane_message = first_selected(state);
  check(app, kind, "the list has focus and a message shows before the reading pane check", pane_list_focus && pane_message === live_rows().at(-2), `g g reached the top: ${pane_list_focus}, selected ${pane_message}`);
  await instance.press(["-k", "F6"]);
  await sleep(500);
  await shot("reading_pane_focus", "message body has focus after one F6 from the list");
  const junk_before = Object.values((await instance.ask("state")).flags).filter((flags) => flags.junk).length;
  state = await key_and_state(instance, ["j"], 2500);
  const junked = Object.entries(state.flags).filter(([, flags]) => flags.junk).map(([id]) => id);
  check(app, kind, "j with focus in the message body does nothing (no junk, selection unchanged)", junked.length === junk_before && first_selected(state) === pane_message, `message ${pane_message}, selected after ${first_selected(state)}, junk flags ${junk_before} then ${junked.length}`);
  await shot("after_reading_pane_j", "state after j with focus in the message body");
  // Shift+F6 goes back one pane. j then moves one row, which proves the j above ran one pane after the list, in the message body.
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  await sleep(500);
  state = await key_and_state(instance, ["j"]);
  check(app, kind, "Shift+F6 from the body returns to the list, where j moves one row", first_selected(state) === live_rows().at(-1), `selected ${first_selected(state)}, expected ${live_rows().at(-1)}`);
  await run_tabs(instance, { check, note, shot, key_and_state });

  // <C-l> on a collapsed thread root (several messages) refuses and opens no tab. On one message it opens a tab.
  const tab_count = (current) => current.windows.filter((window) => window.type === "normal").flatMap((window) => window.tabs).length;
  await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  const tabs_before = tab_count(state);
  const log_offset = instance.app_log().length;
  await instance.press(["-k", "Control_L"]);
  await instance.press(["-M", "ctrl", "l", "-m", "ctrl"]);
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "C-l on a collapsed thread root opens no tab", state.displayed.length > 1 && tab_count(state) === tabs_before, `displayed ${state.displayed.length}, tabs ${tabs_before} then ${tab_count(state)}`);
  note(app, kind, "C-l refusal", `libnotify warning in the log after the key: ${/libnotify/.test(instance.app_log().slice(log_offset))}`);
  await key_and_state(instance, ["G"]);
  await instance.press(["-k", "Control_L"]);
  await instance.press(["-M", "ctrl", "l", "-m", "ctrl"]);
  await sleep(2000);
  state = await instance.ask("state");
  check(app, kind, "C-l on one message opens it in a tab", tab_count(state) === tabs_before + 1, `tabs ${tabs_before} then ${tab_count(state)}`);
  await shot("after_ctrl_l", "a message tab after C-l");
  // Close the message tab again, so the view checks that follow act on the mail tab.
  await instance.press(["-k", "Control_L"]);
  await instance.press(["-M", "ctrl", "w", "-m", "ctrl"]);
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "Ctrl+W closes the message tab again", tab_count(state) === tabs_before, `tabs ${tabs_before} then ${tab_count(state)}`);
  // Message state keys. Each key acts on the ids selected when it was pressed; flags are read back through the helper.
  const flag_of = (state, id, name) => state.flags[id]?.[name];
  state = await go_to_row(3);
  const flag_target = first_selected(state);
  const flagged_before = flag_of(state, flag_target, "flagged") === true;
  state = await key_and_state(instance, ["m"], 200).then(() => key_and_state(instance, ["s"], 1500));
  check(app, kind, "m s flips the star of the selected message", flag_of(state, flag_target, "flagged") === !flagged_before, `${flag_target} flagged ${flagged_before} -> ${flag_of(state, flag_target, "flagged")}`);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], 1500);
  check(app, kind, "m s again flips it back", flag_of(state, flag_target, "flagged") === flagged_before, `flagged ${flag_of(state, flag_target, "flagged")}`);

  await instance.press(["m"]);
  state = await key_and_state(instance, ["u"], 1500);
  check(app, kind, "m u marks the selected message unread", flag_of(state, flag_target, "read") === false, `read ${flag_of(state, flag_target, "read")}`);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["r"], 1500);
  check(app, kind, "m r marks the selected message read", flag_of(state, flag_target, "read") === true, `read ${flag_of(state, flag_target, "read")}`);

  await instance.press(["m"]);
  state = await key_and_state(instance, ["j"], 2000);
  check(app, kind, "m j marks the selected message junk", flag_of(state, flag_target, "junk") === true, `junk ${flag_of(state, flag_target, "junk")}`);
  const junk_home = Object.entries(state.folders).filter(([, ids]) => ids.includes(flag_target)).map(([path]) => path);
  note(app, kind, "where the message is after m j", JSON.stringify(junk_home));
  await instance.press(["m"]);
  state = await key_and_state(instance, ["j"], 2000);
  check(app, kind, "m j again clears junk", flag_of(state, flag_target, "junk") === false, `junk ${flag_of(state, flag_target, "junk")}`);

  // A collapsed thread root selects the whole thread, so one key must reach every message of it.
  await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  const thread_ids = state.selected.map((message) => message.header_id);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], 2000);
  const flagged_ids = thread_ids.filter((id) => flag_of(state, id, "flagged") === true);
  note(app, kind, "ids selected on a collapsed thread root", `${thread_ids.length}`);
  check(app, kind, "m s on a collapsed thread root flags every selected message", thread_ids.length > 0 && flagged_ids.length === thread_ids.length, `${flagged_ids.length} of ${thread_ids.length} flagged`);
  await instance.press(["m"]);
  await key_and_state(instance, ["s"], 1500);

  // m R marks the whole displayed folder read. First make one message unread.
  state = await go_to_row(5);
  const unread_target = first_selected(state);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["u"], 1500);
  const was_unread = flag_of(state, unread_target, "read") === false;
  await instance.press(["m"]);
  await instance.press(["R"]);
  await sleep(2500);
  state = await instance.ask("state");
  const still_unread = Object.entries(state.flags).filter(([id]) => state.folders["/Inbox"].includes(id) && flag_of(state, id, "read") === false);
  check(app, kind, "m R marks every message of the shown folder read", was_unread && still_unread.length === 0, `an unread message existed: ${was_unread}, unread left in Inbox: ${still_unread.length}`);
  await shot("after_m_R", "Inbox with no unread count after m R");

  // m z <preset> snoozes the selected message into a Snoozed folder of its account. The wake needs a clock run of minutes to hours, so it is a hand check.
  state = await go_to_row(9);
  const snooze_target = first_selected(state);
  const homes_after_snooze = (state, id) => Object.entries(state.folders).filter(([, ids]) => ids.includes(id)).map(([path]) => path);
  await instance.press(["m"]);
  await instance.press(["z"]);
  state = await key_and_state(instance, ["t"], 3000);
  check(app, kind, "m z t moves the selected message to a Snoozed folder and out of the Inbox", same(homes_after_snooze(state, snooze_target), ["/Snoozed"]), `${snooze_target} is in ${JSON.stringify(homes_after_snooze(state, snooze_target))}`);
  const snoozed_before = state.folders["/Snoozed"]?.length ?? 0;
  state = await go_to_row(9);
  const second_snooze_target = first_selected(state);
  await instance.press(["m"]);
  await instance.press(["z"]);
  state = await key_and_state(instance, ["m"], 3000);
  check(app, kind, "a second snooze reuses the Snoozed folder", same(homes_after_snooze(state, second_snooze_target), ["/Snoozed"]) && (state.folders["/Snoozed"]?.length ?? 0) === snoozed_before + 1, `${second_snooze_target} is in ${JSON.stringify(homes_after_snooze(state, second_snooze_target))}, Snoozed holds ${state.folders["/Snoozed"]?.length ?? 0}`);
  gone.add(snooze_target);
  gone.add(second_snooze_target);
  await shot("after_snooze", "Inbox after two snoozes; the Snoozed folder holds both messages");

  // Compose keys. R replies to all, g F forwards, c writes a new message.
  const compose_of = (state) => state.windows.find((window) => window.type === "messageCompose");
  const compose_subject = (state) => compose_of(state)?.tabs.map((tab) => tab.subject).find((subject) => subject !== null && subject !== undefined);
  state = await go_to_row(8);
  const compose_source = state.selected[0];
  state = await key_and_state(instance, ["R"], 6000);
  check(app, kind, "R opens Re: <subject> as a reply to all", compose_subject(state) === `Re: ${compose_source?.subject}`, `compose subject ${JSON.stringify(compose_subject(state))}`);
  await shot("after_R", "compose window replying to all");
  await instance.ask("close_compose");
  await sleep(1500);
  await instance.press(["g"]);
  state = await key_and_state(instance, ["F"], 6000);
  check(app, kind, "g F opens Fwd: <subject>", compose_subject(state) === `Fwd: ${compose_source?.subject}`, `compose subject ${JSON.stringify(compose_subject(state))}`);
  await shot("after_gF", "compose window forwarding the selected message");
  await instance.ask("close_compose");
  await sleep(1500);
  state = await key_and_state(instance, ["c"], 6000);
  check(app, kind, "c opens an empty new message", compose_of(state) !== undefined && !compose_subject(state), `compose windows ${state.windows.filter((window) => window.type === "messageCompose").length}, subject ${JSON.stringify(compose_subject(state))}`);
  await shot("after_c", "empty compose window");
  await instance.ask("close_compose");
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "the app survived the compose keys", instance.exited() === null && !state.windows.some((window) => window.type === "messageCompose"));
  await run_view_settings(instance, { app, kind });
  await shot("after_view_settings", "Views folder after the view setting keys");
  await run_cmdline(instance, { app, kind, shot });
  await run_folders(instance);
}

// The command line, in the Views folder that run_view_settings leaves shown. `:` opens the overlay over the window and the keys go to it. Esc closes it and the list has focus again. A typed command runs.
// Focus back in the list is measured with Thunderbird's own Down key: it moves the list selection only while the list has focus, and the overlay is gone from the focus chain by then.
async function run_cmdline(instance, { app, kind, shot }) {
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  let state = await instance.ask("state");
  let selected_before = selection_of(state);
  let folders_before = JSON.stringify(state.folders);
  // j and x typed with no pause after the colon: the key runtime holds plain keys until the overlay has the focus, so neither reaches the list.
  await instance.press([":", "j", "x"]);
  await sleep(1500);
  await shot("cmdline_open", "the command line over the bottom of the window, with the completion list above its input");
  state = await instance.ask("state");
  check(app, kind, ": then j x typed with no pause runs neither a motion nor archive", selection_of(state) === selected_before && JSON.stringify(state.folders) === folders_before, `selected ${selected_before} then ${selection_of(state)}, mail changed: ${JSON.stringify(state.folders) !== folders_before}`);
  await instance.press(["j", "x"]);
  await sleep(500);
  state = await instance.ask("state");
  check(app, kind, "j and x typed into the open command line run nothing", selection_of(state) === selected_before && JSON.stringify(state.folders) === folders_before, `selected ${selected_before} then ${selection_of(state)}`);
  await shot("cmdline_typed", "the line after j and x were typed into it");
  await instance.press(["-k", "Escape"]);
  await sleep(1000);
  await shot("cmdline_closed", "the window after Escape, with no command line");
  state = await key_and_state(instance, ["j"], 800);
  check(app, kind, "after Escape a bound key runs again", selection_of(state) !== selected_before, `selected ${selected_before} then ${selection_of(state)}`);
  const row_after_j = selection_of(state);
  await instance.press(["-k", "Down"]);
  await sleep(800);
  state = await instance.ask("state");
  check(app, kind, "after Escape the list has focus: Thunderbird's own Down moves the selection", selection_of(state) !== row_after_j && selection_of(state) !== "", `selected ${row_after_j} then ${selection_of(state)}`);

  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["sort --date --ascending"]);
  await sleep(500);
  await shot("cmdline_sort", "the line with sort --date --ascending typed");
  await instance.press(["-k", "Return"]);
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, ": sort --date --ascending runs the command", state.mail_tab?.sort_type === "date" && state.mail_tab?.sort_order === "ascending", `sort ${state.mail_tab?.sort_type} ${state.mail_tab?.sort_order}`);
  // The ascending date sort leaves the selection on the first row, where Up cannot move it, so the key is Down.
  const after_run = selection_of(await instance.ask("state"));
  await instance.press(["-k", "Down"]);
  await sleep(800);
  const after_down = selection_of(await instance.ask("state"));
  check(app, kind, "after a command ran the list has focus again", after_down !== after_run, `selected ${after_run} then ${after_down}`);

  // The key m t opens the line with the command started, and the command acts on the message selected when the key was pressed.
  const target = (await instance.ask("state")).selected[0]?.header_id;
  await instance.press(["m"]);
  await instance.press(["t"]);
  await sleep(1200);
  await instance.press(["Work"]);
  await sleep(400);
  await instance.press(["-k", "Return"]);
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "m t then Work tags the selected message", target !== undefined && (state.flags[target]?.tags ?? []).includes("$label2"), `${target} tags ${JSON.stringify(state.flags[target]?.tags)}`);
  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["bogus"]);
  await instance.press(["-k", "Return"]);
  await sleep(800);
  await shot("cmdline_error", "the line stays open and names the unknown command");
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  check(app, kind, "the app survived the command line", instance.exited() === null);
}

// The view settings, read as row counts of the Views folder (6 messages: 3 unread, 2 starred, 1 with an attachment, 2 tagged).
// The tag and search forms have no default key, so the helper applies the same arguments the handlers send, straight through the API.
async function run_view_settings(instance, check_in) {
  const { app, kind } = check_in;
  const prepared = await instance.ask("prepare_views", 30000);
  check(app, kind, "the helper shows the Views folder and tags two messages", prepared.prepared === true, prepared.error ?? JSON.stringify(prepared.seen));
  await sleep(2000);
  let state = await instance.ask("state");
  check(app, kind, "the Views folder is displayed with 6 messages", state.mail_tab?.folder === "/Views" && state.listed.length === 6, `folder ${state.mail_tab?.folder}, listed ${state.listed.length}`);
  const listed_after = async (args, wait_ms = 1500) => (await key_and_state(instance, args, wait_ms)).listed.length;
  for (const [name, keys, expected] of [["unread", ["F", "u"], 3], ["starred", ["F", "s"], 2], ["attachment", ["F", "f"], 1], ["all", ["F", "a"], 6]]) {
    await instance.press([keys[0]]);
    const count = await listed_after([keys[1]]);
    check(app, kind, `F ${keys[1]} (${name}) shows ${expected} rows`, count === expected, `listed ${count}`);
  }
  await instance.ask("api_view", 20000, { filter: { tags: { mode: "any", tags: { $label1: true } } } });
  await sleep(1500);
  state = await instance.ask("state");
  const tagged = Object.entries(state.flags).filter(([, flags]) => flags.tags?.length).map(([id]) => id);
  check(app, kind, "the tag filter the handler sends shows the 2 tagged rows", state.listed.length === 2, `listed ${state.listed.length}, tagged messages ${JSON.stringify(tagged)}`);
  await instance.ask("api_view", 20000, { filter: { text: { text: "Views 3", subject: true, author: true } } });
  await sleep(1500);
  check(app, kind, "the text filter search.threads sends shows 1 row", (await instance.ask("state")).listed.length === 1);
  await instance.ask("api_view", 20000, { filter: {} });
  await sleep(1500);
  check(app, kind, "clearing with {} restores 6 rows", (await instance.ask("state")).listed.length === 6);
  // The Views messages rise in date and subject with their number, and the sender names follow the order in profile.mjs, so each sort key shows as the row order.
  const views_rows = (by, order) => {
    const ascending = by === "author" ? [2, 4, 0, 3, 5, 1] : [0, 1, 2, 3, 4, 5];
    return (order === "ascending" ? ascending : [...ascending].reverse()).map((index) => `views-${index}@fixture.invalid`);
  };
  for (const [name, keys, sort_type, sort_order] of [
    ["date", ["d"], "date", "descending"],
    ["subject", ["s"], "subject", "ascending"],
    ["current column, order toggled", ["o"], "subject", "descending"],
    ["author", ["f"], "author", "ascending"],
    ["current column, order toggled", ["o"], "author", "descending"],
  ]) {
    await instance.press([","]);
    state = await key_and_state(instance, keys, 1200);
    check(app, kind, `, ${keys[0]} (${name}) sets ${sort_type} ${sort_order}`, state.mail_tab?.sort_type === sort_type && state.mail_tab?.sort_order === sort_order, `sortType ${state.mail_tab?.sort_type}, sortOrder ${state.mail_tab?.sort_order}`);
    check(app, kind, `, ${keys[0]} (${name}) orders the rows`, same(state.listed, views_rows(sort_type, sort_order)), state.listed.join(" "));
  }
  // Measurement for the sort.set `by` enum: does mailTabs.update accept these two column names?
  for (const sort_type of ["received", "priority"]) {
    const answer = await instance.ask("api_view", 20000, { update: { sortType: sort_type, sortOrder: "ascending" } });
    await sleep(800);
    state = await instance.ask("state");
    note(app, kind, `mailTabs.update sortType ${sort_type}`, `${answer.error ? `error ${answer.error}` : "accepted"}, tab then reports sortType ${state.mail_tab?.sort_type}`);
  }
  const panes = (current) => `${current.mail_tab?.message_pane_visible}/${current.mail_tab?.folder_pane_visible}`;
  const before = await instance.ask("state");
  await instance.press(["t"]);
  state = await key_and_state(instance, ["m"]);
  check(app, kind, "t m toggles the message pane", state.mail_tab?.message_pane_visible === !before.mail_tab?.message_pane_visible, `message/folder pane ${panes(before)} then ${panes(state)}`);
  await instance.press(["t"]);
  state = await key_and_state(instance, ["m"]);
  check(app, kind, "a second t m restores the message pane", state.mail_tab?.message_pane_visible === before.mail_tab?.message_pane_visible, `message/folder pane ${panes(state)}`);
  await instance.press(["t"]);
  const folder_toggled = await key_and_state(instance, ["f"]);
  check(app, kind, "t f toggles the folder pane", folder_toggled.mail_tab?.folder_pane_visible === !before.mail_tab?.folder_pane_visible, `message/folder pane ${panes(before)} then ${panes(folder_toggled)}`);
  await instance.press(["t"]);
  state = await key_and_state(instance, ["f"]);
  check(app, kind, "a second t f restores the folder pane", state.mail_tab?.folder_pane_visible === before.mail_tab?.folder_pane_visible);
  check(app, kind, "the view keys changed no mail", instance.exited() === null);
}

const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
const main_window_tabs = (state) => state.windows.find((window) => window.type === "normal")?.tabs ?? [];
const active_index = (state) => main_window_tabs(state).findIndex((tab) => tab.active);

// Tab commands. The helper add-on opens, selects and closes tabs through the API, since wtype has no mouse.
async function run_tabs(instance, { check, note, shot, key_and_state }) {
  const app = instance.app;
  const kind = "default";
  const tabs_of = async () => main_window_tabs(await instance.ask("state"));

  // q on the only mail tab: tabs.remove does nothing there, so the command refuses with a notification and the tab stays.
  const log_offset = instance.app_log().length;
  let state = await key_and_state(instance, ["q"], 2500);
  check(app, kind, "q on the only mail tab leaves it open", main_window_tabs(state).length === 1, `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => tab.type))}`);
  check(app, kind, "q on the only mail tab shows the refusal (a notification was attempted)", /libnotify/.test(instance.app_log().slice(log_offset)), "evidence is the libnotify warning in the app log");

  // What the tabs API reports for the first mail tab and for a second one.
  const second = await instance.ask("open_mail_tab");
  await sleep(2500);
  state = await instance.ask("state");
  check(app, kind, "a second mail tab opens", main_window_tabs(state).length === 2, `reply ${JSON.stringify(second)}`);
  note(app, kind, "tab properties", JSON.stringify(main_window_tabs(state).map((tab) => tab.raw)));
  // q closes a second mail tab: the one tab a key can be pressed in and tabs.remove can close.
  state = await key_and_state(instance, ["q"], 2000);
  check(app, kind, "q closes a second mail tab", main_window_tabs(state).length === 1, `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => `${tab.type}${tab.active ? "*" : ""}`))}`);
  await instance.ask("open_mail_tab");
  await sleep(2500);
  // The tabs API gives no property that marks the first mail tab. Can the API move it off index 0?
  const moved = await instance.ask("move_first_tab");
  await sleep(1000);
  state = await instance.ask("state");
  note(app, kind, "tabs.move of the first mail tab to index 1", `reply ${JSON.stringify(moved)}, tab ids by index now ${JSON.stringify(main_window_tabs(state).map((tab) => tab.id))}`);
  await instance.ask("reset_tabs");
  await sleep(1500);

  // Measured facts for tabs other than the mail tab.
  const content = await instance.ask("open_content_tab");
  await sleep(1500);
  state = await instance.ask("state");
  note(app, kind, "content tab opened", `id ${content.opened}, tabs ${JSON.stringify(main_window_tabs(state).map((tab) => `${tab.type}${tab.active ? "*" : ""}`))}`);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  state = await instance.ask("state");
  check(app, kind, "tabs.update makes the mail tab active again", active_index(state) === 0, `active index ${active_index(state)}`);
  await shot("mail_tab_again", "main window back on the mail tab after the content tab opened");

  // A bound chord runs, and Thunderbird's own action for it does not happen. C-j opens Saved Files by default, C-k moves focus to the global search.
  const before_chord = main_window_tabs(await instance.ask("state"));
  state = await key_and_state(instance, CTRL("j"), 1500);
  check(app, kind, "C-j switches to the next tab", active_index(state) === 1, `active index ${active_index(state)}`);
  check(app, kind, "C-j does not open Saved Files, which is Thunderbird's own action for it", main_window_tabs(state).length === before_chord.length && !main_window_tabs(state).some((tab) => /saved/i.test(`${tab.title} ${tab.type}`)), `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => `${tab.type}:${tab.title}`))}`);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);

  // C-k runs from the mail tab only. With a content tab beside it, C-k from the mail tab wraps to the last tab.
  state = await key_and_state(instance, CTRL("k"), 1500);
  check(app, kind, "C-k switches to the previous tab, wrapping to the last", active_index(state) === main_window_tabs(state).length - 1, `active index ${active_index(state)} of ${main_window_tabs(state).length}`);
  await shot("after_ctrl_k", "the content tab in front after C-k from the mail tab");

  // From the content tab no key works: record what a key does there.
  const log_before_content_key = instance.app_log().length;
  state = await key_and_state(instance, CTRL("j"), 1500);
  note(app, kind, "C-j from a content tab", `active index ${active_index(state)} of ${main_window_tabs(state).length}, tab types ${JSON.stringify(main_window_tabs(state).map((tab) => tab.type))}, log grew ${instance.app_log().length - log_before_content_key} bytes`);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);

  // Thunderbird's own C-j ran there and opened Saved Files, so the helper closes every extra tab. Then a fresh content tab measures tabs.remove away from the mail tab.
  await instance.ask("reset_tabs");
  await sleep(1000);
  await instance.ask("open_content_tab");
  await sleep(1500);
  const removed = await instance.ask("remove_tab", 20000, { index: 1 });
  await sleep(1000);
  state = await instance.ask("state");
  check(app, kind, "tabs.remove closes a content tab", removed.removed === true && main_window_tabs(state).length === 1, `tabs left ${main_window_tabs(state).length}`);

  // A message tab: open one for the selected message, switch to it, and measure a key there.
  await instance.ask("open_message_tab");
  await sleep(2000);
  state = await instance.ask("state");
  note(app, kind, "message tab opened", `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => `${tab.type}${tab.active ? "*" : ""}`))}`);
  const message_tab_count = main_window_tabs(state).length;
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  state = await key_and_state(instance, CTRL("j"), 1500);
  check(app, kind, "C-j reaches the message tab from the mail tab", active_index(state) === 1 && message_tab_count === 2, `active index ${active_index(state)} of ${main_window_tabs(state).length}`);
  state = await key_and_state(instance, CTRL("k"), 1500);
  note(app, kind, "C-k from a message tab", `active index ${active_index(state)} of ${main_window_tabs(state).length}`);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  const closed = await instance.ask("remove_tab", 20000, { index: 1 });
  await sleep(1000);
  state = await instance.ask("state");
  check(app, kind, "tabs.remove closes a message tab", closed.removed === true && main_window_tabs(state).length === 1, `tabs left ${main_window_tabs(state).length}`);

  // db-sequence-reset: a d typed before a tab switch with no key between (a click) does not pair with a d typed after it.
  await instance.ask("open_content_tab");
  await sleep(1500);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["G"]);
  const trash_before = (await instance.ask("state")).folders["/Trash"]?.length ?? 0;
  await instance.press(["d"]);
  await instance.ask("select_tab", 20000, { index: 1 });
  await sleep(800);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  state = await key_and_state(instance, ["d"], 2500);
  check(app, kind, "a d typed before a tab switch does not pair with a d typed after it", (state.folders["/Trash"]?.length ?? 0) === trash_before, `Trash holds ${state.folders["/Trash"]?.length ?? 0}, it held ${trash_before}`);
  // One more d: it pairs with the d typed after the switch only if that d reached the app, so a lost first key fails here.
  state = await key_and_state(instance, ["d"], 2500);
  check(app, kind, "the d after the switch counted, so the next d trashes", (state.folders["/Trash"]?.length ?? 0) === trash_before + 1, `Trash holds ${state.folders["/Trash"]?.length ?? 0}`);
  // A count is part of the half-typed state too: 3, a tab switch and back, then k moves one row. Three rows means the count survived. No move means the key was lost.
  const listed_index = (snapshot) => snapshot.listed.indexOf(first_selected(snapshot));
  state = await key_and_state(instance, ["G"]);
  const last_row = listed_index(state);
  await instance.press(["3"]);
  await instance.ask("select_tab", 20000, { index: 1 });
  await sleep(800);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  state = await key_and_state(instance, ["k"], 1500);
  check(app, kind, "a count typed before a tab switch is dropped, so k moves one row", listed_index(state) === last_row - 1, `row ${listed_index(state)} after k from row ${last_row}`);
  await instance.ask("remove_tab", 20000, { index: 1 });
  await sleep(1000);
  // A window blur ends the sequence too: d, another window takes focus and gives it back, then d. The popup takes focus when it opens, so the main window blurs.
  state = await key_and_state(instance, ["G"]);
  const trash_before_blur = (await instance.ask("state")).folders["/Trash"]?.length ?? 0;
  await instance.press(["d"]);
  const popup = await instance.ask("open_popup_window", 20000);
  await sleep(1500);
  await instance.ask("close_popup_window", 20000, { id: popup.opened });
  await sleep(1500);
  state = await key_and_state(instance, ["d"], 2500);
  check(app, kind, "a d typed before a window blur does not pair with a d typed after it", (state.folders["/Trash"]?.length ?? 0) === trash_before_blur, `Trash holds ${state.folders["/Trash"]?.length ?? 0}, it held ${trash_before_blur}`);
  // One more d: it pairs with the d typed after the blur only if that d reached the app, so a window that never got focus back fails here. It also leaves no d pending.
  state = await key_and_state(instance, ["d"], 2500);
  check(app, kind, "the d after the blur counted, so the next d trashes", (state.folders["/Trash"]?.length ?? 0) === trash_before_blur + 1, `Trash holds ${state.folders["/Trash"]?.length ?? 0}`);

}

// Runs last in the default run, because it restarts the app.
async function run_folders(instance) {
  const app = instance.app;
  const kind = "default";
  // db-folders-jumps: special folder keys, marks, the jump history and its chords. Local Folders holds an Inbox and a Trash and no Drafts or Sent.
  const shown_folder = async (keys, wait_ms = 1500) => {
    for (const key of keys.slice(0, -1)) await instance.press(typeof key === "string" ? [key] : key);
    const last = keys.at(-1);
    return (await key_and_state(instance, typeof last === "string" ? [last] : last, wait_ms)).mail_tab?.folder;
  };
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  check(app, kind, "g i shows the Inbox", (await shown_folder(["g", "i"])) === "/Inbox");
  await shown_folder(["M", "a"], 700);
  check(app, kind, "g t shows Trash", (await shown_folder(["g", "t"])) === "/Trash");
  check(app, kind, "' a returns to the Inbox marked with M a", (await shown_folder(["'", "a"])) === "/Inbox");
  check(app, kind, "C-o walks back to Trash", (await shown_folder([CTRL("o")])) === "/Trash");
  check(app, kind, "a second C-o walks back to the Inbox", (await shown_folder([CTRL("o")])) === "/Inbox");
  check(app, kind, "C-i walks forward to Trash", (await shown_folder([CTRL("i")])) === "/Trash");
  check(app, kind, "a second C-i walks forward to the Inbox", (await shown_folder([CTRL("i")])) === "/Inbox");
  // Marks and the history live in storage. The helper's reload (management.setEnabled) is refused here, so this restarts the whole app on the same profile.
  await shown_folder(["g", "t"]);
  await shown_folder(["M", "b"], 700);
  await instance.restart();
  const start_folder = (await instance.ask("state")).mail_tab?.folder;
  note(app, kind, "folder shown after the restart", String(start_folder));
  check(app, kind, "g i after the restart shows the Inbox", (await shown_folder(["g", "i"], 2500)) === "/Inbox");
  // The app restores the folder it last showed, or another. C-o goes back to the folder shown at the start, and from a start on the Inbox it goes back to Trash.
  const back_to = start_folder && start_folder.length > 1 && start_folder !== "/Inbox" ? start_folder : "/Trash";
  check(app, kind, `C-o after the restart walks back to ${back_to}`, (await shown_folder([CTRL("o")], 2500)) === back_to);
  await shown_folder(["g", "i"], 2000);
  check(app, kind, "the mark set before the restart survives it", (await shown_folder(["'", "b"], 2500)) === "/Trash");
  // A special folder this account lacks changes nothing and the app stays up.
  await shown_folder(["g", "i"], 1500);
  check(app, kind, "g s with no Sent folder leaves the view where it was", (await shown_folder(["g", "s"], 1500)) === "/Inbox");
  // The history rests on the display event, so measure it: an API display of a never shown folder throws in the API call and still fires the event.
  await instance.ask("folder_events_start");
  const first_display = await instance.ask("show_folder", 20000, { path: "/Views" });
  await sleep(2000);
  const events = (await instance.ask("folder_events_read")).events;
  check(app, kind, "onDisplayedFolderChanged fires once for a folder the API shows for the first time", events.length === 1 && events[0].path === "/Views", `events ${JSON.stringify(events.map((event) => event.path))}`);
  note(app, kind, "first display of /Views through the API", `update error ${first_display.update_error}, query right after ${first_display.query_error ?? first_display.shown_right_after}`);
  check(app, kind, "g i after the API display shows the Inbox again", (await shown_folder(["g", "i"], 2000)) === "/Inbox");
  check(app, kind, "the app survived the folder keys", instance.exited() === null);
}

async function run_no_identity(instance) {
  const app = instance.app;
  const kind = "reply_no_identity";
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };
  const opened = await open_inbox(instance, 6);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  await key_and_state(instance, ["g"]);
  let state = await key_and_state(instance, ["g"]);
  check(app, kind, "g g selects the first row", first_selected(state) !== null);
  // One message, so the refusal is the identity one and not the "select one message" one.
  await key_and_state(instance, ["G"]);
  // The log file is appended to across runs, so only the text written after this point counts.
  const log_offset = instance.app_log().length;
  state = await key_and_state(instance, ["r"], 6000);
  check(app, kind, "r with no identity shows the refusal (a notification was attempted)", /libnotify/.test(instance.app_log().slice(log_offset)), `evidence is the libnotify warning in the app log, since the headless session shows no notification (selected ${state.selected.length})`);
  check(app, kind, "r with no identity opens no compose window", !state.windows.some((window) => window.type === "messageCompose"));
  check(app, kind, "r with no identity does not crash the app", instance.exited() === null);
  // Forward and new refuse the same way. Unguarded, forward hangs with no window and new opens a window that cannot send, so the missing window is the proof for new.
  // The headless session logs the libnotify warning for the first notification only, so these two checks cannot see the refusal itself. The unit tests do.
  for (const [name, keys] of [["g F", ["g", "F"]], ["c", ["c"]]]) {
    for (const key of keys.slice(0, -1)) await instance.press([key]);
    state = await key_and_state(instance, [keys.at(-1)], 4000);
    check(app, kind, `${name} with no identity opens no compose window`, !state.windows.some((window) => window.type === "messageCompose"), `selected ${state.selected.length}`);
    check(app, kind, `${name} with no identity does not crash the app`, instance.exited() === null);
  }
  await shot("refusal", "mail window after r with no identity; the refusal notification should show");
  await sleep(2000);
  await shot("refusal_later", "same window two seconds later");
}

// A default POP3 account with the identities "id2" (main) and "id3" (alias), plus Local Folders with none. A message of Local Folders borrows the default account's identity, and a message addressed to the alias keeps the alias.
async function run_mail_account(instance) {
  const app = instance.app;
  const kind = "mail_account";
  const compose_identity = (state) => state.windows.find((window) => window.type === "messageCompose")?.tabs.find((tab) => tab.identity_id)?.identity_id ?? null;
  await sleep(2000);
  await instance.press(["-k", "F6"]);
  const cases = [
    ["Local Folders message", "inbox-s2@fixture.invalid", [["r"], "r", "id2"], [["g", "F"], "g F", "id2"]],
    ["mail account message to the main identity", "mail-plain@fixture.invalid", [["r"], "r", "id2"], [["g", "F"], "g F", "id2"]],
    ["mail account message to the alias identity", "mail-alias@fixture.invalid", [["r"], "r", "id3"], [["g", "F"], "g F", "id3"]],
  ];
  for (const [label, header_id, ...keys] of cases) {
    for (const [presses, name, expected] of keys) {
      await instance.ask(`select:${header_id}`, 30000);
      await sleep(1000);
      for (const key of presses.slice(0, -1)) await instance.press([key]);
      const state = await key_and_state(instance, [presses.at(-1)], 7000);
      check(app, kind, `${name} on a ${label} composes from identity ${expected}`, compose_identity(state) === expected, `compose identity ${compose_identity(state)}, selected ${state.selected.map((message) => message.header_id)}`);
      await instance.ask("close_compose");
      await sleep(1500);
    }
  }
  check(app, kind, "the app survived", instance.exited() === null);
}

// The body script: keys while a message is read, in the reading pane, a message tab and a message window. The helper's own content script reports the scroll position and whether DesertBird marked the document.
const LINE_STEP_PX = 40;
const READING_FOLDER_MESSAGES = ["reading-plain", "reading-html", "reading-remote", "reading-sandbox"];
const body_state = (state) => state.body ?? { live: false, scroll_y: -1, scroll_height: 0, inner_height: 0, selection: "" };
const near = (value, expected) => Math.abs(value - expected) <= 2;

async function run_message_scripts(instance) {
  const app = instance.app;
  const kind = instance.kind;
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${kind}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };
  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);

  // Shows the message in the pane and puts focus in its body: the helper selects it, one F6 from the thread list reaches the body.
  const show_in_pane = async (id) => {
    await instance.ask(`select:${id}@fixture.invalid`, 30000);
    await sleep(2500);
    await instance.press(["-k", "F6"]);
    await sleep(1500);
    return instance.ask("state");
  };
  // Runs the scroll keys in the document that has focus. `where` names it in each check.
  // Escape is skipped where Thunderbird itself closes the window on it, the message window.
  const scroll_keys = async (where, { measure_only = false, escape = true } = {}) => {
    let state = await instance.ask("state");
    const start = body_state(state);
    note(app, kind, `${where}: body document`, `live ${start.live}, top frame ${start.is_top}, scrollHeight ${start.scroll_height}, innerHeight ${start.inner_height}, ${start.href}`);
    check(app, kind, `${where}: the body script marked the document live`, start.live === true, JSON.stringify(start));
    check(app, kind, `${where}: the message is taller than a screen`, start.scroll_height > 3 * start.inner_height, `scrollHeight ${start.scroll_height}, innerHeight ${start.inner_height}`);
    const keys = async (args, wait = 800) => body_state(await key_and_state(instance, args, wait));
    let body = await keys(["j"]);
    check(app, kind, `${where}: j scrolls one line`, near(body.scroll_y, LINE_STEP_PX), `scrollY ${body.scroll_y}`);
    if (measure_only) return;
    await instance.press(["5"]);
    body = await keys(["j"]);
    check(app, kind, `${where}: 5j scrolls five lines`, near(body.scroll_y, 6 * LINE_STEP_PX), `scrollY ${body.scroll_y}`);
    body = await keys(["k"]);
    check(app, kind, `${where}: k scrolls one line back`, near(body.scroll_y, 5 * LINE_STEP_PX), `scrollY ${body.scroll_y}`);
    const before_half = body.scroll_y;
    body = await keys(["-M", "ctrl", "d", "-m", "ctrl"]);
    check(app, kind, `${where}: Ctrl+d scrolls half a page`, near(body.scroll_y - before_half, body.inner_height / 2), `scrollY ${before_half} then ${body.scroll_y}, innerHeight ${body.inner_height}`);
    body = await keys(["-M", "ctrl", "u", "-m", "ctrl"]);
    check(app, kind, `${where}: Ctrl+u scrolls half a page back`, near(body.scroll_y, before_half), `scrollY ${body.scroll_y}, expected ${before_half}`);
    await instance.press(["G"]);
    await sleep(800);
    body = body_state(await instance.ask("state"));
    check(app, kind, `${where}: G scrolls to the bottom`, near(body.scroll_y, body.scroll_height - body.inner_height), `scrollY ${body.scroll_y}, scrollHeight ${body.scroll_height}, innerHeight ${body.inner_height}`);
    await shot(`${where.replaceAll(" ", "_")}_bottom`, `${where} after G`);
    await instance.press(["g"]);
    body = await keys(["g"]);
    check(app, kind, `${where}: g g scrolls to the top`, body.scroll_y === 0, `scrollY ${body.scroll_y}`);
    if (!escape) return;
    // A count then Escape ends the count, so the next j is one line.
    await instance.press(["7"]);
    await instance.press(["-k", "Escape"]);
    body = await keys(["j"]);
    check(app, kind, `${where}: Escape drops a pending count`, near(body.scroll_y, LINE_STEP_PX), `scrollY ${body.scroll_y}`);
    await key_and_state(instance, ["g"]);
    await key_and_state(instance, ["g"]);
  };

  // `refocus_body` is for the reading pane, where the line returns the focus to the thread list and not to the message: the run then notes whether n moves, and presses F6 to put the focus in the body.
  const find_checks = async (where, { refocus_body = false } = {}) => {
    const body_after = async (args, wait = 1200) => body_state(await key_and_state(instance, args, wait));
    await instance.press(["/"]);
    await sleep(1500);
    await shot(`${where.replaceAll(" ", "_")}_find_line`, `${where} with the command line open, find typed in`);
    await instance.press(["marker"]);
    await sleep(400);
    await instance.press(["-k", "Return"]);
    await sleep(2000);
    let body = body_state(await instance.ask("state"));
    const first = body.scroll_y;
    check(app, kind, `${where}: find selects the first match and scrolls to it`, body.selection === "marker" && first > body.inner_height, `selection ${JSON.stringify(body.selection)}, scrollY ${first}, innerHeight ${body.inner_height}`);
    if (refocus_body) {
      body = await body_after(["n"]);
      note(app, kind, `${where}: n right after the line closed`, `${body.scroll_y === first ? "did not move" : "moved"}: scrollY ${first} then ${body.scroll_y}`);
      await instance.press(["-k", "F6"]);
      await sleep(800);
    }
    body = await body_after(["n"]);
    const second = body.scroll_y;
    check(app, kind, `${where}: n goes to the next match`, body.selection === "marker" && second > first, `scrollY ${first} then ${second}`);
    body = await body_after(["n"]);
    check(app, kind, `${where}: n wraps from the last match to the first`, near(body.scroll_y, first), `scrollY ${body.scroll_y}, first match at ${first}`);
    body = await body_after(["N"]);
    check(app, kind, `${where}: N wraps from the first match to the last`, near(body.scroll_y, second), `scrollY ${body.scroll_y}, last match at ${second}`);
    body = await body_after(["N"]);
    check(app, kind, `${where}: N goes back to the first match`, near(body.scroll_y, first), `scrollY ${body.scroll_y}, first match at ${first}`);
    await shot(`${where.replaceAll(" ", "_")}_found`, `${where} with the match selected`);
    await key_and_state(instance, ["g"]);
    await key_and_state(instance, ["g"]);
  };

  // The reading pane. j in the body scrolls and moves no row, r opens no compose window, and the list keeps its keys once focus returns.
  let state = await show_in_pane("reading-plain");
  const pane_message = first_selected(state);
  check(app, kind, "a message shows in the pane", pane_message === "reading-plain@fixture.invalid", `selected ${pane_message}`);
  await shot("pane_plain", "reading pane with the plain text message, body focused");
  await scroll_keys("pane plain text");
  // Thunderbird's own single-key shortcuts must not fire while the body script is live. `s` stars the message and `m` toggles its read state, and the helper reports both. A bare `r` would prove nothing: the message is already read. `f` is the hint key now, so it no longer proves the swallow.
  const starred_before = state.flags[pane_message]?.flagged;
  const read_before = state.flags[pane_message]?.read;
  state = await key_and_state(instance, ["s"], 1500);
  check(app, kind, "pane: s stars nothing, the body script swallows Thunderbird's single-key shortcuts", state.flags[pane_message]?.flagged === starred_before, `flagged ${starred_before} then ${state.flags[pane_message]?.flagged}`);
  state = await key_and_state(instance, ["m"], 1500);
  check(app, kind, "pane: m does not toggle the read state", state.flags[pane_message]?.read === read_before && first_selected(state) === pane_message, `read ${read_before} then ${state.flags[pane_message]?.read}, selected ${first_selected(state)}`);
  // Find: `/` opens the command line over the window, the typed text runs `find`, and the body script selects the match. n and N step with wrap, which also proves the focus went back into the message after the line closed.
  await find_checks("pane plain text", { refocus_body: true });
  state = await instance.ask("state");
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  await sleep(800);
  state = await key_and_state(instance, ["j"]);
  check(app, kind, "pane: after focus returns to the list, j moves the list again", first_selected(state) !== pane_message && first_selected(state) !== null, `selected ${first_selected(state)}`);

  // HTML mail, remote content and a sandboxed frame. The measurement the design asked for: does the script run there?
  for (const id of READING_FOLDER_MESSAGES.slice(1)) {
    await show_in_pane(id);
    await shot(`pane_${id}`, `reading pane with ${id}, body focused`);
    await scroll_keys(`pane ${id}`, { measure_only: true });
    await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
    await sleep(600);
  }

  // Hints: f labels the link on screen, the typed label clicks it, and the link target at the bottom of the mail scrolls into view.
  await show_in_pane("reading-html");
  let hint_body = body_state(await instance.ask("state"));
  check(app, kind, "hints: the html message starts at the top", hint_body.scroll_y === 0, `scrollY ${hint_body.scroll_y}`);
  await instance.press(["f"]);
  await sleep(800);
  await shot("hint_labels", "reading pane with the hint label on the link");
  await instance.press(["a"]);
  await sleep(1500);
  hint_body = body_state(await instance.ask("state"));
  check(app, kind, "hints: f then a clicks the link, so the page scrolls to its target", hint_body.scroll_y > 2 * hint_body.inner_height, `scrollY ${hint_body.scroll_y}, innerHeight ${hint_body.inner_height}`);
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  await sleep(600);

  // A message tab: the message opens in a new tab and the keys go to it.
  await show_in_pane("reading-plain");
  await instance.ask("open_message_tab");
  await sleep(4000);
  state = await instance.ask("state");
  check(app, kind, "a message tab opened", main_window_tabs(state).some((tab) => tab.type === "messageDisplay"), JSON.stringify(main_window_tabs(state).map((tab) => tab.type)));
  await shot("message_tab", "message in its own tab");
  await scroll_keys("message tab");
  await find_checks("message tab");
  await instance.ask("reset_tabs");
  await sleep(1500);

  // A message window.
  await instance.ask("select:reading-plain@fixture.invalid", 30000);
  await sleep(1500);
  await instance.ask("open_message_window");
  await sleep(4000);
  state = await instance.ask("state");
  check(app, kind, "a message window opened", state.windows.some((window) => window.type === "messageDisplay"), JSON.stringify(state.windows.map((window) => window.type)));
  await shot("message_window", "message in its own window");
  await scroll_keys("message window", { escape: false });
  // The command line cannot open in a message window. `/` refuses with a notification, and the keys of the window stay as they were.
  await instance.press(["/"]);
  await sleep(1500);
  await shot("message_window_slash", "message window after / (a notification, no command line)");
  const before_refusal = body_state(await instance.ask("state")).scroll_y;
  const after_refusal = body_state(await key_and_state(instance, ["j"], 1000)).scroll_y;
  check(app, kind, "message window: / opens no command line, so j still scrolls", near(after_refusal - before_refusal, LINE_STEP_PX), `scrollY ${before_refusal} then ${after_refusal}`);
  await instance.ask("close_message_windows");
  await sleep(1500);
  check(app, kind, "the app survived", instance.exited() === null);
}

async function run_assertions(instance) {
  if (instance.kind === "default") await run_default(instance);
  else if (instance.kind === "message" || instance.kind === "message_remote") await run_message_scripts(instance);
  else if (instance.kind === "mail_account") await run_mail_account(instance);
  else await run_no_identity(instance);
}

let all_ok = true;
for (const app of apps) {
  if (!binaries[app] || !existsSync(binaries[app])) throw new Error(`no binary for ${app} at ${binaries[app]}`);
  const kinds = (process.env.E2E_KINDS ?? "default,reply_no_identity,mail_account,message,message_remote").split(",");
  for (const kind of kinds) {
    const instance = await start_app({ app, app_binary: binaries[app], work_dir: join(e2e_dir, app, kind), kind, xpi_path });
    try {
      if (xpi_path) await run_assertions({ ...instance, kind });
      else {
        const shot = await instance.shot(`${app}_${kind}_start`);
        const exited = instance.exited();
        console.log(`${app} ${kind}: ${exited ? `app exited ${JSON.stringify(exited)}` : "running"}, screenshot ${shot}`);
        all_ok = all_ok && !exited;
      }
    } finally {
      await instance.stop();
    }
  }
}
if (xpi_path) {
  writeFileSync(join(e2e_dir, "report.json"), JSON.stringify(report, null, 2));
  all_ok = all_ok && report.checks.every((entry) => entry.ok);
}
process.exit(all_ok ? 0 : 1);
