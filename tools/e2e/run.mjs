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
  state = await (await instance.press(["5"]), key_and_state(instance, ["j"]));
  check(app, kind, "5j moves five rows", first_selected(state) === rows[5], `selected ${first_selected(state)}, expected ${rows[5]}`);
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "no message is junk after the motions", Object.values(state.flags).every((flags) => !flags.junk));

  // m, s, a and 1 must change nothing: same selection, folders and flags.
  const before = await instance.ask("state");
  for (const key of ["m", "s", "a", "1"]) await instance.press([key]);
  await sleep(1200);
  const after = await instance.ask("state");
  check(app, kind, "m, s, a and 1 do nothing", same(before.selected, after.selected) && same(before.folders, after.folders) && same(before.flags, after.flags) && same(before.windows, after.windows), "selection, folders, read, flagged, junk, tags and windows compared");

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
  await shot("refusal", "mail window after r with no identity; the refusal notification should show");
  await sleep(2000);
  await shot("refusal_later", "same window two seconds later");
}

async function run_assertions(instance) {
  if (instance.kind === "default") await run_default(instance);
  else await run_no_identity(instance);
}

let all_ok = true;
for (const app of apps) {
  if (!binaries[app] || !existsSync(binaries[app])) throw new Error(`no binary for ${app} at ${binaries[app]}`);
  const kinds = (process.env.E2E_KINDS ?? "default,reply_no_identity").split(",");
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
