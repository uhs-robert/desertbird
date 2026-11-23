// J, K, ] u and [ u in a message window opened from a list: each steps the window's message, a step at either end or past the last unread message refuses with a toast and never wraps, and `] u` skips a read message. The window comes from `messageDisplay.open`, so its view is the Reading folder in list order (plain, html, remote, sandbox).

import { sleep } from "../predicates.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";

export const areas = ["message_body", "mail_keys", "motions"];

// The region of a message window where its toast draws, and a wait that outlasts the toast.
const WINDOW_HUD_REGION = "600,300 660x420";
const TOAST_WAIT_MS = 8000;

const SUBJECTS = { plain: "Reading plain", html: "Reading html", remote: "Reading remote content", sandbox: "Reading sandboxed html" };

const body_reports = (what, since, window_ids) => ({ what: `the document of ${what} to report`, until: (state) => state.body !== null && state.body.doc_start >= since && window_ids(state).includes(state.body.window_id), show: (state) => `body of window ${state.body?.window_id}, started ${state.body?.doc_start}`, timeout_ms: 10000 });
const message_windows = (state) => state.windows.filter((window) => window.type === "messageDisplay");
const title_of = (state, window_id) => state.windows.find((window) => window.id === window_id)?.tabs[0]?.title ?? null;

async function run_window_step(instance, ctx) {
  const { app, kind, report, check, open_inbox, wait_for_state, wait_pixels, hud_pixels } = ctx;
  const shot = async (name, line) => {
    const path = await instance.shot(`${app}_${kind}_${name}`);
    report.shots.push({ app, kind, path, name, line });
    return path;
  };
  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);

  const main_window_id = (await instance.ask("state")).windows.find((window) => window.type === "normal")?.id;
  const focus = async (window_id) => {
    await instance.ask("focus_window", 20000, { windowId: window_id });
    await sleep(800);
  };
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
  const shows = (window_id, subject) => ({ what: `the window to show ${subject}`, until: (state) => title_of(state, window_id) === subject, show: (state) => `title ${title_of(state, window_id)}`, timeout_ms: 8000, soft: true });
  // After a step the window loads a new document, and a key before its body script is live reaches no one. So each step waits for the new document to report live.
  const live_again = (window_id, since) => ({ what: "the new document to report live", until: (state) => state.body?.window_id === window_id && state.body.doc_start >= since && state.body.live === true, show: (state) => JSON.stringify(state.body), timeout_ms: 10000, soft: true });
  // Presses each key group in turn and waits for the subject that goes with it, then for the new document to be live.
  const walk = async (window_id, groups, subjects, what) => {
    let state;
    for (const [index, keys] of groups.entries()) {
      const since = Date.now();
      for (const key of keys) await instance.press([key]);
      state = await wait_for_state(instance, shows(window_id, subjects[index]));
      await wait_for_state(instance, live_again(window_id, since));
    }
    const subject = subjects.at(-1);
    check(app, kind, `message window: ${what} shows ${subject}`, title_of(state, window_id) === subject, `title ${title_of(state, window_id)}`);
  };
  const step_to = (window_id, keys, subject, what) => walk(window_id, [keys], [subject], what);
  // A refused step shows a toast in the window and leaves the message as it was. The wait afterwards outlasts the toast, so the next one starts bare.
  const refused = async (window_id, keys, subject, what) => {
    await sleep(500);
    const bare = await hud_pixels(instance, `${app}_step_bare`, WINDOW_HUD_REGION);
    for (const key of keys) await instance.press([key]);
    const toast = await wait_pixels(instance, `the refusal toast of ${what} to draw`, `${app}_step_toast`, WINDOW_HUD_REGION, ctx.drawn_since(bare), { timeout_ms: 4000 });
    const state = await instance.ask("state");
    await shot(`step_refused_${what.replace(/[^a-z]+/gi, "_")}`, `the message window after ${what} was refused: a toast shows and the message is still ${subject}`);
    check(app, kind, `message window: ${what} shows a toast and keeps ${subject}`, toast !== bare && title_of(state, window_id) === subject && message_windows(state).length === 1, `toast ${toast !== bare}, title ${title_of(state, window_id)}`);
    await sleep(TOAST_WAIT_MS);
  };

  // Plain steps in list order, and the two ends.
  const window_id = await open_window_of("reading-html");
  check(app, kind, "message window: opened on Reading html", title_of(await instance.ask("state"), window_id) === SUBJECTS.html);
  await step_to(window_id, ["J"], SUBJECTS.remote, "J");
  await step_to(window_id, ["K"], SUBJECTS.html, "K");
  await step_to(window_id, ["K"], SUBJECTS.plain, "K");
  await refused(window_id, ["K"], SUBJECTS.plain, "K at the first message");
  await walk(window_id, [["J"], ["J"], ["J"]], [SUBJECTS.html, SUBJECTS.remote, SUBJECTS.sandbox], "J, J, J");
  await refused(window_id, ["J"], SUBJECTS.sandbox, "J at the last message");

  // Unread steps. The sandbox message is marked unread and left, then plain is marked unread, so the last message has an earlier unread one that next unread would wrap to.
  for (const key of ["m", "u"]) await instance.press([key]);
  const marked = await wait_for_state(instance, { what: "m u to mark the sandbox message unread", until: (state) => state.flags["reading-sandbox@fixture.invalid"]?.read === false, show: (state) => JSON.stringify(state.flags["reading-sandbox@fixture.invalid"]), timeout_ms: 8000, soft: true });
  check(app, kind, "message window: m u marks the shown message unread", marked.flags["reading-sandbox@fixture.invalid"]?.read === false, JSON.stringify(marked.flags["reading-sandbox@fixture.invalid"]));
  await walk(window_id, [["K"], ["K"], ["K"]], [SUBJECTS.remote, SUBJECTS.html, SUBJECTS.plain], "K, K, K");
  for (const key of ["m", "u"]) await instance.press([key]);
  await wait_for_state(instance, { what: "m u to mark the plain message unread", until: (state) => state.flags["reading-plain@fixture.invalid"]?.read === false, show: (state) => JSON.stringify(state.flags["reading-plain@fixture.invalid"]), timeout_ms: 8000, soft: true });
  await step_to(window_id, ["]", "u"], SUBJECTS.sandbox, "] u over two read messages");
  await refused(window_id, ["]", "u"], SUBJECTS.sandbox, "] u at the last unread message, with an earlier unread one to wrap to");
  await step_to(window_id, ["[", "u"], SUBJECTS.plain, "[ u");
  await refused(window_id, ["[", "u"], SUBJECTS.plain, "[ u at the first unread message");
  check(app, kind, "the app survived", instance.exited() === null);
  check(app, kind, "message window: the window is still the only one", message_windows(await instance.ask("state")).length === 1);
}

export const piece = { kind: "message", section: "window_step", profile_kind: "message", deadline_s: LONG_PIECE_DEADLINE_S, run: run_window_step };
