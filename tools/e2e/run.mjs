// End-to-end run in a headless labwc session:
//   node tools/e2e/run.mjs [thunderbird|betterbird]... [--xpi path] [--binary app=path]
// With no --xpi it only proves the setup: each app starts in a fresh profile and one screenshot is taken.
// Scratch files go to $E2E_DIR (default /tmp/desertbird-e2e). Thunderbird comes from tools/measure/fetch_thunderbird.sh. Betterbird is /usr/bin/betterbird.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { start_app } from "./harness.mjs";
import { create_timings } from "./timings.mjs";

const e2e_dir = resolve(process.env.E2E_DIR ?? "/tmp/desertbird-e2e");
const measure_dir = resolve(process.env.MEASURE_DIR ?? "/tmp/desertbird-measure");
const timings = create_timings(resolve(process.env.E2E_TIMINGS_FILE ?? join(e2e_dir, "timings.json")));
// Charges the wall time of one default-kind section to the timings file.
const timed = (instance, name, action) => timings.section(instance.app, instance.kind ?? "default", name, action);
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
// After a restart Local Folders is already expanded, and Right would step into the Inbox row, so `expanded` skips it.
async function open_inbox(instance, folder_row_tabs = 7, { expanded = false } = {}) {
  for (let count = 0; count < folder_row_tabs; count++) await instance.press(["-k", "Tab"]);
  if (!expanded) await instance.press(["-k", "Right"]);
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

// Restarts the app and records a check that the process changed, so a skipped restart fails the run.
async function restart_app(instance, app, kind, label) {
  const pid_before = instance.app_pid();
  await instance.restart();
  const pid_after = instance.app_pid();
  const alive = instance.exited() === null;
  check(app, kind, `the app really restarted for the ${label}`, alive && pid_after !== pid_before, `pid ${pid_before} then ${pid_after}, exited ${JSON.stringify(instance.exited())}`);
}

const first_selected = (state) => state.selected[0]?.header_id ?? null;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Thread keys on the fixture Inbox, whose ten threads of four open collapsed. Each key reads its result from the selection, since the fold state has no helper query.
async function run_threads(instance, { app, kind, shot }) {
  const keys = async (sequence, wait_ms = 1500) => {
    for (const key of sequence.slice(0, -1)) await instance.press([key]);
    return first_selected(await key_and_state(instance, [sequence.at(-1)], wait_ms));
  };
  const id_of = (thread, position) => `inbox-t${thread}-m${position}@fixture.invalid`;
  const expect = (name, got, want) => check(app, kind, name, got === want, `selected ${got}, expected ${want}`);
  await keys(["g", "g"]);
  expect("l opens the collapsed thread and j then enters it", (await keys(["l"]), await keys(["j"])), id_of(0, 1));
  expect("h on a reply selects its thread root", await keys(["h"]), id_of(0, 0));
  await keys(["h"]);
  expect("h on a root closes the thread, so j skips its replies", await keys(["j"]), id_of(1, 0));
  expect("] t goes to the next thread root", await keys(["]", "t"]), id_of(2, 0));
  expect("[ t from a root goes to the root before", await keys(["[", "t"]), id_of(1, 0));
  await keys(["l"]);
  await keys(["j"]);
  expect("[ t from a reply goes to its own root", await keys(["[", "t"]), id_of(1, 0));
  await keys(["h"]);
  await keys(["z", "R"]);
  await keys(["g", "g"]);
  expect("z R opens every thread", await keys(["j"]), id_of(0, 1));
  await keys(["z", "M"]);
  await keys(["g", "g"]);
  expect("z M closes every thread", await keys(["j"]), id_of(1, 0));
  await keys(["G"]);
  // Hide the message pane so the list is tall enough to show several rows around the scrolled one.
  await keys(["t", "m"]);
  // The list shows about 21 of the 30 rows, so a row can only reach the top near the start and the bottom near the end.
  for (const [name, sequence, down] of [["top", ["z", "t"], ["5", "j"]], ["center", ["z", "z"], ["1", "5", "j"]], ["bottom", ["z", "b"], ["2", "5", "j"]]]) {
    await keys(["g", "g"]);
    await keys(down);
    await keys(sequence);
    await shot(`z_${name}`, `${down.slice(0, -1).join("")} rows down, then z ${sequence[1]}: the current row sits at the ${name} of the thread list`);
  }
  await keys(["t", "m"]);
  await keys(["g", "g"]);
}

// A hash of the bottom 80 px of the window, where the panel and the toasts draw, without the scrollbar strip. The mode label sits in it too and stays the same while the mode does. Higher up a message pane can still be loading.
async function hud_pixels(instance, name, region = "0,640 1260x80") {
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  return createHash("sha256").update(readFileSync(await instance.shot_region(name, region))).digest("hex");
}

// Escape three times leave no command line open, whatever the list held: the first hides the list, the second closes the line, the third goes to the mail list, where it does nothing.
async function close_command_line(instance) {
  for (let count = 0; count < 3; count++) {
    await instance.press(["-k", "Escape"]);
    await sleep(700);
  }
}

// The region the root key list fills: it is about twelve rows tall above the status bar, taller than the strip of a toast.
const KEY_LIST_REGION = "0,300 1260x420";

// Waits out earlier toasts, presses the key, then reads the toast strip while a toast shows and again after it expired. A toast is proven by the strip differing while it shows and matching the strip from before once the toast time is over.
async function toast_cycle(instance, name, press_args, lead_keys = [], { wait_out_toasts = true } = {}) {
  if (wait_out_toasts) await sleep(7000);
  const before = await hud_pixels(instance, `${name}_before`);
  for (const key of lead_keys) await instance.press([key]);
  const state = await key_and_state(instance, press_args, 1500);
  const during = await hud_pixels(instance, `${name}_during`);
  if (!wait_out_toasts) return { state, shown: during !== before };
  await sleep(6000);
  const after = await hud_pixels(instance, `${name}_after`);
  return { state, shown: during !== before, gone: after === before };
}

async function run_default(instance) {
  const app = instance.app;
  const kind = "default";
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };

  const opened = await open_inbox(instance);
  if (process.env.E2E_ONLY === "steps") return run_steps(instance, { app, kind, shot: async () => "" });
  if (process.env.E2E_ONLY === "panes") return run_panes(instance, { app, kind, shot });
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  const start = await instance.ask("state");
  check(app, kind, "helper add-on and DesertBird both enabled", start.desertbird_enabled === true);
  await shot("inbox_opened");
  // E2E_ONLY=hud runs the which-key, toast and help checks alone, for a quick run of that part.
  if (process.env.E2E_ONLY === "hud") return run_hud(instance, { app, kind, shot });
  if (process.env.E2E_ONLY === "cmdline") return run_cmdline(instance, { app, kind, shot });
  if (process.env.E2E_ONLY === "search") return run_search(instance, { app, kind, shot });
  if (process.env.E2E_ONLY === "mode_label") return run_mode_label(instance, { app, kind, shot });
  if (process.env.E2E_ONLY === "hints") return run_window_hints(instance, { app, kind, shot });
  // Right after the Inbox opens, while the window still has the layout the fixed labels were read from.
  await timed(instance, "window_hints", () => run_window_hints(instance, { app, kind, shot }));
  await timed(instance, "mode_label", () => run_mode_label(instance, { app, kind, shot }));

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
  await timed(instance, "threads", () => run_threads(instance, { app, kind, shot }));
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "no message is junk after the motions", Object.values(state.flags).every((flags) => !flags.junk));

  // s, w and 1 must change nothing: same selection, folders and flags. The m key leads the message state keys now, so a lone m followed by a break key stands in for it: the stray m is dropped. w is unbound in every default tree (a archives, so it cannot stand here).
  const before = await instance.ask("state");
  for (const key of ["s", "m", "w", "1"]) await instance.press([key]);
  await sleep(1200);
  const after = await instance.ask("state");
  check(app, kind, "s, m w and 1 do nothing", same(before.selected, after.selected) && same(before.folders, after.folders) && same(before.flags, after.flags) && same(before.windows, after.windows), "selection, folders, read, flagged, junk, tags and windows compared");

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
  const bound = await key_and_state(instance, ["a"], 1500);
  check(app, kind, "a typed into the quick filter archives nothing", same(bound.folders["/Inbox"], before.folders["/Inbox"]) && bound.listed.length === 0, `listed ${bound.listed.length}, Inbox ${bound.folders["/Inbox"]?.length}`);
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

  // management.setEnabled is refused for an add-on in the profile folder, so the only real restart of DesertBird is a restart of the app.
  await restart_app(instance, app, kind, "reload");
  check(app, kind, "after the restart, the Inbox opens with keys", (await open_inbox(instance, 7, { expanded: true })) === "/Inbox");
  state = await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  const top_after_restart = first_selected(state);
  state = await key_and_state(instance, ["j"]);
  check(app, kind, "after the restart, g g reaches the top and one j moves exactly one row", top_after_restart === rows[0] && first_selected(state) === rows[1], `top ${top_after_restart}, after j ${first_selected(state)}, expected ${rows[1]}`);

  // a and d d at two places: the middle of the list and the last row. The note says which row Thunderbird leaves selected.
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
    for (const command of ["a", "dd"]) {
      state = where === "middle" ? await go_to_row(12) : await key_and_state(instance, ["G"]);
      const target = first_selected(state);
      const target_row = row_of(target);
      const rows_total = live_rows().length;
      if (command === "a") state = await key_and_state(instance, ["a"], 2500);
      else {
        await instance.press(["d"]);
        await sleep(150);
        state = await key_and_state(instance, ["d"], 2500);
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
        await sleep(2500);
        state = await instance.ask("state");
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
  state = await key_and_state(instance, ["aj"], 2500);
  const homes_of = (id) => Object.entries(state.folders).filter(([, ids]) => ids.includes(id)).map(([path]) => path);
  const race_archived = homes_of(race_target).length === 1 && /Archive/i.test(homes_of(race_target)[0]);
  check(app, kind, "a then j at once archives the row a was pressed on and leaves the next one", race_archived && same(homes_of(race_next), ["/Inbox"]), `${race_target} is in ${JSON.stringify(homes_of(race_target))}, ${race_next} is in ${JSON.stringify(homes_of(race_next))}`);
  if (race_archived) gone.add(race_target);
  await shot("after_a_then_j", "list after a and j typed back to back");

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
  check(app, kind, "j with focus in the message body neither junks nor moves the selection", junked.length === junk_before && first_selected(state) === pane_message, `message ${pane_message}, selected after ${first_selected(state)}, junk flags ${junk_before} then ${junked.length}`);
  await shot("after_reading_pane_j", "state after j with focus in the message body");
  // Shift+F6 goes back one pane. j then moves one row, which proves the j above ran one pane after the list, in the message body.
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  await sleep(500);
  state = await key_and_state(instance, ["j"]);
  check(app, kind, "Shift+F6 from the body returns to the list, where j moves one row", first_selected(state) === live_rows().at(-1), `selected ${first_selected(state)}, expected ${live_rows().at(-1)}`);
  await timed(instance, "tabs", () => run_tabs(instance, { check, note, shot, key_and_state }));

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
  await timed(instance, "search", () => run_search(instance, { app, kind, shot }));
  await timed(instance, "view_settings", () => run_view_settings(instance, { app, kind }));
  await shot("after_view_settings", "Views folder after the view setting keys");
  await timed(instance, "cmdline", () => run_cmdline(instance, { app, kind, shot }));
  await timed(instance, "folders", () => run_folders(instance));
  await timed(instance, "hud", () => run_hud(instance, { app, kind, shot }));
  await timed(instance, "followup", () => run_followup(instance));
  await timed(instance, "steps", () => run_steps(instance, { app, kind, shot }));
  await timed(instance, "visual", () => run_visual(instance, { app, kind, shot }));
  await timed(instance, "panes", () => run_panes(instance, { app, kind, shot }));
}

// The stored follow-up record bytes of each add-on, read from the profile. The add-on's `storage.local` is an IndexedDB file there, and the helper add-on cannot read another add-on's storage. The database and its log are copied first, so the read sees the committed state and leaves the file alone. IndexedDB encodes the key with each character one code higher, and the value is compressed, which keeps long runs of an id as copies. So the check looks for the first 20 characters of the id.
function stored_followup_records(profile_dir) {
  const encoded_key = Buffer.from("desertbird_followups", "latin1").map((byte) => byte + 1);
  const records = [];
  const root = join(profile_dir, "storage", "default");
  if (!existsSync(root)) return records;
  for (const entry of readdirSync(root).filter((name) => name.startsWith("moz-extension"))) {
    const idb = join(root, entry, "idb");
    if (!existsSync(idb)) continue;
    for (const file of readdirSync(idb).filter((name) => name.endsWith(".sqlite"))) {
      const copy_dir = mkdtempSync(join(tmpdir(), "db-e2e-idb-"));
      try {
        for (const suffix of ["", "-wal"]) if (existsSync(join(idb, file + suffix))) copyFileSync(join(idb, file + suffix), join(copy_dir, `copy.sqlite${suffix}`));
        const database = new DatabaseSync(join(copy_dir, "copy.sqlite"), { readOnly: true });
        for (const row of database.prepare("select key, data from object_data").all()) if (Buffer.from(row.key).subarray(1).equals(encoded_key)) records.push(Buffer.from(row.data));
        database.close();
      } finally {
        rmSync(copy_dir, { recursive: true, force: true });
      }
    }
  }
  return records;
}

// m f d sets a follow-up reminder and tags nothing yet. m f c cancels. The due fire needs a clock run of a day and `src/` takes no test hook, so the fire is a hand check. The persisted reminder is read from the profile, and a real restart keeps it.
async function run_followup(instance) {
  const app = instance.app;
  const kind = "default";
  let state = await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["g"]);
  state = await key_and_state(instance, ["j"]);
  const target = first_selected(state);
  const tags_before = JSON.stringify(state.flags[target]?.tags ?? []);
  const id_start = Buffer.from(target.slice(0, 20));
  const holds_target = () => stored_followup_records(instance.profile_dir).some((record) => record.includes(id_start));
  await instance.press(["m"]);
  await instance.press(["f"]);
  state = await key_and_state(instance, ["d"], 3000);
  check(app, kind, "m f d tags nothing yet and the app stays up", JSON.stringify(state.flags[target]?.tags ?? []) === tags_before && instance.exited() === null, `tags ${tags_before} then ${JSON.stringify(state.flags[target]?.tags ?? [])}`);
  await sleep(2000);
  check(app, kind, "m f d stores a reminder for the message in the profile", holds_target(), `${target} in the stored record`);
  await restart_app(instance, app, kind, "reminder");
  check(app, kind, "the reminder is still stored after the restart", holds_target());
  await open_inbox(instance, 7, { expanded: true });
  await instance.ask(`select:${target}`, 30000);
  await sleep(700);
  state = await instance.ask("state");
  check(app, kind, "the reminded message is selected again after the restart", first_selected(state) === target, `selected ${first_selected(state)}, expected ${target}`);
  await instance.press(["m"]);
  await instance.press(["f"]);
  state = await key_and_state(instance, ["c"], 3000);
  await sleep(2000);
  check(app, kind, "m f c after the restart leaves the tags alone and the app up", JSON.stringify(state.flags[target]?.tags ?? []) === tags_before && instance.exited() === null, `tags ${JSON.stringify(state.flags[target]?.tags ?? [])}`);
  check(app, kind, "m f c drops the stored reminder", !holds_target(), `${target} is ${holds_target() ? "still" : "no longer"} in the stored record`);
}

