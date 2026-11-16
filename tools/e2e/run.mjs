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
const option = (name) => { const at = args.indexOf(name); return at < 0 ? null : args.splice(at, 2)[1]; };
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

// Opens the Inbox with keys only. `folder_row_tabs` Tabs (seven) reach the Local Folders row, Right expands it, Down selects the Inbox and three more Tabs reach the thread list.
// With no identity the New Message button is disabled and skipped by Tab, so the folder row is one Tab sooner.
async function open_inbox(instance, folder_row_tabs = 7) {
  for (let count = 0; count < folder_row_tabs; count++) await instance.press(["-k", "Tab"]);
  await instance.press(["-k", "Right"]);
  await sleep(300);
  await instance.press(["-k", "Down"]);
  await sleep(1500);
  const opened = (await instance.ask("state")).mail_tab?.folder;
  for (let count = 0; count < 3; count++) await instance.press(["-k", "Tab"]);
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
  await instance.press(["g"]);
  let state = await key_and_state(instance, ["g"]);
  let rows = FLAT_ROWS;
  check(app, kind, "g g selects the first row", first_selected(state) === FLAT_ROWS[0], `selected ${JSON.stringify(state.selected.map((m) => m.header_id))}`);
  note(app, kind, "selection of a collapsed or flat thread root", `${state.selected.length} message(s) selected at row 0, listed ${state.listed.length} messages`);

  state = await key_and_state(instance, ["j"]);
  const after_j = first_selected(state);
  const collapsed = after_j === COLLAPSED_ROWS[1];
  rows = collapsed ? COLLAPSED_ROWS : FLAT_ROWS;
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

  // Typing in the quick filter passes through.
  await instance.press(CTRL_SHIFT("k"));
  await sleep(800);
  const filtered = await key_and_state(instance, ["Single 1"], 1500);
  check(app, kind, "typing in the quick filter passes through", filtered.listed.length > 0 && filtered.listed.length < start.listed.length, `listed ${filtered.listed.length} of ${start.listed.length} after typing "Single 1"`);
  await shot("quick_filter", "quick filter holds the typed text and the list is narrowed");
  const bound = await key_and_state(instance, ["x"], 1500);
  check(app, kind, "x typed into the quick filter archives nothing", same(bound.folders["/Inbox"], before.folders["/Inbox"]) && bound.listed.length === 0, `listed ${bound.listed.length}, Inbox ${bound.folders["/Inbox"]?.length}`);
  await instance.press(["-k", "Escape"]);
  await sleep(1000);
  const cleared = await instance.ask("state");
  note(app, kind, "quick filter after Escape", `listed ${cleared.listed.length}`);
  if (cleared.listed.length !== start.listed.length) {
    // Escape did not clear it. Ctrl+Shift+K and Escape again, then return to the list.
    await instance.press(["-k", "Escape"]);
    await sleep(800);
  }
  // Back to the thread list: Shift+Tab from the quick filter is not stable, so use F6 cycling and check by a key.
  await instance.press(["-k", "F6"]);
  await sleep(500);

  // j after the focus changes, then reload, then one j.
  state = await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  note(app, kind, "list focus after the quick filter", `g g selected ${first_selected(state)}`);
  const list_has_focus = first_selected(state) === rows[0];
  if (!list_has_focus) {
    for (let count = 0; count < 3; count++) await instance.press(["-k", "Tab"]);
    await key_and_state(instance, ["g"]);
    state = await key_and_state(instance, ["g"]);
  }
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

  // x archives. A single message (the last row) is selected, so the thread-selection rule does not mix in.
  state = await key_and_state(instance, ["G"]);
  const to_archive = first_selected(state);
  const rows_index_of = (id) => rows.indexOf(id);
  state = await key_and_state(instance, ["x"], 2500);
  const archived_in = Object.entries(state.folders).filter(([, ids]) => ids.includes(to_archive)).map(([path]) => path);
  const archived = archived_in.length === 1 && /Archive/i.test(archived_in[0]);
  check(app, kind, "x archives the selected message", archived, `${to_archive} is in ${JSON.stringify(archived_in)}`);
  check(app, kind, "view.rows answers (x ran act_and_keep_selection)", archived, "x needs view.rows; a failure here means the call was refused");
  note(app, kind, "selection after x", `selected ${JSON.stringify(state.selected.map((m) => m.header_id))} (row ${state.selected.length ? rows_index_of(state.selected[0].header_id) : "none"}); key run, archived row was ${rows_index_of(to_archive)}`);
  await shot("after_x", "list after x");
  if (!archived) {
    // The key failed, so measure what Thunderbird itself leaves selected after an API archive of the same message.
    await instance.ask("api_archive");
    await sleep(2500);
    state = await instance.ask("state");
    note(app, kind, "selection after an API archive (messages.archive, no key)", `selected ${JSON.stringify(state.selected.map((m) => m.header_id))} (row ${state.selected.length ? rows_index_of(state.selected[0].header_id) : "none"}), archived row was ${rows_index_of(to_archive)}`);
    await shot("after_api_archive", "list after archiving through the API");
  }

  // d d moves to Trash.
  state = await key_and_state(instance, ["G"]);
  const to_delete = first_selected(state);
  await instance.press(["d"]);
  await sleep(150);
  state = await key_and_state(instance, ["d"], 2500);
  const in_trash = () => Object.entries(state.folders).filter(([, ids]) => to_delete && ids.includes(to_delete)).map(([path]) => path);
  check(app, kind, "d d moves the selected message to Trash", to_delete !== null && same(in_trash(), ["/Trash"]), `${to_delete} is in ${JSON.stringify(in_trash())}`);
  note(app, kind, "selection after d d", `selected ${JSON.stringify(state.selected.map((m) => m.header_id))} (row ${state.selected.length ? rows_index_of(state.selected[0].header_id) : "none"}); key run, deleted row was ${rows_index_of(to_delete)}`);
  await shot("after_dd", "list after d d");
  if (!same(in_trash(), ["/Trash"])) {
    await instance.ask("api_delete");
    await sleep(2500);
    state = await instance.ask("state");
    note(app, kind, "selection after an API delete (messages.delete, no key)", `selected ${JSON.stringify(state.selected.map((m) => m.header_id))} (row ${state.selected.length ? rows_index_of(state.selected[0].header_id) : "none"}), deleted row was ${rows_index_of(to_delete)}; in ${JSON.stringify(in_trash())}`);
    await shot("after_api_delete", "list after deleting through the API");
  }

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

  // Reading pane: five Tabs from the thread list pass the Reply button, the sender, the recipient and the subject, and reach the message body.
  // The runtime must let the key through there (the target is a browser), so Thunderbird acts on it.
  await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  const pane_list_focus = first_selected(state) === rows[0];
  // Up one from the last row, so a j that runs as a motion shows as a move to the last row.
  await key_and_state(instance, ["G"]);
  state = await key_and_state(instance, ["k"]);
  const pane_message = first_selected(state);
  for (let count = 0; count < 5; count++) await instance.press(["-k", "Tab"]);
  await sleep(500);
  await shot("reading_pane_focus", "message pane shown with focus moved by five Tabs from the list");
  const junk_before = Object.values((await instance.ask("state")).flags).filter((flags) => flags.junk).length;
  state = await key_and_state(instance, ["j"], 2500);
  const junked = Object.entries(state.flags).filter(([, flags]) => flags.junk).map(([id]) => id);
  note(app, kind, "j with focus in the reading pane", `list focus confirmed before: ${pane_list_focus}; message ${pane_message}; junk flags before ${junk_before}, after ${junked.length} ${JSON.stringify(junked)}; selected after ${JSON.stringify(state.selected.map((m) => m.header_id))}; Inbox ${state.folders["/Inbox"]?.length}, Junk-like folders ${JSON.stringify(Object.keys(state.folders))}`);
  await shot("after_reading_pane_j", "state after j with focus in the reading pane");
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
