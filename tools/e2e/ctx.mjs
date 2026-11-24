// The per-piece context: one object per piece run, holding its own report, its wait counters and every helper a piece reads. Nothing here is module state, so a piece that runs in a worker has its own copy.
// A helper takes the instance as its first argument, as the sections always called it. Only check, note and the polled waits close over the context, since they write to its report and counters.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert_start_paths, start_paths_of } from "./run_dir.mjs";
import { seed_storage } from "./seed.mjs";
import { normal_window_focused, HUD_REGION, KEY_LIST_REGION, first_selected, QUIET_AFTER_ESCAPE_MS, TOAST_EXPIRY_MS, back_to, drawn_since, folder_shown, holds_twice, sleep } from "./predicates.mjs";

// Opens the Inbox with keys only. DesertBird gives the folder tree the focus at launch, so it already holds the Local Folders row: Right expands it, Down selects the Inbox and F6 moves focus to the thread list.
// F6 cycles the panes: folder pane, thread list, message body (when a message shows), spaces toolbar, global search. Measured on both apps through the focus chain.
// Counted Tabs from the folder pane are not used: on Betterbird three Tabs end on a column header.
// After a restart Local Folders is already expanded, and Right would step into the Inbox row, so `expanded` skips it.
async function open_inbox(instance, { expanded = false } = {}) {
  if (!expanded) await instance.press(["-k", "Right"]);
  await instance.press(["-k", "Down"]);
  // The status bar keeps "Done" for a few seconds after a folder loads, and the first pixel reads of later checks include it. That has no helper state, so this wait stays fixed, and the folder is read after it.
  // Polling for the Inbox is no faster: after the reminder restart Thunderbird shows another folder, Down does not reach the Inbox, and a poll would wait out its ceiling every run.
  await sleep(1500);
  const opened = (await instance.ask("state")).mail_tab?.folder;
  await instance.press(["-k", "F6"]);
  return opened;
}

async function hud_pixels(instance, name, region = HUD_REGION) {
  return createHash("sha256").update(readFileSync(await instance.shot_region(name, region))).digest("hex");
}

// Reads the state every half second until the selection is the same in three reads in a row. Views starts empty, so an empty selection counts as settled, but only after a quiet window long enough for a late selection to show. Logs a line when it gives up.
async function settled_state(instance, selection_of) {
  let state = await instance.ask("state");
  let equal_reads = 1;
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(500);
    const next = await instance.ask("state");
    equal_reads = selection_of(next) === selection_of(state) ? equal_reads + 1 : 1;
    state = next;
    if (equal_reads >= 3) return state;
  }
  console.log(`settled_state: the selection kept changing for 6 s, reading it as "${selection_of(state)}"`);
  return state;
}