// The step keys in the Views folder (6 messages: unread v0 to v2, starred v0 and v1, an attachment on v0). The row order comes from the listing, since earlier checks sorted the folder.
// The oracle walks that order: the steps must visit the matching rows in turn and stay on the last one.
async function run_steps(instance, { app, kind, shot }) {
  await instance.ask("show_folder", 20000, { path: "/Views" });
  await sleep(2000);
  // Showing a folder through the API leaves the focus and the selection where they were, so focus the list and select the first row here.
  await instance.press(["g"]);
  await key_and_state(instance, ["e"], 1000);
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], 1000);
  let state = await instance.ask("state");
  const listed = state.listed;
  const has = { u: (id, now) => now.flags[id]?.read === false, s: (id, now) => now.flags[id]?.flagged === true, a: (id) => id === "views-0@fixture.invalid" };
  // Selecting a message can mark it read, so each press is judged against the flags read just before it.
  const press_step = async (key, backward) => {
    const before = await instance.ask("state");
    const at = before.listed.indexOf(first_selected(before));
    const ahead = backward ? before.listed.slice(0, at).reverse() : before.listed.slice(at + 1);
    const want = ahead.find((id) => has[key](id, before)) ?? first_selected(before);
    await instance.press([backward ? "[" : "]"]);
    const got = first_selected(await key_and_state(instance, [key], 1200));
    return got === want ? null : `from ${first_selected(before)} got ${got}, want ${want}`;
  };
  for (const [key, name] of [["u", "unread"], ["s", "starred"], ["a", "attachment"]]) {
    await instance.press(["g"]);
    await key_and_state(instance, ["g"], 1000);
    for (const backward of [false, true]) {
      const misses = [];
      for (let press = 0; press < 4; press++) misses.push(await press_step(key, backward));
      check(app, kind, `${backward ? "[" : "]"} ${key} goes to the ${backward ? "previous" : "next"} ${name} row and stays at the end`, misses.every((miss) => miss === null), misses.filter(Boolean).join("; ") || `list ${listed.join(" ")}`);
    }
  }
  note(app, kind, "unread counts the step reads", JSON.stringify((await instance.ask("folder_unread")).counts));
  // Earlier checks read every fixture message, so m u first makes one Inbox message unread. ] U from the end of Views must then land on it.
  await instance.ask("show_folder", 20000, { path: "/Inbox" });
  await sleep(2000);
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], 1000);
  await instance.press(["m"]);
  const marked = (await key_and_state(instance, ["u"], 1500)).selected.map((message) => message.header_id);
  await instance.ask("show_folder", 20000, { path: "/Views" });
  await sleep(2000);
  await key_and_state(instance, ["G"], 800);
  await instance.press(["]"]);
  await instance.press(["U"]);
  await sleep(3000);
  const moved = await instance.ask("state");
  const landed = first_selected(moved);
  check(app, kind, "] U with no later unread row opens the folder that has unread mail and selects it", moved.mail_tab?.folder === "/Inbox" && marked.includes(landed), `folder ${moved.mail_tab?.folder}, selected ${landed}, marked unread ${marked.join(" ")}`);
  await shot("step_unread_all_folders", "the folder ] U opened, with an unread message selected");
}

// Visual mode in the Inbox with every thread open, so each row is one message. The commands run on the real list: m s flags the range and a archives it.
async function run_visual(instance, { app, kind, shot }) {
  await instance.ask("show_folder", 20000, { path: "/Inbox" });
  await sleep(2000);
  // "Escape" is a key name for wtype, which needs -k. Typed as text it would send six letters.
  const press_args = (key) => (key === "Escape" ? ["-k", "Escape"] : [key]);
  const keys = async (sequence, wait_ms = 1200) => {
    for (const key of sequence.slice(0, -1)) await instance.press(press_args(key));
    return key_and_state(instance, press_args(sequence.at(-1)), wait_ms);
  };
  await keys(["z", "R"]);
  let state = await keys(["g", "g"]);
  const rows = state.listed;
  const ids = (selected) => selected.map((message) => message.header_id);
  state = await keys(["v"]);
  state = await keys(["j"]);
  state = await keys(["j"]);
  check(app, kind, "v then j j selects the three rows from the top", same(ids(state.selected), rows.slice(0, 3)), `selected ${ids(state.selected).join(" ")}`);
  await shot("visual_range", "three rows selected after v j j");
  state = await keys(["k"]);
  check(app, kind, "k in visual mode shrinks the range back toward the anchor", same(ids(state.selected), rows.slice(0, 2)), `selected ${ids(state.selected).join(" ")}`);
  state = await keys(["Escape"]);
  check(app, kind, "Escape ends visual mode on the current row", same(ids(state.selected), [rows[1]]), `selected ${ids(state.selected).join(" ")}`);
  state = await keys(["j"]);
  check(app, kind, "after Escape j moves one row again", same(ids(state.selected), [rows[2]]), `selected ${ids(state.selected).join(" ")}`);
  // A range upward from row 5, then m s flags the whole range and keeps the mode on.
  await keys(["g", "g"]);
  await keys(["5", "j"]);
  await keys(["v"]);
  await keys(["2", "k"]);
  const range = ids((await instance.ask("state")).selected);
  check(app, kind, "v then 2 k selects rows 3 to 5", same(range, rows.slice(3, 6)), `selected ${range.join(" ")}`);
  const flagged_before = range.map((id) => state.flags[id]?.flagged === true);
  await instance.press(["m"]);
  state = await key_and_state(instance, ["s"], 2000);
  const flagged_after = range.map((id) => state.flags[id]?.flagged === true);
  check(app, kind, "m s in visual mode flags every message of the range", flagged_after.every(Boolean), `before ${flagged_before.join()}, after ${flagged_after.join()}`);
  check(app, kind, "m s keeps the range selected", same(ids(state.selected), range), `selected ${ids(state.selected).join(" ")}`);
  state = await keys(["Escape"]);
  state = await keys(["j"]);
  check(app, kind, "Escape ends visual mode, so j selects one row", state.selected.length === 1, `selected ${state.selected.length}`);
  // a archives the range once. `.` then archives once more, the one row selected at the dot, since u can undo it.
  await keys(["g", "g"]);
  await keys(["v"]);
  await keys(["j"]);
  const archive_range = ids((await keys(["j"])).selected);
  state = await keys(["a"], 3000);
  const in_inbox = archive_range.filter((id) => state.folders["/Inbox"]?.includes(id));
  check(app, kind, "a in visual mode archives the whole range", archive_range.length === 3 && in_inbox.length === 0, `range ${archive_range.join(" ")}, still in the Inbox ${in_inbox.join(" ")}`);
  const after_x = state.folders["/Inbox"]?.length;
  state = await keys(["."], 3000);
  check(app, kind, ". after a in visual mode archives the one selected row", state.folders["/Inbox"]?.length === after_x - 1, `Inbox ${after_x} then ${state.folders["/Inbox"]?.length}`);
  await shot("visual_after_a", "Inbox after a archived the range");
  check(app, kind, "the app survived visual mode", instance.exited() === null);
}

