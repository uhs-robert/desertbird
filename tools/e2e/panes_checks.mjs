// The relative pane keys in the mail tab: H and Alt+h go one pane left, L and Alt+l one pane right, and each stops at the edge. It takes the helpers of `run.mjs` as arguments.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
const first_selected = (state) => state.selected[0]?.header_id ?? null;

export async function run_pane_moves(instance, ctx) {
  const { check, shot, key_and_state, wait_state, wait_for_state } = ctx;
  const app = instance.app;
  const kind = instance.kind ?? "default";
  const folder_of = (state) => state.mail_tab?.folder ?? null;

  await instance.ask("show_folder", 20000, { path: "/Inbox" });
  await wait_state(instance, "the Inbox to list its messages", (state) => folder_of(state) === "/Inbox" && state.listed.length > 0, { timeout_ms: 10000 });
  await key_and_state(instance, ["g", "e"], { what: "g e to leave the focus in the thread list", until: () => true });
  await key_and_state(instance, ["G"], { what: "G to select the last row", until: (state) => first_selected(state) !== null && first_selected(state) === state.listed.at(-1) });
  // The Inbox threads open collapsed and show a summary, so the second last row, a single message, is the one that lets the message pane take the focus.
  await key_and_state(instance, ["k"], { what: "k to select the second last row", until: (state) => first_selected(state) !== null && first_selected(state) === state.listed.at(-2) });
  const row = first_selected(await instance.ask("state"));

  // Native Down tells the focused pane: it moves the folder in the folder pane, the selection in the thread list, and nothing in the message. The probe puts the selection back, so it changes no row.
  const probe = async () => {
    const before = await instance.ask("state");
    const moved = (state) => folder_of(state) !== folder_of(before) || first_selected(state) !== first_selected(before);
    const after = await key_and_state(instance, ["-k", "Down"], { what: "native Down to move a folder or a row", until: moved, soft: true, timeout_ms: 1500 });
    if (folder_of(after) !== folder_of(before)) {
      await key_and_state(instance, ["-k", "Up"], { what: "Up to return to the folder", until: (state) => folder_of(state) === folder_of(before) });
      return "folders";
    }
    if (first_selected(after) !== first_selected(before)) {
      await key_and_state(instance, ["-k", "Up"], { what: "Up to return to the row", until: (state) => first_selected(state) === first_selected(before) && state.displayed.length === 1 && state.displayed[0].header_id === first_selected(before) });
      return "threads";
    }
    return "message";
  };
  // The helper state shows no pane focus, and the pane command lands after the key is injected, so one probe right after the key can see the old pane. The move polls the probe until it shows the expected pane, which a late command satisfies, and one more probe then confirms the focus held, which a late move past an edge would break.
  const move = async (name, keys, expected) => {
    await instance.press(keys);
    let pane = await probe();
    const began = Date.now();
    while (pane !== expected && Date.now() - began < 5000) pane = await probe();
    if (pane === expected) pane = await probe();
    check(app, kind, name, pane === expected, `the focus is in the ${pane} pane, expected ${expected}`);
  };

  check(app, kind, "the run starts with the focus in the thread list on a single message", (await probe()) === "threads" && row !== null, `row ${row}`);
  await move("L in the thread list focuses the message pane", ["L"], "message");
  await shot("panes_relative_L", "the message pane focused by L");
  await move("L in the message pane stays: it is the last pane", ["L"], "message");
  await move("H in the message pane focuses the thread list", ["H"], "threads");
  await move("H in the thread list focuses the folder pane", ["H"], "folders");
  await move("H in the folder pane stays: it is the first pane", ["H"], "folders");
  await move("L in the folder pane focuses the thread list", ["L"], "threads");

  await move("Alt+l in the thread list focuses the message pane", ALT("l"), "message");
  await move("Alt+l in the message pane stays: it is the last pane", ALT("l"), "message");
  await move("Alt+h in the message pane focuses the thread list", ALT("h"), "threads");
  await move("Alt+h in the thread list focuses the folder pane", ALT("h"), "folders");
  await move("Alt+h in the folder pane stays: it is the first pane", ALT("h"), "folders");
  await move("Alt+l in the folder pane focuses the thread list", ALT("l"), "threads");

  await wait_for_state(instance, { what: "the selection to stay on the row", until: (state) => first_selected(state) === row, show: (state) => `selected ${first_selected(state)}` });
}

// Resize mode (`w r`) in the mail tab: the border of the focused pane moves by direction, the label shows RESIZE, and the mode ends where it should. It takes the helpers of `run.mjs` as arguments, as `run_panes` does, and runs at the end of it.
// The helper add-on reads no pane size, so a size comes from a screenshot: the splitter between the folder pane and the thread list is the darkest pixel of a row inside the window (`edge_x`). The label is compared as a hash of its screenshot strip. The splitter above the message pane is the second border-colored line of a column (`edge_y`). Waits poll those reads. The negative rows end at the barrier of `run.mjs`.
// The layout is the classic one the run starts in. The vertical layout and a layout change are unit tests (`test/pane_resize.test.ts`, `test/runtime.test.ts`): the helper add-on cannot set a layout.
const STEP_PX = 24;
// The status bar label sits at the bottom left. The strip is wide enough for `-- RESIZE --`.
const LABEL_STRIP = "50,692 130x24";
// A row inside the message pane, below its text: the folder pane, the splitter and the message pane meet in it.
const EDGE_ROW = "0,500 1280x1";
// A column inside the message pane header: the column header line, the splitter above the message pane and the line under its header all have the border color, in that order.
const EDGE_COLUMN = "1000,100 1x590";
const BORDER_COLOR = [217, 217, 222];

