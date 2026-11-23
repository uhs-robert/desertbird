// The command line in a standalone message window: `:` and the keys that start tag, move and copy, from the body and from the header, what the window shows after a move, and the lifecycle of the line (a second chrome window with its own line, a message that goes away under the open line).

import { sleep } from "../predicates.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";

export const areas = ["cmdline", "message_body"];

const WORK_TAG = "$label2";
const BODY_POINT = [800, 600];
// The bottom-left corner of the screen, where only the main window shows: the message window starts to the right of it. It holds the rows of the main line and none of its blinking caret.
// The right half of the bottom bar of a message window: the line fills it while it is open, and the status text, which can change at any time, stays on the left.
const LINE_BAR = "700,690 370x28";
// Where the hud draws in a message window: the lower right of the screen.
const WINDOW_HUD_REGION = "600,300 660x420";
// Longer than the refusal toast lasts, so the next step starts with no toast up.
const TOAST_WAIT_MS = 8000;
const MAIN_CORNER = "0,500 200x180";

const body_state = (state) => state.body ?? { live: false, scroll_y: -1, has_focus: null };

const body_reports = (what, since, window_ids) => ({ what: `the document of ${what} to report`, until: (state) => state.body !== null && state.body.doc_start >= since && window_ids(state).includes(state.body.window_id), show: (state) => `body of window ${state.body?.window_id}, started ${state.body?.doc_start}`, timeout_ms: 10000 });

const message_windows = (state) => state.windows.filter((window) => window.type === "messageDisplay");
const title_of = (state, window_id) => state.windows.find((window) => window.id === window_id)?.tabs[0]?.title ?? null;