// Pane focus, folder row folds, undo and the fixed pages. Native Down moves the selection of the pane that has focus, so it tells which pane a key focused.
async function run_panes(instance, { app, kind, shot }) {
  const folder_of = (state) => state.mail_tab?.folder ?? null;
  const press_state = (args, wait_ms = 1200) => key_and_state(instance, args, wait_ms);
  const down = () => press_state(["-k", "Down"]);
  const up = () => press_state(["-k", "Up"]);
  const keys = async (sequence, wait_ms = 1200) => {
    for (const key of sequence.slice(0, -1)) await instance.press([key]);
    return press_state([sequence.at(-1)], wait_ms);
  };
  const tabs_of = (state) => state.windows.flatMap((window) => window.tabs.map((tab) => tab.raw.url ?? tab.title));
  const in_folder = (state, id, path) => state.folders[path]?.includes(id) === true;

  await instance.ask("show_folder", 20000, { path: "/Inbox" });
  await sleep(2000);
  await keys(["g", "e"]);
  await keys(["g", "g"]);
  await keys(["g", "f"]);
  let state = await down();
  check(app, kind, "g f puts the focus in the folder pane: Down moves the folder, not the list", folder_of(state) !== "/Inbox" && folder_of(state) !== null, `folder ${folder_of(state)}`);
  await up();
  // The row above the Inbox is the account row. h closes it, so Down finds no row below. l opens it, so Down reaches the Inbox.
  state = await up();
  const account_folder = folder_of(state);
  await keys(["h"]);
  await shot("panes_h", "the account row closed by h in the folder pane");
  state = await down();
  check(app, kind, "h in the folder pane closes the selected row, so Down stays on it", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  await up();
  await keys(["l"]);
  await shot("panes_l", "the account row opened by l in the folder pane");
  state = await down();
  check(app, kind, "l in the folder pane opens the selected row, so Down reaches the Inbox", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);

  // j, k, g g and G move the folder selection while the folder pane has the focus. The account row is the first row and the Inbox the second.
  state = await keys(["j"]);
  const below_inbox = folder_of(state);
  check(app, kind, "j in the folder pane moves the folder selection down", ![null, "/Inbox", account_folder].includes(below_inbox), `folder ${below_inbox}`);
  state = await keys(["k"]);
  check(app, kind, "k in the folder pane moves the folder selection up", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);
  state = await keys(["G"]);
  // Views is the last folder of the fixture. The thread list shows its messages, so the selection also opened the folder.
  const views_listed = same([...state.listed].sort(), [...(state.folders["/Views"] ?? [])].sort());
  check(app, kind, "G in the folder pane selects the last folder and the list shows it", folder_of(state) === "/Views" && views_listed, `folder ${folder_of(state)}, list shows the Views messages ${views_listed}`);
  await shot("panes_folder_G", "the last folder selected by G in the folder pane");
  state = await keys(["g", "g"]);
  check(app, kind, "g g in the folder pane selects the account row", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  state = await keys(["j"], 2000);
  check(app, kind, "the folder pane keeps the focus after the motions, so j reaches the Inbox", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);

  // z M, z R and H fold folders. Native Down tells the tree state: with the account row closed it finds no row below, with it open it reaches the Inbox.
  await keys(["g", "g"]);
  await keys(["z", "M"]);
  await shot("panes_zM", "every folder closed by z M");
  state = await down();
  check(app, kind, "z M in the folder pane closes every folder, so Down stays on the account row", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  await shot("panes_zM_down", "the folder pane after Down from the closed account row");
  await keys(["z", "R"]);
  state = await down();
  check(app, kind, "z R in the folder pane opens every folder, so Down reaches the Inbox", folder_of(state) === "/Inbox", `folder ${folder_of(state)}`);
  await keys(["g", "g"]);
  await keys(["H"]);
  state = await down();
  check(app, kind, "H on an open folder closes it, so Down stays on it", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  await keys(["z", "R"]);
  await keys(["g", "g"]);
  await keys(["j"]);
  state = await keys(["H"]);
  check(app, kind, "H on a child of an open folder closes the parent and selects it", folder_of(state) === account_folder, `folder ${account_folder} then ${folder_of(state)}`);
  state = await down();
  check(app, kind, "after H on the child the parent stays closed, so Down stays on it", folder_of(state) === account_folder, `folder ${folder_of(state)}`);
  await keys(["z", "R"]);
  await keys(["g", "g"]);
  await keys(["j"]);

  // <C-d> and <C-u> in the thread list move ten rows: the fixture list is ten threads, so the first row goes to the last and back.
  await keys(["L"]);
  const top_state = await keys(["g", "g"]);
  const first_row = first_selected(top_state);
  const row_ids = top_state.listed;
  const expected_down = row_ids[Math.min(row_ids.indexOf(first_row) + 10, row_ids.length - 1)];
  const after_down = first_selected(await press_state(CTRL("d"), 1500));
  check(app, kind, "<C-d> in the thread list moves the selection ten rows down", after_down !== null && after_down === expected_down, `selected ${first_row} then ${after_down}, expected ${expected_down} of ${row_ids.length} rows`);
  const after_up = first_selected(await press_state(CTRL("u"), 1500));
  check(app, kind, "<C-u> in the thread list moves the selection back up", after_up === first_row, `selected ${first_row} then ${after_down} then ${after_up}`);
  await shot("panes_ctrl_d_u", "the selection after <C-d> then <C-u>");
  await keys(["H"]);

  // The pane chords name a pane. Native Down tells which pane has the focus: it moves the folder or the list selection, and in the message it moves no row.
  const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
  const list_moved = async (name, row_before) => {
    const after = first_selected(await down());
    check(app, kind, name, after !== row_before && after !== null, `selected ${row_before} then ${after}`);
  };
  await keys(["L"]);
  await list_moved("L in the folder pane focuses the thread list: Down moves the selection", first_selected(await keys(["g", "g"])));
  await keys(["H"]);
  state = await down();
  check(app, kind, "H in the thread list focuses the folder pane: Down moves the folder", ![null, "/Inbox"].includes(folder_of(state)), `folder ${folder_of(state)}`);
  await up();
  await list_moved("A-h in the folder pane focuses the thread list: Down moves the selection", first_selected(await press_state(ALT("h"))));
  // The message pane takes the focus only with one message shown: the Inbox threads open collapsed and show a summary, so each entry starts on the second last row, a single message. Down in the message moves no row, which proves A-l reached it.
  const enter_message = async () => {
    await keys(["G"]);
    const row = first_selected(await keys(["k"], 1500));
    await press_state(ALT("l"), 1500);
    return { row, in_message: first_selected(await down()) === row };
  };
  let entered = await enter_message();
  check(app, kind, "A-l in the thread list focuses the message pane: Down leaves the selection alone", entered.in_message, `selected ${entered.row}`);
  await shot("panes_alt_l", "the message pane focused by A-l");
  // The body script takes the keys in the message, so the chords are bound there too.
  await list_moved("A-h in the message pane focuses the thread list: Down moves the selection", first_selected(await press_state(ALT("h"), 1500)));
  entered = await enter_message();
  await keys(["L"], 1500);
  state = await down();
  check(app, kind, "L in the message pane focuses the thread list: Down moves the selection", entered.in_message && first_selected(state) !== entered.row, `in the message ${entered.in_message}, selected ${entered.row} then ${first_selected(state)}`);
  entered = await enter_message();
  await keys(["H"], 1500);
  state = await down();
  check(app, kind, "H in the message pane focuses the folder pane: Down moves the folder", entered.in_message && ![null, "/Inbox"].includes(folder_of(state)), `in the message ${entered.in_message}, folder ${folder_of(state)}`);
  await up();
  await keys(["L"]);

  // A hidden pane takes no focus: the keys stay in the thread list, so Down moves the selection. Each check starts on the first row, so Down has a row to reach.
  await keys(["g", "g"]);
  state = await keys(["t", "f"], 1500);
  const folder_pane_hidden = state.mail_tab?.folder_pane_visible === false;
  let list_row = first_selected(await keys(["H"], 1500));
  state = await down();
  check(app, kind, "H with the folder pane hidden leaves the focus in the thread list", folder_pane_hidden && first_selected(state) !== list_row && folder_of(state) === "/Inbox", `hidden ${folder_pane_hidden}, selected ${list_row} then ${first_selected(state)}, folder ${folder_of(state)}`);
  await shot("panes_hidden_folder_H", "H with the folder pane hidden: a toast refuses it");
  await keys(["t", "f"], 1500);
  await keys(["g", "g"]);
  state = await keys(["t", "m"], 1500);
  const message_pane_hidden = state.mail_tab?.message_pane_visible === false;
  list_row = first_selected(await press_state(ALT("l"), 1500));
  await shot("panes_hidden_message_alt_l", "A-l with the message pane hidden: a toast refuses it");
  state = await down();
  check(app, kind, "A-l with the message pane hidden leaves the focus in the thread list", message_pane_hidden && first_selected(state) !== list_row, `hidden ${message_pane_hidden}, selected ${list_row} then ${first_selected(state)}, folder ${folder_of(state)}`);
  await keys(["t", "m"], 1500);

  // A chord typed into a text field passes through to it: H types into the quick filter. After each chord an a typed next must still reach the field: no subject holds "Ha", so the list empties. Had the focus left for the list, a would archive instead.
  const listed_before = (await keys(["g", "g"])).listed.length;
  await instance.press(CTRL_SHIFT("k"));
  await sleep(800);
  state = await press_state(["H"], 1500);
  check(app, kind, "H in the quick filter types into it: the list narrows and the folder stays", state.listed.length < listed_before && folder_of(state) === "/Inbox", `listed ${listed_before} then ${state.listed.length}, folder ${folder_of(state)}`);
  state = await press_state(["a"], 1500);
  check(app, kind, "after H the quick filter keeps the focus: a types into it", state.listed.length === 0, `listed ${state.listed.length}`);
  await press_state(["-k", "BackSpace"], 1500);
  await press_state(ALT("l"), 1500);
  state = await press_state(["a"], 1500);
  check(app, kind, "after A-l the quick filter keeps the focus: a types into it", state.listed.length === 0 && folder_of(state) === "/Inbox", `listed ${state.listed.length}, folder ${folder_of(state)}`);
  await shot("panes_quick_filter_H", "H typed into the quick filter");
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  await instance.press(["-k", "Escape"]);
  await sleep(800);

  const list_before = first_selected(await keys(["g", "e"]));
  state = await down();
  check(app, kind, "g e puts the focus in the thread list: Down moves the selection and not the folder", first_selected(state) !== list_before && folder_of(state) === "/Inbox", `selected ${list_before} then ${first_selected(state)}, folder ${folder_of(state)}`);
  await keys(["G"]);
  const message_before = first_selected(await keys(["g", "m"]));
  state = await down();
  check(app, kind, "g m puts the focus in the message pane: Down leaves the selection alone", first_selected(state) === message_before, `selected ${message_before} then ${first_selected(state)}`);
  await shot("panes_gm", "the message pane focused by g m");
  await keys(["g", "e"]);

  // Each page opens in a tab of the window. The reset closes it so the next key runs in the mail tab.
  for (const [key, page, address] of [["a", "addons", "about:addons"], ["t", "themes", "about:addons"], ["c", "config", "about:config"]]) {
    state = await keys(["g", "p", key], 3000);
    check(app, kind, `g p ${key} opens the ${page} page in a tab`, tabs_of(state).includes(address), `tabs ${tabs_of(state).join(" ")}`);
    await shot(`panes_gp${key}`, `the page g p ${key} opened`);
    await instance.ask("reset_tabs");
    await sleep(1500);
    await keys(["g", "e"]);
  }
  // The leader: , h opens the help page and , s the options page, each in a tab of the window.
  for (const [key, page, fragment] of [["h", "help", "help/help.html"], ["s", "options", "options"]]) {
    state = await keys([",", key], 3000);
    check(app, kind, `, ${key} opens the ${page} page in a tab`, tabs_of(state).some((address) => address.startsWith("moz-extension:") && address.includes(fragment)), `tabs ${tabs_of(state).join(" ")}`);
    await instance.ask("reset_tabs");
    await sleep(1500);
    await keys(["g", "e"]);
  }
  state = await keys(["g", "C"], 2500);
  note(app, kind, "g C", `tabs after: ${tabs_of(state).length}; the conversation command is ${tabs_of(state).length > 1 ? "enabled and opened a tab" : "disabled, so it opened nothing"}`);
  await instance.ask("reset_tabs");
  await sleep(1500);
  await keys(["g", "e"]);

  // u and :undo run DesertBird's own undo log. d d, a and the API delete record a step there. A delete by the native Delete key is Thunderbird's, so u leaves it alone.
  const undo_typed = async () => {
    await instance.press([":"]);
    await sleep(1200);
    await instance.press(["undo"]);
    await instance.press(["-k", "Return"]);
    await sleep(3000);
    return instance.ask("state");
  };
  await keys(["g", "t"]);
  await keys(["g", "i"], 2500);
  await keys(["g", "g"]);
  const messages_in_inbox = (current) => current.folders["/Inbox"].length;
  let victim = first_selected(await keys(["j"]));
  state = await keys(["d", "d"], 3000);
  const in_trash = in_folder(state, victim, "/Trash");
  state = await keys(["u"], 4000);
  check(app, kind, "u after d d moves the message back from Trash to the Inbox", in_trash && in_folder(state, victim, "/Inbox") && !in_folder(state, victim, "/Trash"), `${victim} in Trash after d d ${in_trash}, in the Inbox after u ${in_folder(state, victim, "/Inbox")}`);
  await shot("undo_after_dd", "Inbox after d d then u");
  await keys(["g", "e"]);
  await keys(["g", "g"]);
  victim = first_selected(await keys(["j"]));
  state = await keys(["a"], 3000);
  const archived = !in_folder(state, victim, "/Inbox");
  state = await keys(["u"], 4000);
  check(app, kind, "u after a moves the message back from Archives to the Inbox", archived && in_folder(state, victim, "/Inbox"), `${victim} out of the Inbox after a ${archived}, in the Inbox after u ${in_folder(state, victim, "/Inbox")}`);
  // A count reaches the rows below the current one. The fixture threads open collapsed, so z R opens them first: a count refuses to reach into a closed thread.
  await keys(["z", "R"]);
  await keys(["g", "g"]);
  state = await keys(["j"]);
  const counted = state.listed.slice(state.listed.indexOf(first_selected(state)), state.listed.indexOf(first_selected(state)) + 2);
  state = await keys(["2", "a"], 3000);
  const counted_archived = counted.filter((id) => !in_folder(state, id, "/Inbox"));
  state = await keys(["u"], 4000);
  check(app, kind, "2 a archives the current row and the one below, and one u brings both back", counted.length === 2 && counted_archived.length === 2 && counted.every((id) => in_folder(state, id, "/Inbox")), `rows ${counted.join(" ")}, archived ${counted_archived.join(" ")}, back ${counted.filter((id) => in_folder(state, id, "/Inbox")).join(" ")}`);
  await keys(["g", "e"]);
  await keys(["g", "g"]);
  victim = first_selected(await keys(["j"]));
  state = await keys(["d", "d"], 3000);
  state = await undo_typed();
  check(app, kind, ":undo after d d moves the message back too", in_folder(state, victim, "/Inbox"), `${victim} in the Inbox after :undo ${in_folder(state, victim, "/Inbox")}`);
  const inbox_before = messages_in_inbox(state);
  // One stack serves the whole run, so the next u steps back to an older entry: the archive that . made in visual mode.
  state = await keys(["u"], 4000);
  check(app, kind, "the next u undoes the older . archive, one message back in the Inbox", messages_in_inbox(state) === inbox_before + 1, `Inbox ${inbox_before} then ${messages_in_inbox(state)}`);
  // Empty the stack: it holds at most 20 entries, and a step whose message is gone takes a second u to drop.
  for (let press = 0; press < 42; press++) {
    await instance.press(["u"]);
    await sleep(800);
  }
  await sleep(3000);
  await keys(["g", "e"]);
  await keys(["g", "g"]);
  victim = first_selected(await keys(["j"]));
  await instance.press(["-k", "Delete"]);
  await sleep(4000);
  state = await instance.ask("state");
  const deleted = !in_folder(state, victim, "/Inbox");
  const inbox_after_delete = messages_in_inbox(state);
  state = await keys(["u"], 4000);
  check(app, kind, "with the stack empty, u leaves a native Delete to Thunderbird and changes no mail", deleted && !in_folder(state, victim, "/Inbox") && messages_in_inbox(state) === inbox_after_delete, `${victim} out of the Inbox after Delete ${deleted}, in the Inbox after u ${in_folder(state, victim, "/Inbox")}, Inbox ${inbox_after_delete} then ${messages_in_inbox(state)}`);
}

// Timing for the step keys on the scale fixture (E2E_SCALE=1: a folder of 10,000 messages, 3 of every 10 unread and 1 in 25 starred, plus 50 folders of 100). Each time is the wall time from the key to the selection change, polled through the light selection command.
async function run_scale(instance) {
  const app = instance.app;
  const kind = "default";
  const selection = () => instance.ask("selection", 60000);
  await open_inbox(instance);
  await instance.ask("show_folder", 20000, { path: "/Big" });
  await sleep(10000);
  const timed = async (name, keys, expect = null) => {
    const before = await selection();
    for (const key of keys.slice(0, -1)) await instance.press([key]);
    const started = Date.now();
    await instance.press([keys.at(-1)]);
    let now = before;
    while (Date.now() - started < 40000 && same(now.ids, before.ids) && now.folder === before.folder) now = await selection();
    const elapsed = Date.now() - started;
    note(app, kind, `time ${name}`, `${elapsed} ms, now ${now.folder} ${now.ids.slice(0, 2).join(" ")}`);
    if (expect !== null) check(app, kind, `${name} selects ${expect}`, now.ids[0] === expect, `selected ${now.ids[0]}`);
    return now;
  };
  await instance.press(["g"]);
  await timed("g g", ["g"]);
  await timed("j (baseline)", ["j"]);
  await timed("] u (next unread, 1 row away)", ["]", "u"]);
  await timed("] s (next starred, up to 25 rows away)", ["]", "s"]);
  await timed("2000 ] u (a pass over 6,000 rows)", ["2", "0", "0", "0", "]", "u"]);
  await timed("] U with unread rows ahead", ["]", "U"]);
  await timed("G", ["G"]);
  await timed("] U from the last row (no unread ahead: folder counts, then one query)", ["]", "U"]);
  await timed("[ U back across folders", ["[", "U"]);
}

// The mode label at the start of the status bar. It is an element in the window and not a page, so a check reads its pixels: the strip at the start of the bar draws the same twice when the label did not change. The default kind (classic style, shown in every mode) leaves its strips in `label_reference`, and the style kinds compare against them. The strip stops short of the status text, which shows "Loading Message..." after a selection moves.
const LABEL_STRIP = "50,692 100x24";
// The strip is 100 px wide so the status text, which the badge style leaves closer, stays out of it. The second main window opens 64 px to the right.
const LABEL_PIECE = LABEL_STRIP;
const SECOND_WINDOW_PIECE = "114,692 100x24";
const label_reference = {};
// The themed kind draws the badge in an Oasis theme other than the default, and a check reads the badge fill pixels against the theme's mode roles for the scheme Thunderbird shows.
const THEMED_LABEL = "oasis_sol";
const MODE_LABEL_KINDS = { mode_label_badge: { desertbird_settings: { mode_indicator_style: "badge" } }, mode_label_off: { desertbird_settings: { mode_indicator: "off" } }, mode_label_themed: { desertbird_settings: { mode_indicator_style: "badge", theme: THEMED_LABEL } } };

// The colors of a grim ppm capture (P6: a three line text header, then raw RGB) as a map from "#rrggbb" to its pixel count.
function ppm_colors(path) {
  const ppm = readFileSync(path);
  let body = 0;
  for (let newlines = 0; newlines < 3; body++) if (ppm[body] === 10) newlines++;
  const counts = new Map();
  for (let at = body; at + 2 < ppm.length; at += 3) {
    const color = `#${ppm.subarray(at, at + 3).toString("hex")}`;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return counts;
}
const luminance_of = (color) => [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255).reduce((sum, channel, index) => sum + [0.2126, 0.7152, 0.0722][index] * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0);
async function run_mode_label(instance, { app, kind, shot }) {
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const strip_of = async (name, region = LABEL_STRIP) => createHash("sha256").update(readFileSync(await instance.shot_region(`${app}_${kind}_label_${name}`, region))).digest("hex");
  // The themed kind reads raw pixels of the same strips, so these captures are separate files.
  const raw = {};
  const raw_strip = async (name) => { if (kind === "mode_label_themed") raw[name] = ppm_colors(await instance.shot_region(`${app}_${kind}_label_${name}_raw`, LABEL_STRIP, "ppm")); };
  const settle = () => sleep(900);
  await sleep(1500);
  const normal = await strip_of("normal");
  await raw_strip("normal");
  await shot(`label_${kind}_normal`, `the label in normal mode (${kind})`);
  // v starts visual mode, Escape ends it.
  await instance.press(["v"]);
  await settle();
  const visual = await strip_of("visual");
  await raw_strip("visual");
  await shot(`label_${kind}_visual`, `the label in visual mode (${kind})`);
  await instance.press(["v"]);
  await settle();
  const after_v = await strip_of("after_v");
  await instance.press(["v"]);
  await instance.press(["-k", "Escape"]);
  await settle();
  const after_escape = await strip_of("after_escape");
  // The quick filter is a text field: focus moving in is insert mode, and Escape in the empty filter returns focus to the list.
  await instance.press(CTRL_SHIFT("k"));
  await settle();
  const insert = await strip_of("insert");
  await raw_strip("insert");
  await shot(`label_${kind}_insert`, `the label with focus in the quick filter (${kind})`);
  await instance.press(["-k", "Escape"]);
  await settle();
  const after_insert = await strip_of("after_insert");
  // A main window that opens after the add-on started gets its own label.
  const piece = await strip_of("piece", LABEL_PIECE);
  const second = (await instance.ask("open_normal_window", 45000)).opened;
  await sleep(4000);
  const in_second_window = await strip_of("second_window", SECOND_WINDOW_PIECE);
  await shot(`label_${kind}_second_window`, `a second main window opened after the add-on started (${kind})`);
  await instance.ask("close_normal_window", 10000, { id: second });
  await sleep(2000);
  const after_second_window = await strip_of("after_second_window", LABEL_PIECE);
  const shows = kind !== "mode_label_off";
  check(app, kind, "v changes the label, and v again and Escape each bring it back", shows ? visual !== normal && after_v === normal && after_escape === normal : visual === normal && after_escape === normal, `normal ${normal.slice(0, 8)}, visual ${visual.slice(0, 8)}, after v ${after_v.slice(0, 8)}, after Escape ${after_escape.slice(0, 8)}`);
  check(app, kind, "focus in a text field changes the label to insert and back", shows ? insert !== normal && insert !== visual && after_insert === normal : insert === normal && after_insert === normal, `normal ${normal.slice(0, 8)}, insert ${insert.slice(0, 8)}, after ${after_insert.slice(0, 8)}`);
  // With the label off the strip holds only the bar, which the offset window does not draw the same, so only the first window's strip is compared.
  check(app, kind, "a window opened after the add-on started has the label, and the first window keeps its one", (!shows || in_second_window === piece) && after_second_window === piece, `first window ${piece.slice(0, 8)}, second window ${in_second_window.slice(0, 8)}, first after ${after_second_window.slice(0, 8)}`);
  if (kind === "default") Object.assign(label_reference, { [app]: { normal, visual, insert } });
  else {
    const reference = label_reference[app];
    if (reference === undefined) return note(app, kind, "no default strips to compare with", "the default kind did not run first");
    if (kind === "mode_label_off") check(app, kind, "the off indicator draws no label", normal !== reference.normal && insert === normal, `reference ${reference.normal.slice(0, 8)}, now ${normal.slice(0, 8)}`);
    else check(app, kind, "the badge style draws a label unlike the classic one in every mode", normal !== reference.normal && visual !== reference.visual && insert !== reference.insert, "strips compared with the default kind");
  }
  if (kind === "mode_label_themed") {
    const { resolve_theme, contrast_ratio } = await import("../../src/background/theme/palette.ts");
    const theme = resolve_theme(THEMED_LABEL);
    // The most common color of the strip is the status bar, and its lightness tells the scheme Thunderbird shows. The OS scheme may differ (E2E_THEME=tb_dark_os_light), so a label in the wrong scheme fails here.
    const normal_colors = raw.normal;
    const [bar_color] = [...normal_colors].sort((a, b) => b[1] - a[1])[0];
    const scheme = luminance_of(bar_color) < 0.2 ? "dark" : "light";
    const wanted = { normal: theme[scheme].mode_normal, visual: theme[scheme].mode_visual, insert: theme[scheme].mode_insert };
    const seen = raw;
    for (const mode of ["normal", "visual", "insert"]) {
      const other = theme[scheme === "dark" ? "light" : "dark"][`mode_${mode}`];
      check(app, kind, `the ${mode} badge fill reads at 4.5 to 1 or better on the status bar`, contrast_ratio(wanted[mode], bar_color) >= 4.5, `${wanted[mode]} on ${bar_color}`);
      check(app, kind, `the ${mode} badge fills with the ${THEMED_LABEL} ${scheme} color for the ${scheme} status bar (${bar_color})`, seen[mode].has(wanted[mode]) && !seen[mode].has(other), `wanted ${wanted[mode]}, the other scheme has ${other}`);
    }
  }
  check(app, kind, "the app survived the mode label checks", instance.exited() === null);
}

// The which-key panel, the root key list, a toast and the help page, in the Inbox with the thread list focused. The screenshots carry the E2E_THEME name. A panel is shown or gone when the window's pixels differ or match: the same selection and no panel draws the same window.
async function run_hud(instance, { app, kind, shot }) {
  const theme = process.env.E2E_THEME ?? "default";
  const pixels_of = (name) => hud_pixels(instance, `${app}_${name}_${theme}`);
  await instance.press(["g"]);
  await instance.press(["g"]);
  // A toast from an earlier step lasts up to 6 s, and it would change the reference pixels when it expires.
  await sleep(7000);
  const bare = await pixels_of("hud_bare");
  // g is a prefix key: after the which-key delay (300 ms) the panel lists the keys that can follow.
  await instance.press(["g"]);
  await sleep(1500);
  await shot(`hud_which_key_${theme}`, "the which-key panel after g: the keys that can follow");
  check(app, kind, "after g and the delay the which-key panel shows", (await pixels_of("hud_which_key_pixels")) !== bare);
  await instance.press(["-k", "Escape"]);
  await sleep(1200);
  check(app, kind, "Escape after g closes the panel", (await pixels_of("hud_after_escape")) === bare);
  // The sequence completes while the panel shows: the panel goes and the command runs.
  await instance.press(["g"]);
  await sleep(1500);
  await instance.press(["g"]);
  await sleep(1200);
  check(app, kind, "g then g with the panel up closes it", (await pixels_of("hud_after_complete")) === bare);
  // A key that leads nowhere cancels the sequence before the delay: no panel ever shows. The key is w, which nothing binds, alone or after g (g s opens the Sent folder). A prefix key such as z would start a new sequence and show its own panel.
  await instance.press(["g"]);
  await instance.press(["w"]);
  await sleep(1500);
  check(app, kind, "g w before the delay shows no panel", (await pixels_of("hud_after_stray")) === bare);
  // C-j with only the main mail tab is refused, so a toast shows for toast_error_ms (6 s).
  await instance.press(CTRL("j"));
  await sleep(1000);
  await shot(`hud_toast_${theme}`, "a toast: C-j with one tab is refused");
  check(app, kind, "a refused command shows a toast", (await pixels_of("hud_toast_pixels")) !== bare);
  await sleep(7000);
  check(app, kind, "the toast is gone after toast_error_ms", (await pixels_of("hud_toast_gone")) === bare);
  // The hud lets keys and clicks through. With a toast up, j still moves the list. With the which-key panel up, a key that is no continuation still runs as a first key.
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  await instance.press(["q"]);
  await sleep(800);
  const before_j = selection_of(await instance.ask("state"));
  await instance.press(["j"]);
  await sleep(600);
  check(app, kind, "j moves the list while a toast shows", selection_of(await instance.ask("state")) !== before_j);
  await sleep(7000);
  const before_g_j = selection_of(await instance.ask("state"));
  await instance.press(["g"]);
  await sleep(1200);
  await instance.press(["j"]);
  await sleep(600);
  check(app, kind, "j moves the list while the which-key panel shows", selection_of(await instance.ask("state")) !== before_g_j);
  // A click on a folder row, which sits under the hud box, reaches the folder pane while a toast shows. The Views folder is the one shown at this point of a full run, so another folder is the target.
  const displayed = (await instance.ask("state")).mail_tab?.folder;
  await instance.press(["q"]);
  await sleep(800);
  await instance.click(130, displayed === "/Views" ? 224 : 252);
  // The folder change is polled for up to 8 s, so a slow repaint is not a failure, while a click the hud swallows never changes the folder.
  let folder_after = displayed;
  for (const deadline = Date.now() + 8000; folder_after === displayed && Date.now() < deadline; ) {
    await sleep(250);
    folder_after = (await instance.ask("state")).mail_tab?.folder;
  }
  check(app, kind, "a click under the toast reaches the folder pane", folder_after !== displayed, `displayed folder was ${displayed}, after ${folder_after}`);
  await sleep(6000);
  // g ? shows the root key list in the window. ? is a backward search now.
  await instance.press(["g"]);
  await instance.press(["?"]);
  await sleep(2500);
  await shot(`hud_key_list_${theme}`, "the root key list panel");
  const key_list_shown = await hud_pixels(instance, `${app}_key_list_shown_${theme}`, KEY_LIST_REGION);
  await instance.press(["-k", "Escape"]);
  await sleep(1500);
  check(app, kind, "the next key after g ? removes the key list", (await hud_pixels(instance, `${app}_key_list_gone_${theme}`, KEY_LIST_REGION)) !== key_list_shown);
  check(app, kind, "the app survived the hud keys", instance.exited() === null);
  // The click above moved the shown folder, and the steps after this one start in the Inbox.
  await instance.press(["g"]);
  await instance.press(["i"]);
  await sleep(1500);
}

// The command line, in the Views folder that run_view_settings leaves shown. `:` opens the overlay over the window and the keys go to it. Esc closes it and the list has focus again. A typed command runs.
// Focus back in the list is measured with Thunderbird's own Down key: it moves the list selection only while the list has focus, and the overlay is gone from the focus chain by then.
// / and ? search the thread list with the Quick Filter: rows narrow while typing, Escape restores, Enter keeps the filter and selects, n and N step. The fixture subjects "Single 1" and "Single 10".."Single 19" give 11 rows in the Inbox.
async function run_search(instance, { app, kind, shot }) {
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  const open_search = async (key, text) => {
    await instance.press([key]);
    await sleep(1200);
    await instance.press([text]);
    await sleep(1200);
  };
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], 600);
  const full = (await instance.ask("state")).listed.length;
  await open_search("/", "Single 1");
  let state = await instance.ask("state");
  check(app, kind, "/ then text narrows the list while the line is open", state.listed.length > 0 && state.listed.length < full, `listed ${state.listed.length} of ${full}`);
  await shot("search_typing", "the search line at the bottom with the narrowed list above it");
  await instance.press(["-k", "Escape"]);
  await sleep(1200);
  state = await instance.ask("state");
  check(app, kind, "Escape restores the earlier list", state.listed.length === full, `listed ${state.listed.length}, expected ${full}`);
  await shot("search_escaped", "the full list after Escape, with no search line");
  const before_j = selection_of(await instance.ask("state"));
  state = await key_and_state(instance, ["j"], 800);
  check(app, kind, "after Escape a bound key runs again", selection_of(state) !== "" && selection_of(state) !== before_j, `selected ${before_j} then ${selection_of(state)}`);

  // The typed text sits on top of the filter that was set before.
  await instance.press(["F"]);
  await key_and_state(instance, ["u"], 1200);
  const unread = (await instance.ask("state")).listed.length;
  await open_search("/", "Single");
  await instance.press(["-k", "Escape"]);
  await sleep(1200);
  state = await instance.ask("state");
  check(app, kind, "Escape after F u restores the unread list", state.listed.length === unread, `listed ${state.listed.length}, expected ${unread}`);
  await instance.press(["F"]);
  await key_and_state(instance, ["r"], 1200);

  await open_search("/", "Single 1");
  const narrowed = (await instance.ask("state")).listed;
  await instance.press(["-k", "Return"]);
  await sleep(1500);
  state = await instance.ask("state");
  const first = selection_of(state);
  check(app, kind, "Enter keeps the narrowed list and selects its first row", state.listed.length === narrowed.length && first === narrowed[0], `listed ${state.listed.length}, selected ${first}, first ${narrowed[0]}`);
  await shot("search_entered", "the narrowed list with the first row selected and the match count as a toast");
  state = await key_and_state(instance, ["n"], 1000);
  check(app, kind, "n selects the next row", selection_of(state) === narrowed[1], `selected ${selection_of(state)}, expected ${narrowed[1]}`);
  state = await key_and_state(instance, ["N"], 1000);
  check(app, kind, "N goes back one row", selection_of(state) === narrowed[0], `selected ${selection_of(state)}, expected ${narrowed[0]}`);
  state = await key_and_state(instance, ["N"], 1000);
  check(app, kind, "N from the first row wraps to the last", selection_of(state) === narrowed.at(-1), `selected ${selection_of(state)}, expected ${narrowed.at(-1)}`);

  // Escape ended nothing here: the filter stays, so clear it, then n narrows it again from the register.
  await instance.press(["F"]);
  await key_and_state(instance, ["r"], 1200);
  state = await key_and_state(instance, ["n"], 1500);
  check(app, kind, "n after the filter was cleared narrows the list to the register again", state.listed.length === narrowed.length, `listed ${state.listed.length}, expected ${narrowed.length}`);

  await instance.press(["F"]);
  await key_and_state(instance, ["r"], 1200);
  await instance.press(["?"]);
  await sleep(1200);
  await instance.press(["Single 1"]);
  await sleep(1200);
  await shot("search_backward", "the backward search line with the ? prompt");
  await instance.press(["-k", "Return"]);
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "? then Enter selects the last matching row", selection_of(state) === narrowed.at(-1), `selected ${selection_of(state)}, expected ${narrowed.at(-1)}`);
  await instance.press(["F"]);
  await key_and_state(instance, ["r"], 1200);
}

// The labels sit in the order the targets sit on screen (window toolbars, folder rows, message rows, then buttons), so a fixed window shows the same labels each run. The ones below were read from the shots of each app.
const WINDOW_HINT_LABELS = { betterbird: { thread_row_1: "sl", folder_reading: "sh", folder_inbox: "ss" }, thunderbird: { thread_row_1: "sl", folder_reading: "sh", folder_inbox: "ss" } };

async function run_window_hints(instance, { app, kind, shot }) {
  const labels = WINDOW_HINT_LABELS[app];
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  await instance.press(["g"]);
  const top = await key_and_state(instance, ["g"], 600);
  const rows_before = top.listed.length;
  await instance.press(["f"]);
  await sleep(1000);
  await shot("window_hints", "f in the thread list: labels over the toolbar, folder rows, message rows and buttons");
  // Hint letters are home row keys that are also commands (j moves down, s stars). While the labels show they must reach the labels only: the selection must not move.
  await instance.press(["j"]);
  await sleep(500);
  await instance.press(["-k", "Escape"]);
  await sleep(500);
  let state = await instance.ask("state");
  check(app, kind, "window hints: j typed while the labels show runs no command, and Escape ends them", state.listed.length === rows_before && selection_of(state) === selection_of(top), `listed ${state.listed.length} of ${rows_before}, selected ${selection_of(state)}`);
  await shot("window_hints_ended", "the labels are gone after a letter and Escape");
  // The hold after f drops plain keys for 1.5 s, so wait it out or this check proves nothing.
  await sleep(1800);
  state = await key_and_state(instance, ["j"], 800);
  check(app, kind, "window hints: after Escape a bound key runs again", selection_of(state) !== selection_of(top), `selected ${selection_of(top)} then ${selection_of(state)}`);
  await instance.press(["g"]);
  const burst_before = selection_of(await key_and_state(instance, ["g"], 600));
  // The whole gesture in one burst. `c` is bound (msg.new opens a compose window) and is no hint label. The first `c` ends the labels and is swallowed, and the hold after `f` must drop the second, so no compose window may open.
  await instance.press(["fcc"]);
  await sleep(2000);
  state = await instance.ask("state");
  check(app, kind, "window hints: f c c in one burst opens no compose window and changes no mail", !state.windows.some((window) => window.type === "messageCompose") && state.listed.length === rows_before && selection_of(state) === burst_before, `compose windows ${state.windows.filter((window) => window.type === "messageCompose").length}, listed ${state.listed.length} of ${rows_before}`);
  // A key that no label continues with ends the labels, and swallows the key.
  await instance.press(["f"]);
  await sleep(800);
  await instance.press(["z"]);
  await sleep(1700);
  state = await key_and_state(instance, ["j"], 800);
  check(app, kind, "window hints: a key no label starts with ends them, then j moves", selection_of(state) !== selection_of(top), `selected ${selection_of(state)}`);
  // A message row: one pick selects it and leaves the focus in the list.
  await instance.press(["f"]);
  await sleep(800);
  await instance.press([labels.thread_row_1]);
  await sleep(1200);
  state = await instance.ask("state");
  check(app, kind, "window hints: the label of a message row selects that thread", first_selected(state) === COLLAPSED_ROWS[1], `selected ${first_selected(state)}, expected ${COLLAPSED_ROWS[1]}`);
  state = await key_and_state(instance, ["j"], 800);
  check(app, kind, "window hints: after a row pick the focus is in the list, so j moves on", first_selected(state) === COLLAPSED_ROWS[2], `selected ${first_selected(state)}, expected ${COLLAPSED_ROWS[2]}`);
  // A folder row: one pick shows that folder, and j then moves in the folder pane.
  await instance.press(["f"]);
  await sleep(800);
  await shot("window_hints_second", "f again after a row pick: the labels follow the new layout");
  await instance.press([labels.folder_reading]);
  await sleep(1800);
  state = await instance.ask("state");
  check(app, kind, "window hints: the label of a folder row shows that folder", state.mail_tab?.folder === "/Reading", `displayed folder ${state.mail_tab?.folder}`);
  await shot("window_hints_folder", "the Reading folder shown after a folder hint, no labels left");
  await instance.press(["f"]);
  await sleep(800);
  await instance.press([labels.folder_inbox]);
  await sleep(1800);
  state = await instance.ask("state");
  check(app, kind, "window hints: the label of the Inbox row returns to the Inbox", state.mail_tab?.folder === "/Inbox", `displayed folder ${state.mail_tab?.folder}`);
  // `; ;` opens the command line with `hint ` typed. A flag and Enter run the window hint command, which labels the window.
  await sleep(1800);
  await instance.press([";"]);
  await instance.press([";"]);
  await sleep(1200);
  await shot("window_hints_cmdline", "after ; ;: the command line is open with hint typed in");
  await instance.press(["--", "--focus"]);
  await instance.press(["-k", "Return"]);
  await sleep(1200);
  await shot("window_hints_cmdline_labels", "after hint --focus on the line: the labels show");
  await instance.press(["-k", "Escape"]);
  await sleep(500);
  state = await instance.ask("state");
  check(app, kind, "window hints: ; ; then hint --focus then Escape leaves the list as it was", state.listed.length === rows_before, `listed ${state.listed.length} of ${rows_before}`);
  check(app, kind, "the app survived the window hint checks", instance.exited() === null);
}

async function run_cmdline(instance, { app, kind, shot }) {
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  let state = await instance.ask("state");
  let selected_before = selection_of(state);
  let folders_before = JSON.stringify(state.folders);
  // j and a typed with no pause after the colon: the key runtime holds plain keys until the overlay has the focus, so neither reaches the list.
  await instance.press([":", "j", "a"]);
  await sleep(1500);
  await shot("cmdline_open", "the command line over the bottom of the window, with the completion list above its input");
  state = await instance.ask("state");
  check(app, kind, ": then j a typed with no pause runs neither a motion nor archive", selection_of(state) === selected_before && JSON.stringify(state.folders) === folders_before, `selected ${selected_before} then ${selection_of(state)}, mail changed: ${JSON.stringify(state.folders) !== folders_before}`);
  await instance.press(["j", "a"]);
  await sleep(500);
  state = await instance.ask("state");
  check(app, kind, "j and a typed into the open command line run nothing", selection_of(state) === selected_before && JSON.stringify(state.folders) === folders_before, `selected ${selected_before} then ${selection_of(state)}`);
  await shot("cmdline_typed", "the line after j and a were typed into it");
  await close_command_line(instance);
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
  await instance.press(["fil"]);
  await sleep(600);
  await shot("cmdline_completions", "the line with fil typed: the matching rows above it, the box as wide as the window");
  await instance.press(["-k", "Tab"]);
  await sleep(600);
  await shot("cmdline_after_tab", "the line after Tab: the box keeps its size and position");
  await close_command_line(instance);

  // C-n and C-p belong to the line. Thunderbird binds them to a new message and to print, so a leak shows as a new window.
  const windows_before_ctrl = (await instance.ask("state")).windows;
  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["f"]);
  await sleep(500);
  const input_row = "0,692 640x28";
  const input_typed = await hud_pixels(instance, `${app}_ctrl_input_typed`, input_row);
  await instance.press(["-M", "ctrl", "-k", "n", "-m", "ctrl"]);
  await sleep(600);
  const input_after_n = await hud_pixels(instance, `${app}_ctrl_input_after_n`, input_row);
  check(app, kind, "C-n puts a row in the input line", input_after_n !== input_typed);
  await instance.press(["-M", "ctrl", "-k", "p", "-m", "ctrl"]);
  await sleep(1000);
  check(app, kind, "C-p then puts another row in", (await hud_pixels(instance, `${app}_ctrl_input_after_p`, input_row)) !== input_after_n);
  await shot("cmdline_ctrl_n_p", "the line after C-n and C-p: a row went into the line and no other window opened");
  const windows_after_ctrl = (await instance.ask("state")).windows;
  check(app, kind, "C-n and C-p in the open line open no window", same(windows_before_ctrl, windows_after_ctrl) && instance.exited() === null, `windows before ${windows_before_ctrl.length}, after ${windows_after_ctrl.length}`);
  await close_command_line(instance);

  // History: two sorts run, then a fresh line recalls them newest first, so Up twice is the older sort.
  for (const order of ["descending", "ascending"]) {
    await instance.press([":"]);
    await sleep(1200);
    await instance.press([`sort --date --${order}`]);
    await instance.press(["-k", "Return"]);
    await sleep(1500);
  }
  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["-k", "Up"]);
  await sleep(500);
  await instance.press(["-k", "Up"]);
  await sleep(500);
  await shot("cmdline_history_recall", "the line after Up twice: the older sort command is in the input");
  await instance.press(["-k", "Return"]);
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "Up twice in a fresh line recalls the older command and Enter runs it", state.mail_tab?.sort_order === "descending", `sort ${state.mail_tab?.sort_type} ${state.mail_tab?.sort_order}`);
  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["bogus"]);
  await instance.press(["-k", "Return"]);
  await sleep(800);
  await shot("cmdline_error", "the line stays open and names the unknown command");
  await close_command_line(instance);
  check(app, kind, "the app survived the command line", instance.exited() === null);

  // The first Escape closes the list and keeps the line, the second closes the line. Keys m s toggle the star of the selected message when the list has them, and are typed into the line when it is open.
  const keys_reach_list = async () => {
    const id = (await instance.ask("state")).selected[0]?.header_id;
    const flagged = async () => (await instance.ask("state")).flags[id]?.flagged;
    const before = await flagged();
    await instance.press(["m"]);
    await instance.press(["s"]);
    await sleep(900);
    if ((await flagged()) === before) return false;
    await instance.press(["m"]);
    await instance.press(["s"]);
    await sleep(900);
    return true;
  };
  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["-k", "Escape"]);
  await sleep(900);
  await shot("cmdline_list_closed", "after the first Escape: the list is gone and the input line stays");
  check(app, kind, "the first Escape keeps the line open: m s is typed into it", !(await keys_reach_list()));
  await close_command_line(instance);
  check(app, kind, "after Escape three times the line is closed and keys reach the list", await keys_reach_list());
  await shot("cmdline_list_closed_twice", "after the Escapes: no command line");
  // A selected row puts its usage in the note row, and a missing value shows in the note in the error color.
  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["-k", "Tab"]);
  await instance.press(["-k", "Tab"]);
  await sleep(700);
  await shot("cmdline_selected_note", "the line after two Tabs: the second row is in the line and the note row above the input shows its usage");
  await close_command_line(instance);
  await instance.press([":"]);
  await sleep(1200);
  await instance.press(["step.unread"]);
  await instance.press(["-k", "Return"]);
  await sleep(800);
  await shot("cmdline_typed_error", "step.unread typed and run: the note row shows the error in the error color");
  await close_command_line(instance);
  check(app, kind, "the line is closed before the next scenario", await keys_reach_list());

  // Enter takes the highlighted row: a fuzzy word picks a folder without Tab.
  await instance.ask("show_folder", 20000, { path: "/Views" });
  await sleep(1500);
  await instance.press(["o"]);
  await sleep(1200);
  // Enter follows the letters at once, so the answer for the last letter may still be on its way.
  await instance.press(["inb"]);
  await instance.press(["-k", "Return"]);
  await sleep(2000);
  state = await instance.ask("state");
  check(app, kind, "o then inb Enter shows the highlighted folder, the Inbox", state.mail_tab?.folder === "/Inbox", `folder ${state.mail_tab?.folder}`);
  state = await key_and_state(instance, ["j"], 800);
  const moved = state.selected[0]?.header_id;
  await instance.press(["m"]);
  await instance.press(["m"]);
  await sleep(1200);
  await instance.press(["vie"]);
  await instance.press(["-k", "Return"]);
  await sleep(2500);
  state = await instance.ask("state");
  check(app, kind, "m m then vie Enter moves the message to the highlighted folder, /Views", moved !== undefined && state.folders["/Views"]?.includes(moved) === true && state.folders["/Inbox"]?.includes(moved) !== true, `${moved} in Views ${state.folders["/Views"]?.includes(moved)}, in Inbox ${state.folders["/Inbox"]?.includes(moved)}`);
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
  for (const [name, keys, expected] of [["unread", ["F", "u"], 3], ["starred", ["F", "s"], 2], ["attachment", ["F", "a"], 1], ["reset", ["F", "r"], 6]]) {
    await instance.press([keys[0]]);
    const count = await listed_after([keys[1]]);
    check(app, kind, `F ${keys[1]} (${name}) shows ${expected} rows`, count === expected, `listed ${count}`);
  }
  // F s from the unfiltered list, with no F u before it, must switch starred on and a second F s off again.
  await instance.press(["F"]);
  const starred_alone = await listed_after(["s"]);
  await instance.press(["F"]);
  const starred_off = await listed_after(["s"]);
  check(app, kind, "F s on its own shows 2 rows and a second F s shows all 6 again", starred_alone === 2 && starred_off === 6, `listed ${starred_alone} then ${starred_off}`);
  // F f is no filter key: it opens the command line, where j types text instead of moving, and Escape closes it.
  const selected_before_f = (await instance.ask("state")).selected.map((message) => message.header_id).join(",");
  await instance.press(["F"]);
  await instance.press(["f"]);
  await sleep(1200);
  state = await key_and_state(instance, ["j"], 800);
  check(app, kind, "F f opens the command line, so j typed into it moves no selection", state.selected.map((message) => message.header_id).join(",") === selected_before_f, `selected ${selected_before_f} then ${state.selected.map((message) => message.header_id).join(",")}`);
  await close_command_line(instance);
  state = await key_and_state(instance, ["j"], 800);
  check(app, kind, "Escape closes the command line, so j moves the selection again", state.selected.map((message) => message.header_id).join(",") !== selected_before_f, `selected ${selected_before_f} then ${state.selected.map((message) => message.header_id).join(",")}`);
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
    ["subject", ["j"], "subject", "ascending"],
    ["current column, order toggled", ["o"], "subject", "descending"],
    ["author", ["f"], "author", "ascending"],
    ["current column, order toggled", ["o"], "author", "descending"],
  ]) {
    await instance.press(["s"]);
    state = await key_and_state(instance, keys, 1200);
    check(app, kind, `s ${keys[0]} (${name}) sets ${sort_type} ${sort_order}`, state.mail_tab?.sort_type === sort_type && state.mail_tab?.sort_order === sort_order, `sortType ${state.mail_tab?.sort_type}, sortOrder ${state.mail_tab?.sort_order}`);
    check(app, kind, `s ${keys[0]} (${name}) orders the rows`, same(state.listed, views_rows(sort_type, sort_order)), state.listed.join(" "));
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

// The own_pages kind installs a copy of the xpi that opens its options or help page when the helper add-on sends the page name.
const OPEN_OWN_PAGES_SCRIPT = `messenger.runtime.onMessageExternal.addListener((page) => (page === "help" ? messenger.tabs.create({ url: messenger.runtime.getURL("help/help.html") }) : messenger.runtime.openOptionsPage()).then(() => true));\n`;

// DesertBird's own pages run the message keys themselves: q closes the page tab, and q typed in an option input stays text.
async function run_own_pages(instance) {
  const app = instance.app;
  const kind = "own_pages";
  await open_inbox(instance);
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };
  const tab_count = async () => main_window_tabs(await instance.ask("state")).length;
  const before = await tab_count();
  const open_page = async (page) => {
    const reply = await instance.ask("open_own_page", 20000, { page });
    await sleep(2500);
    check(app, kind, `the ${page} page opens in a tab`, (await tab_count()) === before + 1, `reply ${JSON.stringify(reply)}`);
  };
  // A page nobody clicked yet: its first keys must work, so j scrolls it and q closes it.
  for (const page of ["options", "help"]) {
    await open_page(page);
    const page_region = "0,150 1260x480";
    const page_before = await hud_pixels(instance, `${app}_${page}_unclicked_before`, page_region);
    for (let count = 0; count < 5; count++) await instance.press(["j"]);
    await sleep(500);
    check(app, kind, `j scrolls the ${page} page with no click first`, (await hud_pixels(instance, `${app}_${page}_unclicked_after`, page_region)) !== page_before);
    const closed = await key_and_state(instance, ["q"], 2000);
    check(app, kind, `q closes the ${page} page with no click first`, main_window_tabs(closed).length === before, `tabs ${main_window_tabs(closed).length}, expected ${before}`);
    if (main_window_tabs(closed).length !== before) await instance.ask("remove_tab", 20000, { index: before });
  }
  for (const page of ["options", "help"]) {
    await open_page(page);
    // A click on empty page area puts the focus in the page document, as a user's first click does.
    await instance.click(1150, 450);
    await sleep(500);
    const closed = await key_and_state(instance, ["q"], 2000);
    check(app, kind, `q closes the ${page} page`, main_window_tabs(closed).length === before, `tabs ${main_window_tabs(closed).length}, expected ${before}`);
  }
  // `/` sends the find to the page through tabs.sendMessage. A refusal shows a toast in the strip below the page, so the strip staying unchanged and the selection on screen show the page took the find.
  await open_page("options");
  await instance.click(1150, 450);
  await sleep(500);
  // The page scrolls to the match and draws under the strip, so a first find moves it and the compared find starts from the scrolled page, after any toast of the first has gone.
  const find_key_bindings = async () => {
    await instance.press(["/"]);
    await sleep(1500);
    await instance.press(["Key bindings"]);
    await sleep(400);
    await instance.press(["-k", "Return"]);
    await sleep(1500);
  };
  await find_key_bindings();
  await sleep(7000);
  const strip_before_find = await hud_pixels(instance, `${app}_own_find_before`);
  await find_key_bindings();
  await shot("options_find", "options page after / and Key bindings: the heading is selected");
  check(app, kind, "/ finds text on the options page with no refusal toast", (await hud_pixels(instance, `${app}_own_find_after`)) === strip_before_find);
  await instance.ask("remove_tab", 20000, { index: before });
  await sleep(1000);
  // A click on the first setting, a text input.
  await open_page("options");
  await instance.click(590, 250);
  await sleep(500);
  await shot("options_input_focused", "options page with the first control focused");
  const typed = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "q in an options input does not close the tab", main_window_tabs(typed).length === before + 1, `tabs ${main_window_tabs(typed).length}`);
  // Step 0 of the page keys: a keydown aimed at a remote page reaches the main-window listener. Alt+q closes the options tab with an input focused, and the page itself cannot have done it.
  const chord_closed = await key_and_state(instance, ["-M", "alt", "q", "-m", "alt"], 2000);
  check(app, kind, "Alt+q closes a remote page tab, input focused", main_window_tabs(chord_closed).length === before, `tabs ${main_window_tabs(chord_closed).length}, expected ${before}`);
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(500);
  // The readable tabs take q, : and g? through the main-window runtime. Each opens by its Thunderbird shortcut.
  // The address book focuses its search field, which keeps q as text, so a click on the folder list or the grid first puts the focus in the tab as a user's click does. g ? shows the root key list, and the next key removes it.
  for (const [name, open, click_at] of [["address book", () => instance.press(CTRL_SHIFT("b")), [165, 151]], ["calendar", () => instance.click(22, 112), [700, 400]]]) {
    await open();
    await sleep(3000);
    check(app, kind, `the ${name} tab opens`, (await tab_count()) === before + 1, `tabs ${await tab_count()}`);
    await instance.click(...click_at);
    await sleep(500);
    await shot(`${name.replace(" ", "_")}_tab`, `${name} tab before the keys`);
    const list_before = await hud_pixels(instance, `${app}_${name}_list_before`, KEY_LIST_REGION);
    await instance.press(["g"]);
    const helped = await key_and_state(instance, ["?"], 3000);
    check(app, kind, `g ? opens no tab from the ${name} tab`, main_window_tabs(helped).length === before + 1, `tabs ${main_window_tabs(helped).length}, expected ${before + 1}`);
    const list_shown = await hud_pixels(instance, `${app}_${name}_list_shown`, KEY_LIST_REGION);
    check(app, kind, `g ? shows the key list in the ${name} tab`, list_shown !== list_before);
    await shot(`${name.replace(" ", "_")}_key_list`, `${name} tab after g ?: the root key list shows`);
    await instance.press(["-k", "Escape"]);
    await sleep(1500);
    check(app, kind, `the next key removes the key list in the ${name} tab`, (await hud_pixels(instance, `${app}_${name}_list_gone`, KEY_LIST_REGION)) === list_before);
    await instance.press([":"]);
    await sleep(1500);
    await shot(`${name.replace(" ", "_")}_cmdline`, `${name} tab after the colon key: the command line shows`);
    await close_command_line(instance);
    const closed_here = await key_and_state(instance, ["q"], 2000);
    check(app, kind, `q closes the ${name} tab`, main_window_tabs(closed_here).length === before, `tabs ${main_window_tabs(closed_here).length}, expected ${before}`);
  }
}

