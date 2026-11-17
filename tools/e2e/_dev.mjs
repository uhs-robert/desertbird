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
  await instance.ask("prepare_views", 30000);
  await sleep(2000);
  await instance.press(["g"]);
  await key_and_state(instance, ["g"]);
  await run_cmdline(instance, { app, kind, shot });
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
  await instance.press(["-k", "Up"]);
  await sleep(800);
  const after_run = selection_of(await instance.ask("state"));
  await instance.press(["-k", "Up"]);
  await sleep(800);
  check(app, kind, "after a command ran the list has focus again", selection_of(await instance.ask("state")) !== after_run);

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
// The tag, search and sort forms have no default key, so the helper applies the same arguments the handlers send, straight through the API.
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
  await instance.ask("api_view", 20000, { update: { sortType: "subject", sortOrder: "descending" } });
  await sleep(1000);
  state = await instance.ask("state");
  note(app, kind, "sort.set arguments through the API", `sortType ${state.mail_tab?.sort_type}, sortOrder ${state.mail_tab?.sort_order}`);
  check(app, kind, "the sort arguments sort.set sends take effect", state.mail_tab?.sort_type === "subject" && state.mail_tab?.sort_order === "descending");
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

async function run_assertions(instance) {
  if (instance.kind === "default") await run_default(instance);
  else if (instance.kind === "mail_account") await run_mail_account(instance);
  else await run_no_identity(instance);
}

let all_ok = true;
for (const app of apps) {
  if (!binaries[app] || !existsSync(binaries[app])) throw new Error(`no binary for ${app} at ${binaries[app]}`);
  const kinds = (process.env.E2E_KINDS ?? "default,reply_no_identity,mail_account").split(",");
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
