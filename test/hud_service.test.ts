import assert from "node:assert/strict";
import { test } from "node:test";
import { create_hud_service, lifting_toasts } from "../src/background/hud/service.ts";
import { mode_label_colors, resolve_theme } from "../src/background/theme/palette.ts";
import type { TreeBranch } from "../vendor/desertfox/prefix_tree.ts";
import type { Settings } from "../src/background/config/settings.ts";
import type { HudState, KeysEvent, KeysMode } from "../src/shared/protocol.ts";
import { fake_timers, sample_root, settings_with, settle } from "./hud_fakes.ts";

const own_root = (): TreeBranch => ({ kind: "branch", children: { g: { kind: "branch", children: { y: { kind: "leaf", label: "Only on a page", steps: [{ invocation: { id: "page.top" }, runs_in: "message", count_rule: "repeat" }] } } } } });

const message_root = (): TreeBranch => ({ kind: "branch", children: { g: { kind: "branch", children: { x: { kind: "leaf", label: "Only in a message", steps: [{ invocation: { id: "message.top" }, runs_in: "message", count_rule: "repeat" }] } } } } });

function setup(overrides: Partial<Settings> = {}) {
    const log: string[] = [];
    const marks: Record<string, { path: string }> = {};
    const timers = fake_timers();
    let settings = settings_with({ mode_indicator: "off", ...overrides });
    const labels: string[] = [];
    const label_colors: unknown[] = [];
    const hud = create_hud_service({
        overlay: {
            mount: async ({ windowId, surface }) => void log.push(`mount ${surface}@${windowId}`),
            unmount: async ({ windowId, surface }) => void log.push(`unmount ${surface}@${windowId}`),
            setModeLabel: async ({ windowId, mode, indicator, style, colors }) => void (labels.push(`${windowId} ${mode} ${indicator} ${style}`), label_colors.push(colors)),
            onClosed: { addListener: () => {}, removeListener: () => {} },
        },
        read_settings: async () => settings,
        read_root: async (source) => (source === "main" ? sample_root() : source === "own" || source === "page" ? own_root() : message_root()),
        read_marks: async () => marks,
        send_changed: (window_id) => void log.push(`changed ${window_id}`),
        timers,
    });
    const pending = (keys: string[], window_id = 1, extra: { source?: "page" | "message"; root?: true } = {}): Promise<void> => hud.on_keys_event({ command: "pending", keys, windowId: window_id, ...extra });
    const body_pending = (keys: string[], window_id = 1, source: "message" | "own" = "message"): Promise<void> => hud.on_body_pending(window_id, keys, source);
    const state = async (window_id = 1): Promise<HudState> => (await hud.handle({ type: "hud.state", windowId: window_id }))!;
    const set_mode = (mode: KeysMode["mode"], window_id = 1): Promise<void> => hud.on_keys_event({ command: "mode", mode, windowId: window_id });
    return { hud, body_pending, log, labels, label_colors, timers, pending, state, set_mode, set_settings: (next: Partial<Settings>) => void (settings = { ...settings, ...next }) };
}

test("the panel waits for the delay: nothing mounts before it and the panel shows after it", async () => {
    const { log, timers, pending, state } = setup({ which_key_delay_ms: 300 });
    await pending(["g"]);
    timers.advance(299);
    await settle();
    assert.deepEqual(log, []);
    timers.advance(1);
    await settle();
    assert.deepEqual(log, ["mount hud@1"]);
    assert.deepEqual((await state()).which_key?.rows.map((row) => row.key), ["g", "u"]);
});

test("the sequence completing before the delay shows no panel and mounts nothing", async () => {
    const { log, timers, pending } = setup();
    await pending(["g"]);
    timers.advance(100);
    await pending([]);
    timers.advance(1000);
    await settle();
    assert.deepEqual(log, []);
    assert.equal(timers.pending(), 0);
});

test("the sequence completing while the panel shows removes the panel and the page", async () => {
    const { log, timers, pending, state } = setup();
    await pending(["g"]);
    timers.advance(300);
    await settle();
    await pending([]);
    await settle();
    assert.deepEqual(log, ["mount hud@1", "unmount hud@1"]);
    assert.equal((await state()).which_key, null);
});