async function run_window_cmdline(instance, ctx) {
  const { app, kind, report, check, open_inbox, wait_for_state, key_and_state, wait_pixels, hud_pixels, open_command_line, press_in_command_line, close_command_line } = ctx;
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${kind}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };
  const return_key = ["-k", "Return"];
  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);

  const main_window_id = (await instance.ask("state")).windows.find((window) => window.type === "normal")?.id;
  const focus = async (window_id) => {
    await instance.ask("focus_window", 20000, { windowId: window_id });
    await sleep(800);
  };
  // Opens the message with this Message-ID in a message window and waits for its document to report.
  const open_window_of = async (id) => {
    await focus(main_window_id);
    await instance.ask(`select:${id}@fixture.invalid`, 30000);
    await sleep(800);
    const since = Date.now();
    await instance.ask("open_message_window");
    const state = await wait_for_state(instance, body_reports(`the window of ${id}`, since, (current) => message_windows(current).map((window) => window.id)));
    await focus(state.body.window_id);
    return state.body.window_id;
  };
  // The helper selects in the mail tab of the focused window, so a message goes through the main window.
  const select_in_main = async (id, window_id) => {
    await focus(main_window_id);
    await instance.ask(`select:${id}@fixture.invalid`, 30000);
    await sleep(800);
    await focus(window_id);
  };
  const fresh_report = async (window_id) => {
    const since = Date.now();
    await instance.ask("report_window", 20000, { windowId: window_id });
    await sleep(600);
    const current = await instance.ask("state");
    return current.body?.window_id === window_id && (current.body.reported_at ?? 0) >= since ? body_state(current) : null;
  };
  // Escape until the bottom bar matches the one from before the line opened, at most three times. The first Escape hides the completion list and the next closes the line. One more would close the message window, which Thunderbird does on an Escape no line takes, so the loop stops at the baseline and the shared `close_command_line`, which presses once more to prove the line is gone, is not used.
  const close_line_to = async (baseline) => {
    let pixels = null;
    for (let press = 0; press < 3 && pixels !== baseline; press++) {
      await instance.press(["-k", "Escape"]);
      await sleep(500);
      pixels = await hud_pixels(instance, `${app}_line_closed`, LINE_BAR);
    }
    return pixels;
  };
  // Two Escapes with no baseline to compare with, since the message under the line changed. The check that follows is that j scrolls.
  const close_line_blind = async () => {
    for (let press = 0; press < 2; press++) {
      await instance.press(["-k", "Escape"]);
      await sleep(500);
    }
    await sleep(1000);
  };
  const scrolls_on_j = async (what) => {
    const from = body_state(await instance.ask("state")).scroll_y;
    const moved = await key_and_state(instance, ["j"], { what: `j to scroll the body ${what}`, until: (state) => body_state(state).scroll_y > from, show: (state) => `scrollY ${body_state(state).scroll_y}`, timeout_ms: 4000, soft: true });
    return { from, to: body_state(moved).scroll_y, ok: body_state(moved).scroll_y > from };
  };
  const type_and_run = async (keys, typed) => {
    for (const key of keys.slice(0, -1)) await instance.press([key]);
    await open_command_line(instance, keys.slice(-1), { attempts: 2, timeout_ms: 4000 });
    await press_in_command_line(instance, [typed]);
    await instance.press(return_key);
  };
  const tags_of = (state, id) => state.flags[`${id}@fixture.invalid`]?.tags ?? [];
  const ids_in = (state, path) => state.folders[path] ?? [];

  // The line from the body.
  const window_id = await open_window_of("reading-plain");
  const baseline = await hud_pixels(instance, `${app}_line_baseline`, LINE_BAR);
  const list_before = await hud_pixels(instance, `${app}_list_before`, ctx.key_list_region);
  const drawn = await open_command_line(instance, [":"], { attempts: 2, timeout_ms: 4000 });
  await shot("window_line_open", "the message window with the command line over its bottom edge and the list of commands above it");
  check(app, kind, "message window body: : draws the command line", drawn !== list_before, "the region did not change");
  const closed = await close_line_to(baseline);
  await shot("window_line_closed", "the message window after two Escapes: the line is gone and the message is still shown");
  check(app, kind, "message window body: two Escapes close the line and leave the window open", closed === baseline && message_windows(await instance.ask("state")).length === 1, "the region differs from before the line, or the window closed");
  let scrolled = await scrolls_on_j("after Escape");
  check(app, kind, "message window body: after the line closes the keys go to the body, so j scrolls", scrolled.ok, `scrollY ${scrolled.from} then ${scrolled.to}`);

  // Tag, copy and the command scope, from the body.
  await type_and_run(["m", "t"], "Work");
  let state = await wait_for_state(instance, { what: "m t Work to tag the message of the window", until: (current) => tags_of(current, "reading-plain").includes(WORK_TAG), show: (current) => JSON.stringify(tags_of(current, "reading-plain")), timeout_ms: 8000, soft: true });
  check(app, kind, "message window body: m t then Work tags the message of the window", tags_of(state, "reading-plain").includes(WORK_TAG), JSON.stringify(tags_of(state, "reading-plain")));
  scrolled = await scrolls_on_j("after a tag");
  check(app, kind, "message window body: after a command ran the keys go to the body", scrolled.ok, `scrollY ${scrolled.from} then ${scrolled.to}`);
  await type_and_run(["m", "c"], "/Trash");
  state = await wait_for_state(instance, { what: "m c /Trash to copy the message", until: (current) => ids_in(current, "/Trash").includes("reading-plain@fixture.invalid"), show: (current) => JSON.stringify(ids_in(current, "/Trash")), timeout_ms: 10000, soft: true });
  check(app, kind, "message window body: m c then /Trash copies the message and keeps it in Reading", ids_in(state, "/Trash").includes("reading-plain@fixture.invalid") && ids_in(state, "/Reading").includes("reading-plain@fixture.invalid"), `Trash ${JSON.stringify(ids_in(state, "/Trash"))}`);
  const scope_baseline = await hud_pixels(instance, `${app}_line_baseline`, LINE_BAR);
  await open_command_line(instance, [":"], { attempts: 2, timeout_ms: 4000 });
  await press_in_command_line(instance, ["sort --date --ascending"]);
  const refused_before = await hud_pixels(instance, `${app}_scope_before`, ctx.key_list_region);
  await instance.press(return_key);
  const refused = await wait_pixels(instance, "the line to show the refusal", `${app}_scope_after`, ctx.key_list_region, ctx.drawn_since(refused_before), { timeout_ms: 3000 });
  await shot("window_line_refused", "the line after sort was run in a message window: the line stays open and shows that sort is not available there");
  check(app, kind, "message window: a command the window does not offer is refused in the line, which stays open", refused !== refused_before, "the line did not change");
  const scope_closed = await close_line_to(scope_baseline);
  check(app, kind, "message window: Escape closes the line after a refusal, and the window stays open", scope_closed === scope_baseline && message_windows(await instance.ask("state")).length === 1, "the line is still there or the window closed");

  // The line from the header, where the keys come from the pages bundle.
  await instance.press(["-k", "F6"]);
  await sleep(800);
  check(app, kind, "message window: F6 takes the focus out of the body", (await fresh_report(window_id))?.has_focus === false);
  await type_and_run(["m", "t"], "Work");
  state = await wait_for_state(instance, { what: "m t Work in the header to take the tag off again", until: (current) => !tags_of(current, "reading-plain").includes(WORK_TAG), show: (current) => JSON.stringify(tags_of(current, "reading-plain")), timeout_ms: 8000, soft: true });
  check(app, kind, "message window header: m t then Work toggles the tag of the message", !tags_of(state, "reading-plain").includes(WORK_TAG), JSON.stringify(tags_of(state, "reading-plain")));
  scrolled = await scrolls_on_j("from the header after the tag");
  check(app, kind, "message window header: after the line closes the keys go on from the header, so j scrolls the body", scrolled.ok, `scrollY ${scrolled.from} then ${scrolled.to}`);
  const header_baseline = await hud_pixels(instance, `${app}_line_baseline`, LINE_BAR);
  await open_command_line(instance, [":"], { attempts: 2, timeout_ms: 4000 });
  await close_line_to(header_baseline);
  scrolled = await scrolls_on_j("from the header after Escape");
  check(app, kind, "message window header: Escape from the line returns the keys to the header, so j scrolls the body", scrolled.ok, `scrollY ${scrolled.from} then ${scrolled.to}`);

  // The which-key panel and the toasts draw in the window. `g` waits for the panel delay, and `m f c` with no reminder shows a refusal toast.
  const panel_in_window = async (what) => {
    const bare = await hud_pixels(instance, `${app}_hud_bare`, WINDOW_HUD_REGION);
    await instance.press(["g"]);
    const panel = await wait_pixels(instance, `the which-key panel ${what}`, `${app}_hud_panel`, WINDOW_HUD_REGION, ctx.drawn_since(bare), { timeout_ms: 4000 });
    await shot(`window_which_key_${what.replace(/ /g, "_")}`, `the message window with the which-key panel after g, ${what}`);
    check(app, kind, `message window ${what}: g shows the which-key panel after the delay`, panel !== bare, "the region did not change");
    // A key that continues no prefix ends it and moves nothing. Escape would close the window, which Thunderbird does on an Escape no line takes, and g g would scroll the body.
    await instance.press(["x"]);
    const gone = await wait_pixels(instance, `the panel ${what} to go`, `${app}_hud_gone`, WINDOW_HUD_REGION, ctx.back_to(bare), { timeout_ms: 4000 });
    check(app, kind, `message window ${what}: a stray key removes the panel`, gone === bare, "the region still differs");
  };
  await panel_in_window("in the header");
  await instance.press(["-k", "F6"]);
  await sleep(800);
  await panel_in_window("in the body");
  const toast_bare = await hud_pixels(instance, `${app}_toast_bare`, WINDOW_HUD_REGION);
  for (const key of ["m", "f", "c"]) await instance.press([key]);
  const toast = await wait_pixels(instance, "the refusal toast of m f c to draw in the window", `${app}_toast`, WINDOW_HUD_REGION, ctx.drawn_since(toast_bare), { timeout_ms: 4000 });
  await shot("window_toast", "the message window with the refusal toast of m f c");
  check(app, kind, "message window: a refused command (m f c, no reminder to cancel) shows a toast in the window", toast !== toast_bare, "the region did not change");
  await sleep(TOAST_WAIT_MS);

  // Move: the window shows the next message of the list.
  await instance.click(...BODY_POINT);
  await sleep(500);
  await type_and_run(["m", "m"], "/Html");
  state = await wait_for_state(instance, { what: "m m /Html to move the message away from Reading", until: (current) => !ids_in(current, "/Reading").includes("reading-plain@fixture.invalid"), show: (current) => JSON.stringify(ids_in(current, "/Reading")), timeout_ms: 10000, soft: true });
  check(app, kind, "message window: m m then /Html moves the message out of Reading", !ids_in(state, "/Reading").includes("reading-plain@fixture.invalid"), JSON.stringify(ids_in(state, "/Reading")));
  state = await wait_for_state(instance, { what: "the window to show the next message", until: (current) => title_of(current, window_id) === "Reading html", show: (current) => `title ${title_of(current, window_id)}`, timeout_ms: 8000, soft: true });
  await shot("window_after_move", "the message window after m m moved its message away: the next message of the list is shown and there is no line");
  check(app, kind, "message window: after the move the window stays open and shows the next message", title_of(state, window_id) === "Reading html", `title ${title_of(state, window_id)}`);
  await sleep(1500);
  scrolled = await scrolls_on_j("after the move");
  check(app, kind, "message window: after the move the keys go to the body of the next message", scrolled.ok, `scrollY ${scrolled.from} then ${scrolled.to}`);

  // Two chrome windows, each with its own line.
  await focus(main_window_id);
  const main_before = await hud_pixels(instance, `${app}_main_corner_before`, MAIN_CORNER);
  await open_command_line(instance, [":"], { attempts: 2, timeout_ms: 4000 });
  const main_open = await wait_pixels(instance, "the main window's line to hold still", `${app}_main_corner_open`, MAIN_CORNER, ctx.drawn_since(main_before), { timeout_ms: 3000 });
  check(app, kind, "the main window shows its command line while a message window is open", main_open !== main_before, "the corner did not change");
  await focus(window_id);
  const second_baseline = await hud_pixels(instance, `${app}_line_baseline`, LINE_BAR);
  await open_command_line(instance, [":"], { attempts: 2, timeout_ms: 4000 });
  await shot("two_lines", "the main window and a message window, each with its own command line");
  await close_line_to(second_baseline);
  const main_after = await hud_pixels(instance, `${app}_main_corner_after`, MAIN_CORNER);
  check(app, kind, "closing the line of the message window leaves the line of the main window open", main_after === main_open, "the corner of the main window changed");
  scrolled = await scrolls_on_j("after the line of the other window");
  check(app, kind, "message window: j scrolls while the main window's line is open", scrolled.ok, `scrollY ${scrolled.from} then ${scrolled.to}`);
  await focus(main_window_id);
  await close_command_line(instance);
  await focus(window_id);

  // The message goes away under the open line. The helper archives what the main window selects, so the main window selects the shown message first.
  const under_line = async (what, shown_id, next_title, focus_header) => {
    await select_in_main(shown_id, window_id);
    await instance.click(...BODY_POINT);
    await sleep(500);
    if (focus_header) {
      await instance.press(["-k", "F6"]);
      await sleep(800);
    }
    await open_command_line(instance, [":"], { attempts: 2, timeout_ms: 4000 });
    await instance.ask("api_archive", 30000);
    const after = await wait_for_state(instance, { what: `the window to show ${next_title}`, until: (current) => title_of(current, window_id) === next_title, show: (current) => `title ${title_of(current, window_id)}`, timeout_ms: 10000, soft: true });
    await shot(`window_line_under_${what.replace(" ", "_")}`, `the message window with the line open after its message was archived (${what}): the next message shows`);
    check(app, kind, `message window ${what}: a message archived under the open line gives the window the next message`, title_of(after, window_id) === next_title, `title ${title_of(after, window_id)}`);
    await close_line_blind();
    const result = await scrolls_on_j(`after Escape, message gone, ${what}`);
    check(app, kind, `message window ${what}: after the message went away and Escape the keys are back on the window, so j scrolls`, result.ok, `scrollY ${result.from} then ${result.to}`);
  };
  await under_line("body focus", "reading-html", "Reading remote content", false);
  await under_line("header focus", "reading-remote", "Reading sandboxed html", true);

  // The last message goes away under the open line, and the window closes with it.
  await select_in_main("reading-sandbox", window_id);
  await instance.click(...BODY_POINT);
  await sleep(500);
  await open_command_line(instance, [":"], { attempts: 2, timeout_ms: 4000 });
  await instance.ask("api_archive", 30000);
  state = await wait_for_state(instance, { what: "the message window to close", until: (current) => message_windows(current).length === 0, show: (current) => JSON.stringify(current.windows.map((window) => window.type)), timeout_ms: 10000, soft: true });
  check(app, kind, "the last message archived under the open line closes the window and its line with it", message_windows(state).length === 0, JSON.stringify(state.windows.map((window) => window.type)));
  await focus(main_window_id);
  const main_line_before = await hud_pixels(instance, `${app}_main_line_before`, ctx.key_list_region);
  const main_line = await open_command_line(instance, [":"], { attempts: 2, timeout_ms: 4000 });
  check(app, kind, "after that window closed the main window opens its command line again", main_line !== main_line_before, "the region did not change");
  await close_command_line(instance);
  check(app, kind, "the app survived", instance.exited() === null);
}

export const piece = { kind: "message", section: "window_cmdline", profile_kind: "message", deadline_s: LONG_PIECE_DEADLINE_S, run: run_window_cmdline };