function read_ppm(path) {
  const ppm = readFileSync(path);
  let body = 0;
  for (let newlines = 0; newlines < 3; body++) if (ppm[body] === 10) newlines++;
  return { width: Number(ppm.subarray(0, body).toString().split(/\s+/)[1]), pixels: ppm.subarray(body) };
}

export async function run_resize_mode(instance, ctx) {
  const { check, note, shot, wait_for, wait_state, expect_absent, barrier } = ctx;
  const app = instance.app;
  const kind = instance.kind ?? "default";
  const taken = { count: 0 };
  const name_of = (what) => `${app}_${kind}_resize_${what}_${taken.count++}`;
  const hash_of = async (what, region) => createHash("sha256").update(readFileSync(await instance.shot_region(name_of(what), region))).digest("hex");
  const label = () => hash_of("label", LABEL_STRIP);
  // The y of the splitter above the message pane: the second border-colored pixel of the column.
  async function edge_y() {
    const { pixels } = read_ppm(await instance.shot_region(name_of("edge_y"), EDGE_COLUMN, "ppm"));
    // A rule can be more than one pixel row thick, so rows in a run count as one line.
    const lines = [];
    let in_line = false;
    for (let y = 0; y < pixels.length / 3; y++) {
      const is_border = BORDER_COLOR.every((channel, at) => Math.abs(pixels[y * 3 + at] - channel) <= 4);
      if (is_border && !in_line) lines.push(y + 100);
      in_line = is_border;
    }
    return lines[1] ?? -1;
  }
  // The x of the splitter: the darkest pixel of the row between the spaces bar and the middle of the window.
  async function edge_x() {
    const { width, pixels } = read_ppm(await instance.shot_region(name_of("edge"), EDGE_ROW, "ppm"));
    let darkest = { x: -1, value: 4 * 255 };
    for (let x = 60; x < Math.min(width, 900); x++) {
      const value = pixels[x * 3] + pixels[x * 3 + 1] + pixels[x * 3 + 2];
      if (value < darkest.value) darkest = { x, value };
    }
    return darkest.x;
  }
  const press = async (...keys) => {
    for (const key of keys) await instance.press(Array.isArray(key) ? key : [key]);
  };
  const edge_leaves = (x) => wait_for(instance, `the folder pane border to leave x ${x}`, edge_x, (now) => now !== x, { timeout_ms: 8000, show: (now) => `x ${now}` });
  const edge_reaches = (what, x) => wait_for(instance, `the folder pane border to reach x ${x} (${what})`, edge_x, (now) => Math.abs(now - x) <= 2, { timeout_ms: 8000, show: (now) => `x ${now}` });
  const label_leaves = (what, hash) => wait_for(instance, what, label, (now) => now !== hash, { timeout_ms: 8000 });
  const label_reaches = (what, hash) => wait_for(instance, what, label, (now) => now === hash, { timeout_ms: 8000 });
  const near = (a, b) => Math.abs(a - b) <= 2;

  await press("g", "e");
  await press("g", "f");
  const normal_label = await label();
  const start_x = await edge_x();
  note(app, kind, "resize mode: start", `splitter at x ${start_x}`);
  check(app, kind, "the folder pane border is found in the screenshot row", start_x > 100 && start_x < 700, `x ${start_x}`);

  await press("w", "r");
  const resize_label = await label_leaves("the label to change when w r starts the mode", normal_label);
  check(app, kind, "w r shows the RESIZE label, which is not the normal one", resize_label !== normal_label);
  await shot("panes_resize_label", "the label in resize mode with the folder pane focused");

  await press("l");
  let x = await edge_leaves(start_x);
  check(app, kind, "l in the folder pane moves its border right by one step", near(x, start_x + STEP_PX), `x ${start_x} then ${x}`);
  // The grid caps how wide the folder pane gets (the thread list keeps its minimum), so the counted steps stay short of the cap that the vertical layout of Thunderbird reaches at about 100 pixels.
  await press("2", "l");
  x = await edge_reaches("2 l", start_x + 3 * STEP_PX);
  check(app, kind, "2 l moves it two steps more", near(x, start_x + 3 * STEP_PX), `x ${x}`);
  await press("l");
  x = await edge_reaches("l after a count", start_x + 4 * STEP_PX);
  check(app, kind, "the count applied once: the next l is one step", near(x, start_x + 4 * STEP_PX), `x ${x}`);
  await press("h");
  x = await edge_reaches("h", start_x + 3 * STEP_PX);
  check(app, kind, "h moves the border left by one step", near(x, start_x + 3 * STEP_PX), `x ${x}`);
  await shot("panes_resize_wide", "the folder pane three steps wider");
  await press("=");
  x = await edge_reaches("=", start_x);
  check(app, kind, "= puts the folder pane back to its default width", near(x, start_x), `x ${x}`);

  // The thread list takes the height keys: j moves the border of the message pane down, which makes the pane shorter.
  await press(ALT("l"));
  const start_y = await edge_y();
  // Thunderbird ESR shows the vertical layout in this profile: no horizontal splitter, so j and k have no border and refuse.
  if (start_y === -1) note(app, kind, "resize mode: height keys", "no message pane border in the screenshot column (the vertical layout): j and k are not driven");
  else {
    check(app, kind, "the message pane border is found in the screenshot column", start_y > 120 && start_y < 600, `y ${start_y}`);
    const edge_y_reaches = (what, y) => wait_for(instance, `the message pane border to reach y ${y} (${what})`, edge_y, (now) => near(now, y), { timeout_ms: 8000, show: (now) => `y ${now}` });
    await press("j");
    let y = await edge_y_reaches("j", start_y + STEP_PX);
    check(app, kind, "j in the thread list moves the message pane border down by one step", near(y, start_y + STEP_PX), `y ${start_y} then ${y}`);
    await press("k");
    y = await edge_y_reaches("k", start_y);
    check(app, kind, "k moves it back up", near(y, start_y), `y ${y}`);
    await press("2", "j");
    y = await edge_y_reaches("2 j", start_y + 2 * STEP_PX);
    check(app, kind, "2 j moves it two steps", near(y, start_y + 2 * STEP_PX), `y ${y}`);
    await press("=");
    y = await edge_y_reaches("=", start_y);
    check(app, kind, "= restores the message pane height too", near(y, start_y), `y ${y}`);
  }

  // Keys that are not the mode's are swallowed: d d would delete and a would archive if one leaked.
  const inbox_count = (state) => state.folders["/Inbox"].length;
  const inbox_before = inbox_count(await instance.ask("state"));
  await press("d", "d", "a", "x");
  await expect_absent(instance, "d d, a and x in resize mode leak to nothing: the Inbox keeps its messages", (state) => (inbox_count(state) === inbox_before ? null : `Inbox ${inbox_before} then ${inbox_count(state)}`), { margin_ms: 1500, in_list: false });
  check(app, kind, "the label still shows resize after the swallowed keys", (await label()) === resize_label);

  // Each way out. The label returns to the normal one, and l then moves nothing.
  async function ends(what, end, { restore = async () => {} } = {}) {
    await press("w", "r");
    await label_reaches(`the label to show resize again (${what})`, resize_label);
    await end();
    const back = await label_leaves(`the label to leave resize (${what})`, resize_label);
    check(app, kind, `${what} ends resize mode and the label is no longer resize`, back !== resize_label);
    await restore();
    await press("g", "f");
    const edge_before = await edge_x();
    await press("l");
    await barrier(instance);
    const edge_after = await edge_x();
    check(app, kind, `l after ${what} moves no border`, near(edge_before, edge_after), `x ${edge_before} then ${edge_after}`);
  }
  await press("w", "r");
  await label_reaches("the label to show resize before Escape", resize_label);
  await press(["-k", "Escape"]);
  check(app, kind, "Escape ends resize mode and the label returns to normal", (await label_reaches("the label to return to normal after Escape", normal_label)) === normal_label);
  await press("g", "f");
  let edge_before = await edge_x();
  await press("l");
  await barrier(instance);
  check(app, kind, "l after Escape moves no border", near(edge_before, await edge_x()), `x ${edge_before}`);

  await ends("Enter", () => press(["-k", "Return"]));
  await ends("a tab change", async () => {
    await instance.ask("open_content_tab");
  }, { restore: async () => {
    await instance.ask("reset_tabs");
    await wait_state(instance, "the extra tab to close", (state) => state.windows.every((window) => window.tabs.length === 1), { timeout_ms: 8000 });
  } });
  let popup = null;
  await ends("a window blur", async () => {
    popup = (await instance.ask("open_popup_window")).opened;
  }, { restore: async () => {
    await instance.ask("close_popup_window", 10000, { id: popup });
    await wait_state(instance, "the popup window to close", (state) => state.windows.length === 1, { timeout_ms: 8000 });
  } });

  // Re-entering while in the mode: the second w r is swallowed, and one Escape ends it.
  await press("w", "r");
  await label_reaches("the label to show resize before the second w r", resize_label);
  await press("w", "r");
  await press(["-k", "Escape"]);
  check(app, kind, "w r while in the mode changes nothing, and one Escape ends it", (await label_reaches("the label to return to normal after w r twice", normal_label)) === normal_label);

  await press("g", "e");
  edge_before = await edge_x();
  check(app, kind, "the folder pane is back at its default width at the end", near(edge_before, start_x), `x ${edge_before}`);
  check(app, kind, "the app survived the resize mode checks", instance.exited() === null);
}
