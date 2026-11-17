import assert from "node:assert/strict";
import { test } from "node:test";
import { badge_for, create_hud_service } from "../src/background/hud/service.ts";
import type { Settings } from "../vendor/desertfox/config.ts";
import type { HudState, KeysEvent } from "../src/shared/protocol.ts";
import { fake_timers, sample_root, settings_with, settle } from "./hud_fakes.ts";

function setup(overrides: Partial<Settings> = {}) {
    const log: string[] = [];
    const timers = fake_timers();
    let settings = settings_with({ mode_indicator: "off", ...overrides });
    let mode = "normal";
    const hud = create_hud_service({
        overlay: {
            mount: async ({ windowId, surface }) => void log.push(`mount ${surface}@${windowId}`),
            unmount: async ({ windowId, surface }) => void log.push(`unmount ${surface}@${windowId}`),
            onClosed: { addListener: () => {}, removeListener: () => {} },
        },
        read_settings: async () => settings,
        read_root: async () => sample_root(),
        send_changed: (window_id) => void log.push(`changed ${window_id}`),
        mode_of: () => mode,
        timers,
    });
    const pending = (keys: string[], window_id = 1): Promise<void> => hud.on_keys_event({ command: "keys.pending", keys, windowId: window_id });
    const state = async (window_id = 1): Promise<HudState> => (await hud.handle({ type: "hud.state", windowId: window_id }))!;
    return { hud, log, timers, pending, state, set_settings: (next: Partial<Settings>) => void (settings = { ...settings, ...next }), set_mode: (next: string) => void (mode = next) };
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
    assert.equal((await state()).which_key?.title, "g u");
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

test("the mode badge mounts the page for as long as the setting asks", async () => {
    const { hud, log, state, set_settings } = setup({ mode_indicator: "always" });
    await hud.track(1);
    assert.deepEqual(log, ["mount hud@1"]);
    assert.equal((await state()).badge, "NORMAL");
    set_settings({ mode_indicator: "off" });
    await hud.settings_changed();
    assert.deepEqual(log, ["mount hud@1", "unmount hud@1"]);
    assert.equal((await state()).badge, null);
});

test("not_normal shows the badge only away from normal mode", () => {
    assert.equal(badge_for("not_normal", "normal"), null);
    assert.equal(badge_for("not_normal", "visual"), "VISUAL");
    assert.equal(badge_for("always", "normal"), "NORMAL");
    assert.equal(badge_for("off", "visual"), null);
});

test("the page stays mounted for the badge while a panel comes and goes", async () => {
    const { hud, log, timers, pending } = setup({ mode_indicator: "always" });
    await hud.track(1);
    await pending(["g"]);
    timers.advance(300);
    await settle();
    await pending([]);
    await settle();
    assert.deepEqual(log, ["mount hud@1", "changed 1", "changed 1"]);
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
    const hud = create_hud_service({ overlay: undefined, read_settings: async () => settings_with({}), read_root: async () => sample_root(), send_changed: () => {}, mode_of: () => "normal", timers: fake_timers() });
    assert.equal(await hud.toast(1, "x", true), false);
});

test("a window that goes away drops its toasts and timers and mounts nothing after", async () => {
    const { hud, log, timers } = setup();
    await hud.toast(1, "x", true);
    await settle();
    hud.forget(1);
    await settle();
    assert.equal(timers.pending(), 0);
    assert.deepEqual(log, ["mount hud@1"]);
});

test("the which-key panel, a toast and the command line page can show together: the hud keeps its own page", async () => {
    const { hud, log, timers, pending, state } = setup();
    await pending(["g"]);
    timers.advance(300);
    await settle();
    await hud.toast(1, "failed", true);
    await settle();
    const shown = await state();
    assert.equal(shown.which_key?.title, "g");
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