test("a cancelled sequence ends the panel the same way", async () => {
    const { log, timers, pending } = setup();
    await pending(["d"]);
    timers.advance(300);
    await settle();
    await pending([]);
    await settle();
    assert.deepEqual(log, ["mount hud@1", "unmount hud@1"]);
});

test("a longer prefix with the panel up redraws at once and the page asks again", async () => {
    const { log, timers, pending, state } = setup();
    await pending(["g"]);
    timers.advance(300);
    await settle();
    await pending(["g", "u"]);
    await settle();
    assert.deepEqual(log, ["mount hud@1", "changed 1"]);
    assert.deepEqual((await state()).which_key?.title, ["+Go", "+u"]);
    assert.equal(timers.pending(), 0);
});

test("keys that lead nowhere show no panel", async () => {
    const { log, timers, pending } = setup();
    await pending(["z"]);
    timers.advance(1000);
    await settle();
    assert.deepEqual(log, []);
});

test("a delay of zero shows no panel", async () => {
    const { log, timers, pending } = setup({ which_key_delay_ms: 0 });
    await pending(["g"]);
    timers.advance(1000);
    await settle();
    assert.deepEqual(log, []);
});

test("a skipped prefix shows no panel until a longer prefix is typed with the panel not yet up", async () => {
    const { log, timers, pending } = setup({ which_key_skip: ["g"] });
    await pending(["g"]);
    timers.advance(1000);
    await settle();
    assert.deepEqual(log, []);
    await pending(["g", "u"]);
    timers.advance(300);
    await settle();
    assert.deepEqual(log, ["mount hud@1"]);
});

test("a tab change or a window blur closes the panel through close_which_key", async () => {
    const { hud, log, timers, pending } = setup();
    await pending(["g"]);
    timers.advance(300);
    await settle();
    hud.close_which_key();
    await settle();
    assert.deepEqual(log, ["mount hud@1", "unmount hud@1"]);
});

test("a blur that moves the focus to the window that typed the keys leaves its panel alone", async () => {
    const { hud, log, timers, pending } = setup();
    await pending(["g"]);
    timers.advance(300);
    await settle();
    hud.close_which_key(1);
    await settle();
    assert.deepEqual(log, ["mount hud@1"]);
});

test("a blur also drops a panel that is still waiting for its delay", async () => {
    const { hud, log, timers, pending } = setup();
    await pending(["g"]);
    hud.close_which_key();
    timers.advance(1000);
    await settle();
    assert.deepEqual(log, []);
});

test("keys typed in another window end the panel of the first", async () => {
    const { log, timers, pending, state } = setup();
    await pending(["g"], 1);
    timers.advance(300);
    await settle();
    await pending(["d"], 2);
    await settle();
    assert.equal((await state(1)).which_key, null);
    assert.deepEqual(log, ["mount hud@1", "unmount hud@1"]);
    timers.advance(300);
    await settle();
    assert.deepEqual(log.slice(2), ["mount hud@2"]);
});

test("a settings change while the panel shows redraws it with the new border", async () => {
    const { hud, log, timers, pending, state, set_settings } = setup();
    await pending(["g"]);
    timers.advance(300);
    await settle();
    assert.equal((await state()).which_key?.border, "square");
    set_settings({ which_key_border: "chamfer" });
    await hud.settings_changed();
    assert.equal((await state()).which_key?.border, "chamfer");
    assert.deepEqual(log, ["mount hud@1", "changed 1"]);
});

test("a delay change applies to the next panel, not the one already waiting", async () => {
    const { log, timers, pending, set_settings } = setup({ which_key_delay_ms: 300 });
    await pending(["g"]);
    set_settings({ which_key_delay_ms: 5000 });
    timers.advance(300);
    await settle();
    assert.deepEqual(log, ["mount hud@1"]);
});

test("the label follows the mode setting and mounts no page", async () => {
    const { hud, log, labels, set_settings } = setup({ mode_indicator: "always" });
    await hud.track(1);
    assert.deepEqual(labels, ["1 normal always classic"]);
    set_settings({ mode_indicator: "off" });
    await hud.settings_changed();
    assert.equal(labels.at(-1), "1 normal off classic");
    assert.deepEqual(log, [], "the label is no hud page");
});