// Tab commands. The helper add-on opens, selects and closes tabs through the API, since wtype has no mouse.
async function run_tabs(instance, { check, note, shot, key_and_state }) {
  const app = instance.app;
  const kind = "default";
  const tabs_of = async () => main_window_tabs(await instance.ask("state"));

  // q on the only mail tab: tabs.remove does nothing there, so q moves the focus to the thread list, shows no toast and the tab stays.
  const refused_q = await toast_cycle(instance, `${app}_q`, ["q"], [], { wait_out_toasts: false });
  let state = refused_q.state;
  check(app, kind, "q on the only mail tab leaves it open", main_window_tabs(state).length === 1, `tabs ${JSON.stringify(main_window_tabs(state).map((tab) => tab.type))}`);
  check(app, kind, "q on the only mail tab shows no refusal toast", !refused_q.shown, "the toast strip differs while a toast shows");

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
  // q in the mail tab closes nothing: the main tab stays and the tab count holds.
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  state = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "q in the mail tab closes no tab", main_window_tabs(state).length === message_tab_count && active_index(state) === 0, `tabs ${main_window_tabs(state).length}, active ${active_index(state)}`);
  await instance.ask("select_tab", 20000, { index: 1 });
  await sleep(1000);
  state = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "q closes the message tab it is typed in", main_window_tabs(state).length === 1, `tabs left ${main_window_tabs(state).length}`);

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