// deps: { timings, binaries, xpi_path, run_dir, start_app }. `piece_dir` is the piece's work dir.
export function create_ctx({ app, kind, section, piece_dir, deps }) {
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

  // Polled waits, in place of a fixed sleep. Each polls a read of the helper add-on until `until` holds, so a key that lands early costs its real latency.
  // A timeout ends the wait with the last read, records a FAIL line that names `what`, and lets the check after it judge the value. It does not throw, because the checks run in one line and a throw would hide every check behind it. `soft` records no FAIL: the wait only settles a state that no later check names.
  const wait_stats = { count: 0, ms: 0, timeouts: 0 };

  async function wait_for(instance, what, read, until, { timeout_ms = 5000, step_ms = 50, soft = false, show = null } = {}) {
    const began = Date.now();
    wait_stats.count++;
    try {
      for (;;) {
        const value = await read();
        if (until(value)) return value;
        if (Date.now() - began > timeout_ms) {
          wait_stats.timeouts++;
          if (soft) console.log(`WAIT ${instance.app}/${instance.kind ?? "default"} timed out after ${timeout_ms} ms: ${what}`);
          else check(instance.app, instance.kind ?? "default", `wait for ${what}`, false, `not met within ${timeout_ms} ms${show ? `, last read: ${show(value)}` : ""}`);
          return value;
        }
        await sleep(step_ms);
      }
    } finally {
      wait_stats.ms += Date.now() - began;
    }
  }

  const wait_state = (instance, what, until, options) => wait_for(instance, what, () => instance.ask("state"), until, options);

  // The barrier is an observed key: w m flips the message pane, the helper reads the flip, and a second w m flips it back. Escape first ends a half-typed sequence or count, as in the startup probe. It needs the focus in the thread list.
  // The flip proves that the keys before it reached the key runtime. Each key's background command runs on its own, so the flip does not prove that a longer command pressed before it has finished: a fold makes four Experiment calls, the flip two. The two flips and their reads give such a command time, and `measure_barrier` checks that on the fold path.
  async function barrier(instance) {
    const pane_start = (await instance.ask("state")).mail_tab?.message_pane_visible;
    const pane_is = (visible) => ({ what: `the barrier w m to ${visible ? "show" : "hide"} the message pane`, until: (state) => state.mail_tab?.message_pane_visible === visible, show: (state) => `message pane visible ${state.mail_tab?.message_pane_visible}` });
    for (const key of ["Escape", "w"]) await instance.press(["-k", key]);
    await key_and_state(instance, ["m"], pane_is(!pane_start));
    await instance.press(["w"]);
    return key_and_state(instance, ["m"], pane_is(pane_start));
  }

  // Records a check that nothing happened. A refused or unbound key has no completion signal, so the check waits `margin_ms`, the fixed wait it had before the polled waits, then reads the state through the barrier where the thread list has the focus (`in_list`). `found` returns what appeared, or null. A key that never arrived also leaves nothing, so the caller needs an earlier proof that its keys work.
  async function expect_absent(instance, name, found, { margin_ms, in_list }) {
    await sleep(margin_ms);
    const state = in_list ? await barrier(instance) : await instance.ask("state");
    const appeared = found(state);
    check(instance.app, instance.kind ?? "default", name, appeared === null, appeared ?? "");
    return state;
  }

  const wait_for_state = (instance, wanted) => wait_state(instance, wanted.what, wanted.until, wanted);

  // Keys go to the focused window, and under load a fresh tab can leave the main window without focus for longer than a fixed sleep. It clicks nothing, so a no-click check keeps its contract.
  // It closes that gap but not every drop: one stressed run still lost the calendar keys after this wait passed, so a single focused read is not proof that keys arrive.
  const wait_window_focus = (instance) => wait_for_state(instance, { what: "the normal window to report focus before the first key", until: normal_window_focused, timeout_ms: 15000, show: (state) => `windows ${JSON.stringify(state.windows.map((window) => [window.type, window.focused]))}` });

  // Presses g ? and waits for the key list. Under load wtype keys sometimes never reach the window although every focus read says true (issue #139), so a first press that draws no list gets one retry after the window manager focuses the window again. The retry prints a NOTE, and a second miss stays a failure for the caller's check.
  // The probe saw every focus read true during drops, so the focus wait passes at once. Whether the window manager focus itself restores key delivery is unproven.
  async function open_key_list(instance, { slug, list_before }) {
    const attempt = async (shot_suffix) => {
      await instance.press(["g"]);
      const helped = await key_and_state(instance, ["?"], 3000);
      const list_shown = await wait_pixels(instance, `the key list of the ${slug} tab to draw`, `${instance.app}_${slug}_list_shown${shot_suffix}`, KEY_LIST_REGION, drawn_since(list_before), { timeout_ms: 3000 });
      return { helped, list_shown };
    };
    const first = await attempt("");
    if (first.list_shown !== list_before) return first;
    note(instance.app, instance.kind ?? "default", `g ? drew no key list in the ${slug} tab`, `retrying once after a window manager focus (${instance.wm_focus_window()})`);
    await wait_window_focus(instance);
    await instance.press(["-k", "Escape"]);
    return attempt("_retry");
  }

  async function show_folder(instance, path) {
    await instance.ask("show_folder", 20000, { path });
    return wait_for_state(instance, folder_shown(path));
  }

  // Presses a key and returns the state. `wait` is a number of ms (the older fixed wait, still used by the sections not yet ported) or { what, until, ...options } for wait_state.
  async function key_and_state(instance, args, wait = 700) {
    await instance.press(args);
    if (typeof wait === "number") {
      await sleep(wait);
      return instance.ask("state");
    }
    return wait_for_state(instance, wait);
  }

  // Restarts the app and records a check that the process changed, so a skipped restart fails the run.
  async function restart(instance, app, kind, label) {
    const pid_before = instance.app_pid();
    await instance.restart();
    const pid_after = instance.app_pid();
    const alive = instance.exited() === null;
    check(app, kind, `the app really restarted for the ${label}`, alive && pid_after !== pid_before, `pid ${pid_before} then ${pid_after}, exited ${JSON.stringify(instance.exited())}`);
    // The restart ends the app with SIGTERM, and the app can keep the hidden pane of a barrier's first flip in the profile. The checks after a restart expect the pane shown.
    if ((await instance.ask("state")).mail_tab?.message_pane_visible === false) {
      note(app, kind, `message pane after the restart for the ${label}`, "hidden, shown again with w m");
      for (const key of ["Escape", "w"]) await instance.press(["-k", key]);
      await key_and_state(instance, ["m"], { what: "w m to show the message pane after the restart", until: (state) => state.mail_tab?.message_pane_visible === true });
    }
  }

  // Waits until the fixture message `header_id` has loaded in the pane and the status bar is blank again. The pane has no helper state for a load in progress, but the helper's body script reports 1.5 s after a document loads, with the start of its text, and a fixture body names its own message. So the wait first takes a report from that message's document, and only then compares the status bar text area with a blank stretch of the same bar. Before the load, that bar can be blank too, before "Loading Message..." shows.
  async function wait_message_loaded(instance, header_id) {
    const body_names_it = `Body of ${header_id.replace("@fixture.invalid", "")}.`;
    await wait_state(instance, `${header_id} to load and report its body`, (state) => (state.body?.text_start ?? "").includes(body_names_it), { timeout_ms: 8000, soft: true });
    const text_area = "200,698 140x20";
    const blank_area = "700,698 140x20";
    return wait_for(instance, "the status bar to stop showing a load", async () => (await hud_pixels(instance, `${instance.app}_status_text`, text_area)) === (await hud_pixels(instance, `${instance.app}_status_blank`, blank_area)), (idle) => idle, { timeout_ms: 8000, soft: true });
  }

  // Closes the compose windows and waits until the mail window has the focus again, since keys go to the focused window.
  async function close_compose(instance) {
    await instance.ask("close_compose");
    return wait_state(instance, "the compose window to close and the mail window to take focus", (state) => !state.windows.some((window) => window.type === "messageCompose") && normal_window_focused(state), { timeout_ms: 8000 });
  }

  // The clipboard text once a yank has written it. The caller clears the clipboard first, so an empty text means not yet.
  async function wait_for_clipboard(instance, what) {
    return (await wait_for(instance, what, () => instance.ask("read_clipboard"), (reply) => (reply.text ?? "").trim() !== "")).text ?? "";
  }

  // The hash of a region of the window as a pixel poll reads it: `wait_pixels` polls `until` on each hash, 100 ms apart. Like the state waits, a ceiling ends it with the last hash and the check after it judges. A poll records no FAIL of its own, because every caller follows it with a check of the hash.
  const wait_pixels = (instance, what, name, region, until, options) => wait_for(instance, what, () => hud_pixels(instance, name, region), until, { step_ms: 100, soft: true, ...options });

  // Opens the command line with `keys` and returns once its panel has drawn and held still. A key typed before the page has the focus is dropped, and the focus comes in the same step as the prompt, so the drawn panel is the ready signal.
  // A window that has just opened can drop the key before its key runtime is live, so `attempts` presses the keys again while nothing has drawn.
  // The panel of an earlier line can still be on its way out, so the baseline is read once the region holds still.
  async function open_command_line(instance, keys = [":"], { attempts = 1, timeout_ms = 5000 } = {}) {
    const before = await wait_pixels(instance, "the region to hold still before the command line opens", `${instance.app}_cmdline_before`, KEY_LIST_REGION, holds_twice(), { timeout_ms: 3000 });
    let drawn = before;
    for (let attempt = 0; attempt < attempts && drawn === before; attempt++) {
      await instance.press(keys);
      drawn = await wait_pixels(instance, "the command line to draw", `${instance.app}_cmdline_open`, KEY_LIST_REGION, drawn_since(before), { timeout_ms });
    }
    return drawn;
  }

  // Presses keys in the open command line and returns once the line has drawn the result (typed text, a row put in, an older command). `region` narrows the read to the input row where the list around it would move too.
  async function press_in_command_line(instance, keys, region = KEY_LIST_REGION) {
    const before = await hud_pixels(instance, `${instance.app}_cmdline_before`, region);
    await instance.press(keys);
    return { before, after: await wait_pixels(instance, `the command line to draw the result of ${keys.join(" ")}`, `${instance.app}_cmdline_after`, region, drawn_since(before), { timeout_ms: 5000 }) };
  }

  async function close_command_line(instance) {
    let now = await hud_pixels(instance, `${instance.app}_cmdline_close`, KEY_LIST_REGION);
    for (let count = 0; count < 3; count++) {
      await instance.press(["-k", "Escape"]);
      let next = now;
      for (const began = Date.now(); next === now && Date.now() - began < QUIET_AFTER_ESCAPE_MS; ) {
        await sleep(100);
        next = await hud_pixels(instance, `${instance.app}_cmdline_close`, KEY_LIST_REGION);
      }
      if (next === now) return;
      now = await wait_pixels(instance, "the command line to hold still after Escape", `${instance.app}_cmdline_close`, KEY_LIST_REGION, holds_twice(), { timeout_ms: 2000 });
    }
  }

  // Reads the toast strip before the key, while a toast shows and again after it expired. A toast is proven by the strip differing while it shows and matching the strip from before once the toast time is over.
  // Earlier toasts expire first, because the strip from before would hold them. A key that expects no toast (`expect_toast: false`) reads the strip after a fixed margin, since nothing shows that a toast is not coming.
  async function toast_cycle(instance, name, press_args, lead_keys = [], { expect_toast = true } = {}) {
    if (expect_toast) await sleep(TOAST_EXPIRY_MS);
    const before = await hud_pixels(instance, `${name}_before`);
    for (const key of lead_keys) await instance.press([key]);
    await instance.press(press_args);
    if (!expect_toast) {
      await sleep(1500);
      const state = await instance.ask("state");
      return { state, shown: (await hud_pixels(instance, `${name}_during`)) !== before };
    }
    const during = await wait_pixels(instance, `the toast of ${name} to show`, `${name}_during`, HUD_REGION, drawn_since(before), { timeout_ms: 5000 });
    const after = await wait_pixels(instance, `the toast of ${name} to go`, `${name}_after`, HUD_REGION, back_to(before), { timeout_ms: TOAST_EXPIRY_MS + 2000 });
    // Read after the toast has gone: a refusal that still opens a compose window does so many seconds late.
    const state = await instance.ask("state");
    return { state, shown: during !== before, gone: after === before };
  }

  // One screenshot with its report line. The shot rule: the worker reads every one.
  async function shot(name, line) {
    const path = await ctx.instance.shot(`${app}_${name}`);
    report.shots.push({ app, kind, path, name, line });
    return path;
  }

  // Charges the wall time of one default-kind section to the timings file.
  const timed = (instance, name, action) => deps.timings.section(instance.app, instance.kind ?? "default", name, action);

  // A second app in the same piece, in its own work dir under the piece's. `seeds` seeds storage as a piece does. The caller stops it.
  async function start_extra({ name, seeds = null }) {
    const work_dir = join(piece_dir, name);
    assert_start_paths({ run_dir: deps.run_dir, paths: start_paths_of(work_dir) });
    const xpi_path = deps.xpi_path && seeds ? seed_storage(deps.xpi_path, work_dir, seeds) : deps.xpi_path;
    const extra = await deps.start_app({ app, app_binary: deps.binaries[app], work_dir, run_dir: deps.run_dir, kind: "default", xpi_path });
    const instance = { ...extra, kind: "default" };
    ctx.extra_instances.push(instance);
    return instance;
  }

  const ctx = {
    app, kind, section, piece_name: `${app}/${kind}/${section}`, piece_dir,
    // Set by run_piece once the piece's app is up. Null while a before_start hook runs.
    instance: null,
    // What the piece's before_start hook returned.
    reference: null,
    // The apps start_extra started, so the runner can add their startups and memory to the piece's timings entry.
    extra_instances: [],
    report, wait_stats,
    check, note, shot, timed,
    sleep, wait_for, wait_state, wait_for_state, wait_window_focus, open_key_list, key_and_state, barrier, expect_absent, wait_pixels, drawn_since, back_to, holds_twice,
    wait_message_loaded, wait_for_clipboard, close_compose, settled_state,
    open_inbox, restart, show_folder, hud_pixels, first_selected,
    open_command_line, press_in_command_line, close_command_line, toast_cycle, key_list_region: KEY_LIST_REGION,
    start_extra,
  };
  return ctx;
}