test("the label follows the style setting", async () => {
    const { hud, labels, set_settings } = setup({ mode_indicator: "always", mode_indicator_style: "classic" });
    await hud.track(1);
    set_settings({ mode_indicator_style: "badge" });
    await hud.settings_changed();
    assert.deepEqual(labels, ["1 normal always classic", "1 normal always badge"]);
});

test("a mode event updates the label of its window, and the same mode twice sends one call", async () => {
    const { hud, labels, set_mode } = setup({ mode_indicator: "always" });
    await hud.track(1);
    await set_mode("visual");
    await set_mode("visual");
    await set_mode("normal");
    assert.deepEqual(labels, ["1 normal always classic", "1 visual always classic", "1 normal always classic"]);
});

test("a mode event of a window with no id changes nothing", async () => {
    const { labels, set_mode } = setup({ mode_indicator: "always" });
    await set_mode("visual", -1);
    assert.deepEqual(labels, []);
});

test("a mode event of one window leaves the label of another alone", async () => {
    const { hud, labels, set_mode } = setup({ mode_indicator: "always" });
    await hud.track(1);
    await hud.track(2);
    await set_mode("visual", 2);
    assert.deepEqual(labels, ["1 normal always classic", "2 normal always classic", "2 visual always classic"]);
});

test("the label of a failing Experiment call is logged and the next update still runs", async () => {
    const calls: string[] = [];
    const hud = create_hud_service({
        overlay: { mount: async () => {}, unmount: async () => {}, setModeLabel: async ({ mode }) => (calls.push(mode), Promise.reject(new Error("no such window"))), onClosed: { addListener: () => {}, removeListener: () => {} } },
        read_settings: async () => settings_with({ mode_indicator: "always" }),
        read_root: async () => sample_root(),
        read_marks: async () => ({}),
        send_changed: () => {},
        timers: fake_timers(),
    });
    const quiet = console.error;
    console.error = () => {};
    try {
        await hud.track(1);
        await hud.on_keys_event({ command: "mode", mode: "visual", windowId: 1 });
    } finally {
        console.error = quiet;
    }
    assert.deepEqual(calls, ["normal", "visual"]);
});

test("the page mounts for a panel only, whatever the mode setting says", async () => {
    const { hud, log, timers, pending } = setup({ mode_indicator: "always" });
    await hud.track(1);
    assert.deepEqual(log, []);
    await pending(["g"]);
    timers.advance(300);
    await settle();
    await pending([]);
    await settle();
    assert.deepEqual(log, ["mount hud@1", "unmount hud@1"]);
});

test("a toast mounts the page and lasts toast_error_ms for an error and toast_ms for a result", async () => {
    const { hud, log, timers, state } = setup({ toast_ms: 1000, toast_error_ms: 4000 });
    assert.equal(await hud.toast(1, "failed", true), true);
    assert.equal(await hud.toast(1, "done", false), true);
    await settle();
    assert.deepEqual((await state()).toasts.map((toast) => toast.text), ["failed", "done"]);
    assert.equal(log[0], "mount hud@1");
    timers.advance(1000);
    await settle();
    assert.deepEqual((await state()).toasts.map((toast) => toast.text), ["failed"]);
    timers.advance(3000);
    await settle();
    assert.deepEqual((await state()).toasts, []);
    assert.equal(log.at(-1), "unmount hud@1");
});

test("a toast time of zero or a missing window shows no toast, so the caller falls back to a notification", async () => {
    const { hud, log } = setup({ toast_ms: 0, toast_error_ms: 0 });
    assert.equal(await hud.toast(1, "x", true), false);
    assert.equal(await hud.toast(-1, "x", true), false);
    assert.deepEqual(log, []);
});

test("without the Experiment no toast shows", async () => {
    const hud = create_hud_service({ overlay: undefined, read_settings: async () => settings_with({}), read_root: async () => sample_root(), read_marks: async () => ({}), send_changed: () => {}, timers: fake_timers() });
    assert.equal(await hud.toast(1, "x", true), false);
});