// Restarts the app, so it goes after the checks that need the session as it is.
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
  // Marks and the history live in storage, so the restart is of the whole app on the same profile.
  await shown_folder(["g", "t"]);
  await shown_folder(["M", "b"], 700);
  await restart_app(instance, app, kind, "restart");
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
  const refused_r = await toast_cycle(instance, `${app}_r`, ["r"]);
  state = refused_r.state;
  check(app, kind, "r with no identity shows the refusal as a toast", refused_r.shown, `selected ${state.selected.length}`);
  check(app, kind, "the toast of r is gone after toast_error_ms", refused_r.gone);
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

// Quick replies. The seeded slots are in the xpi this kind installs (see `seed_storage`). g r 1 opens a reply with the slot text. The run checks that the quote survives and records where the text, the quote and the signature land.
const QUICK_REPLY_SEED = ["Quick reply one.\nSecond & <b>line</b>.", "", "", "", "", "", "", "", ""];

// A copy of the xpi whose background page writes the given records to `storage.local` at start, since the helper add-on cannot write another add-on's storage.
function seed_storage(xpi, work_dir, records, extra_script = "") {
  const stage = join(work_dir, "seed_stage");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  execFileSync("unzip", ["-q", xpi, "-d", stage]);
  appendFileSync(join(stage, "background.js"), `\nmessenger.storage.local.set(${JSON.stringify(records)});\n${extra_script}`);
  const seeded = join(work_dir, "desertbird_seeded.xpi");
  rmSync(seeded, { force: true });
  execFileSync("zip", ["-qr", seeded, "."], { cwd: stage });
  return seeded;
}

// The external editor kind: the native host from a DesertFox install, reached through a desertbird_host manifest in the session's own HOME, runs a fake editor that rewrites the scratch file. Nothing is written outside the work directory.
const EDITED_TEXT = "Edited by the e2e editor.";
const DESERTFOX_HOST = process.env.E2E_DESERTFOX_HOST ?? join(process.env.HOME ?? "", ".local/share/desertfox/desertfox-host");

// The HTML kinds: Markdown the user writes, with a bold word, markup that must not turn live and tag text that must stay text.
const EDITED_MARKDOWN = "**Edited** by the e2e editor.\n\n<img src=\"x\" onerror=\"document.title='hit'\"> [a link](javascript:alert(1)) &lt;b&gt;kept as text&lt;/b&gt;\n";

// A 1x1 PNG for the draft image measurement.
const PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function install_editor_host(work_dir, kind) {
  const home = join(work_dir, "home");
  const manifests = join(home, ".mozilla", "native-messaging-hosts");
  mkdirSync(manifests, { recursive: true });
  writeFileSync(join(manifests, "desertbird_host.json"), JSON.stringify({ name: "desertbird_host", description: "DesertBird e2e editor host", path: DESERTFOX_HOST, type: "stdio", allowed_extensions: ["desertbird@uhs-robert"] }));
  const config = join(home, ".config", "desertfox");
  mkdirSync(config, { recursive: true });
  if (kind in COMPOSE_EDITOR_HTML_KINDS) {
    const markdown_file = join(home, "edited.md");
    writeFileSync(markdown_file, EDITED_MARKDOWN);
    // A JSON array of strings is a valid TOML array.
    writeFileSync(join(config, "editor.toml"), `argv = ${JSON.stringify(["cp", markdown_file, "{file}"])}\n`);
    return;
  }
  // The scratch path holds no space, so `$1` goes unquoted and the TOML string needs no escape.
  writeFileSync(join(config, "editor.toml"), `argv = ["sh", "-c", "echo ${EDITED_TEXT} > $1", "sh", "{file}"]\n`);
}