test("a window that goes away drops its toasts and timers and mounts nothing after", async () => {
    const { hud, log, timers } = setup();
    await hud.toast(1, "x", true);
    await settle();
    hud.forget(1);
    await settle();
    assert.equal(timers.pending(), 0);
    assert.deepEqual(log.filter((line) => line.startsWith("mount") || line.startsWith("unmount")), ["mount hud@1"]);
});

test("the which-key panel, a toast and the command line page can show together: the hud keeps its own page", async () => {
    const { hud, log, timers, pending, state } = setup();
    await pending(["g"]);
    timers.advance(300);
    await settle();
    await hud.toast(1, "failed", true);
    await settle();
    const shown = await state();
    assert.deepEqual(shown.which_key?.title, ["+Go"]);
    assert.equal(shown.toasts.length, 1);
    assert.equal(log.filter((line) => line.startsWith("mount")).length, 1);
});

test("a message that is not a hud request is left to other handlers", () => {
    const { hud } = setup();
    assert.equal(hud.handle({ type: "cmdline.hello", windowId: 1 }), undefined);
    assert.equal(hud.handle({ type: "hud.state", windowId: "1" }), undefined);
    assert.equal(hud.handle(null), undefined);
});

test("events that are commands are ignored", async () => {
    const { hud, log } = setup();
    const invocation: KeysEvent = { command: "msg.archive", args: {}, count: 1, windowId: 1, messageIds: [] };
    await hud.on_keys_event(invocation);
    assert.deepEqual(log, []);
});

function failing_mount() {
    const log: string[] = [];
    const hud = create_hud_service({
        overlay: { mount: async () => Promise.reject(new Error("no such window")), unmount: async () => void log.push("unmount"), setModeLabel: async () => {}, onClosed: { addListener: () => {}, removeListener: () => {} } },
        read_settings: async () => settings_with({ mode_indicator: "off" }),
        read_root: async () => sample_root(),
        read_marks: async () => ({}),
        send_changed: () => {},
        timers: fake_timers(),
    });
    return { hud, log };
}

test("a toast whose page cannot mount reports false, so the caller sends a notification, and leaves no toast behind", async () => {
    const { hud } = failing_mount();
    const quiet = console.error;
    console.error = () => {};
    try {
        assert.equal(await hud.toast(1, "failed", true), false);
    } finally {
        console.error = quiet;
    }
    assert.deepEqual((await hud.handle({ type: "hud.state", windowId: 1 }))?.toasts, []);
});

test("a toast whose page is already mounted reports true", async () => {
    const { hud } = setup({ mode_indicator: "always" });
    await hud.track(1);
    assert.equal(await hud.toast(1, "failed", true), true);
});

test("the toasts lift while the command line is open in the window and drop when it closes", async () => {
    const { hud, state } = setup();
    assert.equal((await state()).lifted, false);
    hud.set_lifted(1, true);
    assert.equal((await state()).lifted, true);
    hud.set_lifted(1, false);
    assert.equal((await state()).lifted, false);
});

test("a lifting mount lifts the toasts, a plain one sets them down, and a failed mount undoes it", async () => {
    const lifted: string[] = [];
    const base = { mount: async () => {}, unmount: async () => {}, setModeLabel: async () => {}, onClosed: { addListener: () => {}, removeListener: () => {} } };
    const wrapped = lifting_toasts(base, { set_lifted: (window_id, on) => void lifted.push(`${window_id}:${on}`) }, true);
    await wrapped.mount({ windowId: 1, surface: "cmdline" });
    await wrapped.mount({ windowId: 1, surface: "hud" });
    await wrapped.unmount({ windowId: 1, surface: "cmdline" });
    assert.deepEqual(lifted, ["1:true", "1:false"]);
    const refusing = lifting_toasts({ ...base, mount: async () => Promise.reject(new Error("no")) }, { set_lifted: (window_id, on) => void lifted.push(`${window_id}:${on}`) }, true);
    await assert.rejects(refusing.mount({ windowId: 2, surface: "cmdline" }));
    assert.deepEqual(lifted.slice(2), ["2:true", "2:false"]);
    // The command line mounts without the lift, so it also sets a lift down that a replaced prompt left.
    const flat = lifting_toasts(base, { set_lifted: (window_id, on) => void lifted.push(`${window_id}:${on}`) }, false);
    await flat.mount({ windowId: 3, surface: "cmdline" });
    assert.deepEqual(lifted.slice(4), ["3:false"]);
});