// The HTML kinds and the layout each tests: a reply below the quote (Thunderbird's default), and a reply above the quote with the signature above it too.
const COMPOSE_EDITOR_HTML_KINDS = { compose_editor_html: "below", compose_editor_html_top: "above" };

// The image a stored draft gives back: a draft with a data image Thunderbird embeds is saved and opened again, and a NOTE records the `src` of each image. The external editor keeps only the image sources its allowlist names.
async function note_draft_image(instance) {
  const image = `<img src="data:image/png;filename=pixel.png;base64,${PIXEL_PNG_BASE64}" alt="pixel">`;
  const reopened = await instance.ask("draft_round_trip", 30000, { body: `<html><body><p>Image draft.</p>${image}</body></html>` });
  const image_tags = [...(reopened.body ?? "").matchAll(/<img[^>]*>/g)].map((match) => match[0].replace(/base64,[^"]{40,}/, "base64,..."));
  note(instance.app, instance.kind, "src of an embedded image in a saved draft opened again", JSON.stringify(image_tags) + (reopened.body?.startsWith("error") ? ` ${reopened.body}` : ""));
  await instance.ask("close_compose");
}

async function run_compose_editor_html(instance) {
  const app = instance.app;
  const kind = instance.kind;
  const compose_tab = (state) => state.windows.find((window) => window.type === "messageCompose")?.tabs.find((tab) => tab.subject);
  if (!existsSync(DESERTFOX_HOST)) {
    note(app, kind, "external editor not run", `no DesertFox host at ${DESERTFOX_HOST}; set E2E_DESERTFOX_HOST`);
    return;
  }
  const edited_html_checks = (label, html) => {
    check(app, kind, `${label}: the Markdown came back as HTML`, html.includes("<strong>Edited</strong> by the e2e editor."), `html ${JSON.stringify(html)}`);
    check(app, kind, `${label}: no event handler, script URL or live tag from the Markdown`, !/onerror|javascript:|<b>kept/i.test(html) && html.includes("&lt;b&gt;kept as text&lt;/b&gt;"), `html ${JSON.stringify(html)}`);
  };
  const edit_in = async (label) => {
    const state = await key_and_state(instance, ["-M", "ctrl", "e", "-m", "ctrl"], 6000);
    report.shots.push({ app, kind, path: await instance.shot(`${app}_${kind}_${label}`), name: `${kind}_${label}`, line: `HTML compose window after Ctrl+E (${label})` });
    return compose_tab(state)?.html ?? "";
  };
  await sleep(2000);
  await instance.press(["-k", "F6"]);
  await instance.ask("select:inbox-s2@fixture.invalid", 30000);
  await sleep(1000);
  let state = await key_and_state(instance, ["r"], 4000);
  const reply_before = compose_tab(state)?.html ?? "";
  check(app, kind, "r opens an HTML reply", compose_tab(state)?.is_plain === false, `isPlainText ${compose_tab(state)?.is_plain}`);
  note(app, kind, "HTML reply body before the editor", JSON.stringify(reply_before));
  const reply_after = await edit_in("reply");
  note(app, kind, "HTML reply body after the editor", JSON.stringify(reply_after));
  edited_html_checks("reply", reply_after);
  const at_text = reply_after.indexOf("<strong>Edited");
  const at_quote = reply_after.indexOf('<blockquote type="cite"');
  const at_signature = reply_after.indexOf("E2E signature line");
  check(app, kind, "reply: the quote and the signature survive", at_quote >= 0 && at_signature >= 0 && reply_after.includes("Body of inbox-s2."), `quote at ${at_quote}, signature at ${at_signature}`);
  // Below means past the end of the quote, so text written inside the quote fails.
  const at_quote_end = reply_after.indexOf("</blockquote>");
  const placed = COMPOSE_EDITOR_HTML_KINDS[kind] === "below" ? at_text > at_quote_end && at_text < at_signature : at_text < at_quote && at_text < at_signature;
  check(app, kind, `reply: the text sits ${COMPOSE_EDITOR_HTML_KINDS[kind]} the quote where Thunderbird put the cursor`, at_text >= 0 && placed, `text at ${at_text}, quote at ${at_quote}, signature at ${at_signature}`);
  await instance.ask("close_compose");
  await sleep(1500);
  if (COMPOSE_EDITOR_HTML_KINDS[kind] === "below") await note_draft_image(instance);
  state = await instance.ask("state");
  check(app, kind, "the app survived the HTML editor", instance.exited() === null && !state.windows.some((window) => window.type === "messageCompose"));
}

async function run_compose_editor(instance) {
  const app = instance.app;
  const kind = instance.kind;
  const compose_tab = (state) => state.windows.find((window) => window.type === "messageCompose")?.tabs.find((tab) => tab.subject);
  if (!existsSync(DESERTFOX_HOST)) {
    note(app, kind, "external editor not run", `no DesertFox host at ${DESERTFOX_HOST}; set E2E_DESERTFOX_HOST`);
    return;
  }
  await sleep(2000);
  await instance.press(["-k", "F6"]);
  await instance.ask("select:inbox-s2@fixture.invalid", 30000);
  await sleep(1000);
  // A reply puts the focus in the body, where the compose script listens.
  let state = await key_and_state(instance, ["r"], 4000);
  const before = compose_tab(state)?.body ?? "";
  check(app, kind, "r opens a plain-text reply for the editor", compose_tab(state)?.is_plain === true && !before.includes(EDITED_TEXT), `isPlainText ${compose_tab(state)?.is_plain}, body ${JSON.stringify(before)}`);
  state = await key_and_state(instance, ["-M", "ctrl", "e", "-m", "ctrl"], 6000);
  const after = compose_tab(state)?.body ?? "";
  check(app, kind, "Ctrl+E runs the editor through desertbird_host and writes its text into the body", after.trim() === EDITED_TEXT, `body ${JSON.stringify(after)}`);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_after_ctrl_e`), name: "after_ctrl_e", line: "compose window with the text of the fake editor" });
  await instance.ask("close_compose");
  await sleep(1500);

  // Normal mode. Each entry into the body is a fresh reply, so the fake editor's text shows only when `e` ran it.
  const reply_again = async () => {
    await instance.ask("select:inbox-s2@fixture.invalid", 30000);
    await sleep(1000);
    return key_and_state(instance, ["r"], 4000);
  };
  const body_of = (state) => compose_tab(state)?.body ?? "";
  state = await reply_again();
  const plain_body = body_of(state);
  state = await key_and_state(instance, ["e"], 1500);
  check(app, kind, "e in insert mode types an e and runs no editor", body_of(state) === `e${plain_body}` || body_of(state).length === plain_body.length + 1, `body ${JSON.stringify(body_of(state))}`);
  await instance.press(["-M", "ctrl", "o", "-m", "ctrl"]);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_normal_label`), name: "normal_label", line: "compose window after Ctrl+O, label reads NORMAL" });
  state = await key_and_state(instance, ["x"], 1500);
  check(app, kind, "Ctrl+O then a key other than e passes that key to the body", body_of(state).includes("x") && !body_of(state).includes(EDITED_TEXT), `body ${JSON.stringify(body_of(state))}`);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_insert_label`), name: "insert_label", line: "compose window back in insert mode, label reads INSERT" });
  await instance.press(["-M", "ctrl", "o", "-m", "ctrl"]);
  state = await key_and_state(instance, ["e"], 6000);
  check(app, kind, "Ctrl+O then e runs the editor and writes its text into the body", body_of(state).trim() === EDITED_TEXT, `body ${JSON.stringify(body_of(state))}`);
  await instance.ask("close_compose");
  await sleep(1500);
  state = await reply_again();
  await instance.press(["-k", "Escape"]);
  state = await key_and_state(instance, ["e"], 6000);
  check(app, kind, "Escape then e runs the editor and keeps the compose window open", body_of(state).trim() === EDITED_TEXT, `body ${JSON.stringify(body_of(state))}`);

  // The label must not reach the body or a saved draft.
  await instance.press(["-M", "ctrl", "o", "-m", "ctrl"]);
  const draft = await instance.ask("save_draft_raw", 30000);
  state = await instance.ask("state");
  const label_pattern = /-- (INSERT|NORMAL) --/;
  await instance.press(["-M", "shift", "-k", "Tab", "-m", "shift"]);
  await sleep(500);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_unfocused_label`), name: "unfocused_label", line: "compose window with focus out of the body, no label" });
  check(app, kind, "the mode label is in neither the body nor the saved draft", !label_pattern.test(compose_tab(state)?.html ?? "") && !label_pattern.test(body_of(state)) && !label_pattern.test(draft.raw ?? "") && (draft.raw ?? "").includes(EDITED_TEXT), `draft ${JSON.stringify((draft.raw ?? "").slice(-300))}`);
  await instance.ask("close_compose");
  await sleep(1500);
  state = await instance.ask("state");
  check(app, kind, "the app survived the external editor", instance.exited() === null && !state.windows.some((window) => window.type === "messageCompose"));
}

async function run_quick_replies(instance) {
  const app = instance.app;
  const kind = instance.kind;
  const compose_tab = (state) => state.windows.find((window) => window.type === "messageCompose")?.tabs.find((tab) => tab.subject);
  await sleep(2000);
  await instance.press(["-k", "F6"]);
  await instance.ask("select:inbox-s2@fixture.invalid", 30000);
  await sleep(1000);
  await instance.press(["g"]);
  await instance.press(["r"]);
  let state = await key_and_state(instance, ["1"], 7000);
  const tab = compose_tab(state);
  const body = tab?.body ?? "";
  const at_text = body.indexOf("Quick reply one.");
  const at_quote = body.indexOf("Body of inbox-s2.");
  const at_signature = body.indexOf("E2E signature line");
  check(app, kind, "g r 1 opens a reply to the sender with the slot text", tab?.subject?.startsWith("Re: ") === true && at_text >= 0, `subject ${JSON.stringify(tab?.subject)}, body ${JSON.stringify(body)}`);
  check(app, kind, "the slot text sits above the quote and the quote survives", at_text >= 0 && at_quote > at_text, `text at ${at_text}, quote at ${at_quote}`);
  check(app, kind, "the compose is plain or HTML as the identity says", tab?.is_plain === (kind === "quick_reply_plain"), `isPlainText ${tab?.is_plain}`);
  if (kind === "quick_reply_html") check(app, kind, "markup in the slot text is escaped and not live", /&lt;b&gt;line&lt;\/b&gt;/.test(tab?.html ?? "") && !/<b>line/.test(tab?.html ?? ""), `html ${JSON.stringify(tab?.html)}`);
  check(app, kind, "the signature survives below the quote", at_signature > at_quote, `quote at ${at_quote}, signature at ${at_signature}`);
  check(app, kind, "a blank line separates the slot text from the cite line", /line<\/b>\.\n\n+On /.test(body), `body ${JSON.stringify(body)}`);
  note(app, kind, "quick reply draft layout", `text at ${at_text}, quote at ${at_quote}, signature at ${at_signature} (-1 means absent), body ${JSON.stringify(body)}`);
  const quick_draft = await instance.ask("save_draft_raw", 30000);
  // An element of the label, even an empty one, would show as markup after the body of a saved HTML draft.
  const label_free = !/-- (INSERT|NORMAL) --/.test(quick_draft.raw ?? "") && (kind !== "quick_reply_html" || /<\/body>\s*<\/html>/.test(quick_draft.raw ?? ""));
  check(app, kind, "the mode label leaves no text and no element in the saved draft", /Quick reply one/.test(quick_draft.raw ?? "") && label_free, `draft ${JSON.stringify((quick_draft.raw ?? "").slice(-200))}`);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_after_gr1_${kind}`), name: `after_gr1_${kind}`, line: "compose window with the quick reply above the quote" });
  await instance.ask("close_compose");
  await sleep(1500);
  const refused_slot = await toast_cycle(instance, `${app}_gr2_${kind}`, ["2"], ["g", "r"]);
  check(app, kind, "g r 2 on an empty slot opens no compose window", !refused_slot.state.windows.some((window) => window.type === "messageCompose"));
  check(app, kind, "g r 2 on an empty slot shows the refusal as a toast", refused_slot.shown, "the toast strip differs while the toast shows");
  check(app, kind, "the toast of g r 2 is gone after toast_error_ms", refused_slot.gone, "the toast strip matches the strip from before");
  check(app, kind, "the app survived the quick reply keys", instance.exited() === null);
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

  // The body script takes every key while the message pane has the focus, so g e and g f there ask the background to move the focus. Native Down tells which pane has it.
  state = await show_in_pane("reading-plain");
  await instance.press(["g"]);
  state = await key_and_state(instance, ["e"], 1500);
  const list_row = first_selected(state);
  state = await key_and_state(instance, ["-k", "Down"], 1200);
  check(app, kind, "pane: g e in the message body focuses the thread list, so Down moves the selection", first_selected(state) !== list_row && first_selected(state) !== null, `selected ${list_row} then ${first_selected(state)}`);
  state = await show_in_pane("reading-plain");
  const folder_before = state.mail_tab?.folder;
  await instance.press(["g"]);
  await key_and_state(instance, ["f"], 1500);
  state = await key_and_state(instance, ["-k", "Down"], 1200);
  check(app, kind, "pane: g f in the message body focuses the folder pane, so Down moves the folder", state.mail_tab?.folder !== folder_before, `folder ${folder_before} then ${state.mail_tab?.folder}`);
  await key_and_state(instance, ["-k", "Up"], 1200);
  // The checks below press F6 from the list, so put the focus back there.
  await instance.press(["g"]);
  await key_and_state(instance, ["e"], 1200);

  // HTML mail, remote content and a sandboxed frame. The measurement the design asked for: does the script run there?
  for (const id of READING_FOLDER_MESSAGES.slice(1)) {
    await show_in_pane(id);
    await shot(`pane_${id}`, `reading pane with ${id}, body focused`);
    await scroll_keys(`pane ${id}`, { measure_only: true });
    await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
    await sleep(600);
  }

  // Hints: f labels the link on screen, the typed label opens it in one step (the Experiment sends a trusted Enter), and the link target at the bottom of the mail scrolls into view.
  await show_in_pane("reading-html");
  let hint_body = body_state(await instance.ask("state"));
  check(app, kind, "hints: the html message starts at the top", hint_body.scroll_y === 0, `scrollY ${hint_body.scroll_y}`);
  await instance.press(["f"]);
  await sleep(800);
  await shot("hint_labels", "reading pane with the hint label on the link");
  // The label wears the theme: the box is the brand color of the scheme the message shows, and the fixed yellow of the fallback is gone.
  const { resolve_theme: message_theme } = await import("../../src/background/theme/palette.ts");
  const { DEFAULT_THEME } = await import("../../src/shared/theme_choice.ts");
  const message_colors = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_labels_raw`, "0,0 1280x720", "ppm"));
  const default_theme = message_theme(DEFAULT_THEME);
  check(app, kind, "hints: the message label is drawn in the theme color and not the fallback yellow", (message_colors.has(default_theme.dark.primary) || message_colors.has(default_theme.light.primary)) && !message_colors.has("#ffd33d"), `dark ${default_theme.dark.primary} ${message_colors.get(default_theme.dark.primary) ?? 0} px, light ${default_theme.light.primary} ${message_colors.get(default_theme.light.primary) ?? 0} px`);
  await instance.press(["a"]);
  await sleep(1500);
  hint_body = body_state(await instance.ask("state"));
  check(app, kind, "hints: f then a opens the link in one step, so the page scrolls to its target", hint_body.scroll_y > 2 * hint_body.inner_height, `scrollY ${hint_body.scroll_y}, innerHeight ${hint_body.inner_height}`);
  // An external link whose text names another address. The pick sends a trusted Enter, so Thunderbird's own click handling runs and warns about such a link. The shot hint_external_pick shows the Link Mismatch dialog when it works, and the pane stays on the message. A script click skips the warning (see the probe below).
  const href_before = hint_body.href;
  const windows_before = (await instance.ask("state")).windows.length;
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], 800);
  await instance.press(["f"]);
  await sleep(800);
  await shot("hint_labels_two", "reading pane with two hint labels, one on each link");
  await instance.press(["s"]);
  await sleep(2500);
  await shot("hint_external_pick", "reading pane after the one-step pick of the external link: the Link Mismatch dialog shows");
  state = await instance.ask("state");
  hint_body = body_state(state);
  note(app, kind, "hints: one-step pick of the external link", `windows ${windows_before} then ${state.windows.length}, ${JSON.stringify(state.windows.map((window) => window.type))}, document ${hint_body.href === href_before ? "unchanged" : hint_body.href}; read the shot: the Link Mismatch dialog must show`);
  check(app, kind, "hints: the one-step pick of the external link leaves the message in place", hint_body.href === href_before && hint_body.scroll_y < hint_body.inner_height, `document ${hint_body.href}, scrollY ${hint_body.scroll_y}`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  // The probe behind the one-step pick: the same external link, clicked by a script (the helper's content script runs click() as the body script does). A dialog in this shot, as in hint_external_pick, means click() keeps Thunderbird's link-mismatch check.
  const click_answer = await instance.ask("click_link", 20000, { text: "bank.example" });
  await sleep(2500);
  await shot("hint_external_click", "reading pane after a scripted click() on the external link");
  state = await instance.ask("state");
  note(app, kind, "hints: click() on the external link", `clicked ${click_answer.clicked}, windows ${JSON.stringify(state.windows.map((window) => window.type))}; read the shot: a Link Mismatch dialog means the check ran`);
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  await sleep(600);

  // The mail keys run on the shown message while the body has the focus. m s flags it, and q hands the focus back to the thread list.
  const plain_id = "reading-plain@fixture.invalid";
  // wtype drops the second key of a pair typed in one call, so m and s go in two presses.
  const flag_keys = async () => {
    await instance.press(["m"]);
    await sleep(200);
    return key_and_state(instance, ["s"], 2000);
  };
  const flagged_ids = (snapshot) => Object.entries(snapshot.flags).filter(([, flags]) => flags.flagged).map(([id]) => id);
  await show_in_pane("reading-plain");
  state = await flag_keys();
  check(app, kind, "pane: m s flags the shown message", flagged_ids(state).includes(plain_id), `flagged ${JSON.stringify(flagged_ids(state))}`);
  await flag_keys();
  const tabs_in_pane = main_window_tabs(state).length;
  state = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "pane: q closes no tab", main_window_tabs(state).length === tabs_in_pane, `tabs ${main_window_tabs(state).length}`);
  const selected_before_j = first_selected(state);
  state = await key_and_state(instance, ["j"], 1500);
  check(app, kind, "pane: after q the thread list has the focus, so j moves the selection", first_selected(state) !== selected_before_j, `selected ${selected_before_j} then ${first_selected(state)}`);
  await instance.press(["g"]);
  await key_and_state(instance, ["e"], 1200);

  // A message tab: the message opens in a new tab and the keys go to it.
  await show_in_pane("reading-plain");
  await instance.ask("open_message_tab");
  await sleep(4000);
  state = await instance.ask("state");
  check(app, kind, "a message tab opened", main_window_tabs(state).some((tab) => tab.type === "messageDisplay"), JSON.stringify(main_window_tabs(state).map((tab) => tab.type)));
  await shot("message_tab", "message in its own tab");
  await scroll_keys("message tab");
  await find_checks("message tab");
  // The tab shows reading-plain while the list selects another message, so a key that read the list would flag the wrong one.
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(1000);
  await instance.ask("select:reading-html@fixture.invalid", 30000);
  await sleep(1500);
  await instance.ask("select_tab", 20000, { index: 1 });
  await sleep(1500);
  state = await flag_keys();
  check(app, kind, "message tab: m s flags the message of the tab, not the list selection", flagged_ids(state).includes(plain_id) && !flagged_ids(state).includes("reading-html@fixture.invalid"), `flagged ${JSON.stringify(flagged_ids(state))}`);
  // u in the tab undoes the star it just set. g C opens the conversation of the displayed message: it needs the message in Thunderbird's search index, so the result is a note.
  state = await key_and_state(instance, ["u"], 3000);
  check(app, kind, "message tab: u undoes the star", !flagged_ids(state).includes(plain_id), `flagged ${JSON.stringify(flagged_ids(state))}`);
  const tabs_before_conversation = main_window_tabs(state).length;
  await instance.press(["g"]);
  state = await key_and_state(instance, ["C"], 2500);
  note(app, kind, "message tab: g C", `tabs ${tabs_before_conversation} then ${main_window_tabs(state).length}; a new tab means the conversation opened, none means Thunderbird has the command disabled for this message`);
  await shot("message_tab_gC", "message tab after g C: no error notification about a missing mail tab");
  if (main_window_tabs(state).length > tabs_before_conversation) {
    // The conversation tab opened after the message tab. Close it so the tab count below stays one.
    await instance.ask("select_tab", 20000, { index: tabs_before_conversation });
    await sleep(1000);
    await instance.press(["q"]);
    await sleep(1500);
  }
  await instance.ask("select_tab", 20000, { index: 1 });
  await sleep(1000);
  state = await key_and_state(instance, CTRL("k"), 1500);
  check(app, kind, "message tab: C-k switches to the mail tab", active_index(state) === 0, `active ${active_index(state)}`);
  await instance.ask("select_tab", 20000, { index: 1 });
  await sleep(1500);
  state = await key_and_state(instance, ["q"], 1500);
  check(app, kind, "message tab: q closes the tab", main_window_tabs(state).length === 1, `tabs left ${main_window_tabs(state).length}`);
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
  state = await flag_keys();
  check(app, kind, "message window: m s flags the message of the window", flagged_ids(state).includes(plain_id), `flagged ${JSON.stringify(flagged_ids(state))}`);
  await flag_keys();
  state = await key_and_state(instance, CTRL("j"), 1500);
  check(app, kind, "message window: C-j changes nothing and the window stays", state.windows.some((window) => window.type === "messageDisplay"), JSON.stringify(state.windows.map((window) => window.type)));
  state = await key_and_state(instance, ["q"], 2500);
  check(app, kind, "message window: q closes the window", !state.windows.some((window) => window.type === "messageDisplay"), JSON.stringify(state.windows.map((window) => window.type)));
  await instance.ask("close_message_windows");
  await sleep(1500);
  check(app, kind, "the app survived", instance.exited() === null);
}

// The style kinds open the Inbox with keys and run the mode label checks alone.
async function run_mode_label_kind(instance) {
  const { app, kind } = instance;
  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  await run_mode_label(instance, { app, kind, shot: async (name, line) => { const path = await instance.shot(`${app}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; } });
  if (kind === "mode_label_themed") await run_window_hint_colors(instance, { app, kind });
}

// The labels of the mail window wear the theme: the box is the primary color of the scheme Thunderbird shows, and the letters its background color.
async function run_window_hint_colors(instance, { app, kind }) {
  const { resolve_theme } = await import("../../src/background/theme/palette.ts");
  const theme = resolve_theme(THEMED_LABEL);
  const whole_window = "0,0 1280x720";
  const bar = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_bar`, LABEL_STRIP, "ppm"));
  const scheme = luminance_of([...bar].sort((a, b) => b[1] - a[1])[0][0]) < 0.2 ? "dark" : "light";
  const other = scheme === "dark" ? "light" : "dark";
  const before = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_before`, whole_window, "ppm"));
  await instance.press(["f"]);
  await sleep(1000);
  const raw = ppm_colors(await instance.shot_region(`${app}_${kind}_hint_labels`, whole_window, "ppm"));
  await instance.shot(`${app}_${kind}_hint_labels_shot`);
  const fill = theme[scheme].primary;
  check(app, kind, `window hints: the label boxes fill with the ${THEMED_LABEL} ${scheme} primary color`, (raw.get(fill) ?? 0) > (before.get(fill) ?? 0) + 200 && !raw.has(theme[other].primary), `${fill} ${before.get(fill) ?? 0} then ${raw.get(fill) ?? 0} px, the ${other} one ${theme[other].primary} ${raw.get(theme[other].primary) ?? 0} px`);
  await instance.press(["-k", "Escape"]);
  await sleep(600);
}

async function run_assertions(instance) {
  if (process.env.E2E_SCALE === "1") return run_scale(instance);
  if (instance.kind === "default") await run_default(instance);
  else if (instance.kind === "message" || instance.kind === "message_remote") await run_message_scripts(instance);
  else if (instance.kind === "mail_account") await run_mail_account(instance);
  else if (instance.kind === "quick_reply_plain" || instance.kind === "quick_reply_html") await run_quick_replies(instance);
  else if (instance.kind === "own_pages") await run_own_pages(instance);
  else if (instance.kind === "compose_editor") await run_compose_editor(instance);
  else if (instance.kind in COMPOSE_EDITOR_HTML_KINDS) await run_compose_editor_html(instance);
  else if (instance.kind in MODE_LABEL_KINDS) await run_mode_label_kind(instance);
  else await run_no_identity(instance);
}

let all_ok = true;
for (const app of apps) {
  if (!binaries[app] || !existsSync(binaries[app])) throw new Error(`no binary for ${app} at ${binaries[app]}`);
  const kinds = (process.env.E2E_KINDS ?? "default,reply_no_identity,mail_account,message,message_remote,quick_reply_plain,quick_reply_html,mode_label_badge,mode_label_off,mode_label_themed,own_pages,compose_editor,compose_editor_html,compose_editor_html_top").split(",");
  for (const kind of kinds) {
    const work_dir = join(e2e_dir, app, kind);
    const seeds = kind.startsWith("quick_reply") ? { desertbird_quick_replies: { record_version: 1, slots: QUICK_REPLY_SEED } } : kind.startsWith("compose_editor") ? { desertbird_settings: { external_editor: true } } : MODE_LABEL_KINDS[kind];
    if (kind.startsWith("compose_editor")) install_editor_host(work_dir, kind);
    const kind_xpi = xpi_path && seeds ? seed_storage(xpi_path, work_dir, seeds) : xpi_path && kind === "own_pages" ? seed_storage(xpi_path, work_dir, {}, OPEN_OWN_PAGES_SCRIPT) : xpi_path;
    const kind_began = Date.now();
    const instance = await start_app({ app, app_binary: binaries[app], work_dir, kind, xpi_path: kind_xpi });
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
      timings.add_kind({ app, kind, wall_ms: Date.now() - kind_began, startups: instance.startups, peak_memory_kb: instance.memory() });
      timings.write();
    }
  }
}
if (xpi_path) {
  writeFileSync(join(e2e_dir, "report.json"), JSON.stringify(report, null, 2));
  all_ok = all_ok && report.checks.every((entry) => entry.ok);
}
process.exit(all_ok ? 0 : 1);