test("keys from a window with no id show no panel", async () => {
    const { log, timers, pending } = setup();
    await pending(["g"], -1);
    timers.advance(1000);
    await settle();
    assert.deepEqual(log, []);
});

test("the label gets the colors of the theme setting, and a theme change sends the new ones", async () => {
    const { hud, label_colors, set_settings } = setup({ mode_indicator: "always", theme: "oasis_desert" });
    await hud.track(1);
    assert.deepEqual(label_colors.at(-1), mode_label_colors(resolve_theme("oasis_desert")));
    set_settings({ theme: "oasis_sol" });
    await hud.settings_changed();
    assert.deepEqual(label_colors.at(-1), mode_label_colors(resolve_theme("oasis_sol")));
});

test("show_root shows the root panel at once, and the next reported end removes it", async () => {
    const { hud, log, pending, state } = setup({ which_key_delay_ms: 0 });
    await hud.show_root(1);
    assert.deepEqual(log, ["mount hud@1"]);
    assert.deepEqual((await state()).which_key?.rows.map((row) => row.key), ["j", "d", "g"]);
    await pending([]);
    await settle();
    assert.deepEqual(log, ["mount hud@1", "unmount hud@1"]);
});

test("a prefix typed in a message document lists the message keys, and the redraw reads the same tree", async () => {
    const { hud, timers, body_pending, pending, state } = setup();
    await hud.track(1);
    await body_pending(["g"]);
    timers.advance(300);
    await settle();
    assert.deepEqual((await state()).which_key?.rows.map((row) => row.label), ["Only in a message"]);
    await body_pending(["g", "x"]);
    await settle();
    assert.equal((await state()).which_key, null, "a prefix with no continuations ends the panel");
    await pending(["g"]);
    timers.advance(300);
    await settle();
    assert.ok((await state()).which_key?.rows.some((row) => row.label === "First row"), "the main tree rows show");
});

test("with a panel up, a report from the other source redraws at once with its own tree", async () => {
    const { hud, timers, body_pending, pending, state } = setup();
    await hud.track(1);
    const labels = async () => (await state()).which_key?.rows.map((row) => row.label);
    await body_pending(["g"]);
    timers.advance(300);
    await settle();
    assert.deepEqual(await labels(), ["Only in a message"]);
    await pending(["g"]);
    await settle();
    assert.ok((await labels())?.includes("First row"), "main after body");
    await body_pending(["g"]);
    await settle();
    assert.deepEqual(await labels(), ["Only in a message"]);
});

test("a prefix typed on an own page lists the page keys and not the message keys", async () => {
    const { hud, timers, body_pending, state } = setup();
    await hud.track(1);
    await body_pending(["g"], 1, "own");
    timers.advance(300);
    await settle();
    assert.deepEqual((await state()).which_key?.rows.map((row) => row.label), ["Only on a page"]);
});

test("a report from a window the hud does not track mounts nothing", async () => {
    const { log, timers, body_pending } = setup();
    await body_pending(["g"], 9);
    timers.advance(1000);
    await settle();
    assert.deepEqual(log, []);
});


test("an empty prefix from a message document removes its panel", async () => {
    const { hud, log, timers, body_pending } = setup();
    await hud.track(1);
    log.length = 0;
    await body_pending(["g"]);
    timers.advance(300);
    await settle();
    await body_pending([]);
    await settle();
    assert.deepEqual(log, ["mount hud@1", "unmount hud@1"]);
});

test("a pending report that names the page source lists the page tree, and a redraw reads it again", async () => {
    const { timers, pending, state } = setup({ which_key_delay_ms: 300 });
    await pending(["g"], 1, { source: "page" });
    timers.advance(300);
    await settle();
    assert.deepEqual((await state()).which_key?.rows.map((row) => row.key), ["y"]);
});

test("a root report shows the named tree at once, whatever the delay", async () => {
    const { log, pending, state } = setup({ which_key_delay_ms: 0 });
    await pending([], 1, { source: "message", root: true });
    assert.deepEqual(log, ["mount hud@1"]);
    assert.deepEqual((await state()).which_key?.rows.map((row) => row.key), ["g"]);
});
