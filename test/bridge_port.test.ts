import assert from "node:assert/strict";
import { test } from "node:test";
import { BRIDGE_HOST_NAME, BRIDGE_OFF, FIRST_RETRY_MS, MAX_RETRY_MS, STABLE_MS, create_bridge_port } from "../src/background/bridge/port.ts";
import type { ModeSnapshot } from "../src/background/bridge/port.ts";
import type { BridgeAnswer } from "../src/background/bridge/run.ts";
import { fake_native_messaging } from "./chrome_stubs.ts";
import { fake_timers } from "./hud_fakes.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function bridge_under_test(options: { setting?: boolean; run?: (text: string) => Promise<BridgeAnswer>; mode?: ModeSnapshot | undefined } = {}) {
    const native = fake_native_messaging();
    const timers = fake_timers();
    let clock_ms = 0;
    const state = { setting: options.setting ?? true, mode: "mode" in options ? options.mode : ({ mode: "normal", window_id: 3, tab_id: 7 } as ModeSnapshot | undefined), runs: [] as string[] };
    const bridge = create_bridge_port({
        connect: () => native.connectNative(BRIDGE_HOST_NAME),
        read_bridge_setting: async () => state.setting,
        timers,
        now_ms: () => clock_ms,
        run_command: (text) => {
            state.runs.push(text);
            return options.run ? options.run(text) : Promise.resolve({ ok: true });
        },
        list_commands: () => [{ id: "motion.left", label: "Close thread or go to its root" }],
        current_mode: async () => state.mode,
    });
    const advance = (ms: number) => {
        clock_ms += ms;
        timers.advance(ms);
    };
    const last = () => native.ports.at(-1)!;
    const ready = async () => {
        last().host_says({ ready: true, host_version: 1 });
        await settle();
    };
    return { native, timers, bridge, state, advance, last, ready };
}

test("with the setting off nothing connects, and a later start stays off", async () => {
    const { native, bridge, timers } = bridge_under_test({ setting: false });
    await bridge.start();
    await bridge.settings_changed();
    assert.equal(native.ports.length, 0);
    assert.equal(timers.pending(), 0);
});

test("with the setting on it connects to the DesertBird host and trusts the port only after the ready frame", async () => {
    const { native, bridge, last, ready } = bridge_under_test();
    await bridge.start();
    assert.deepEqual(native.names, ["desertbird_bridge"]);
    last().host_says({ verb: "list", request_id: 1 });
    await settle();
    assert.deepEqual(last().posted, [], "a request before ready is dropped");
    await ready();
    assert.deepEqual(last().posted, [{ verb: "mode", id: "normal", label: "NORMAL", private: false, tab_id: 7, window_id: 3 }]);
});

test("it answers list, run and state with the request id, and drops malformed frames", async () => {
    const { bridge, last, ready, state } = bridge_under_test();
    await bridge.start();
    await ready();
    last().posted.length = 0;
    last().host_says({ verb: "list", request_id: 1 });
    last().host_says({ verb: "run", request_id: 2, command: "motion.left" });
    last().host_says({ verb: "state", request_id: 3 });
    last().host_says({ verb: "run", command: "motion.left" });
    last().host_says({ verb: "run", request_id: 4 });
    last().host_says({ verb: "eval", request_id: 5 });
    last().host_says(null);
    await settle();
    const by_id = [...last().posted].sort((left, right) => (left as { request_id: number }).request_id - (right as { request_id: number }).request_id);
    assert.deepEqual(by_id, [
        { ok: true, commands: [{ id: "motion.left", label: "Close thread or go to its root" }], verb: "reply", request_id: 1 },
        { ok: true, verb: "reply", request_id: 2 },
        { ok: true, mode: { id: "normal", label: "NORMAL", private: false, tab_id: 7, window_id: 3 }, verb: "reply", request_id: 3 },
    ]);
    assert.deepEqual(state.runs, ["motion.left"]);
});

test("state with no mail window open is a refusal", async () => {
    const { bridge, last, ready } = bridge_under_test({ mode: undefined });
    await bridge.start();
    await ready();
    last().host_says({ verb: "state", request_id: 1 });
    await settle();
    assert.deepEqual(last().posted, [{ ok: false, message: "no mail window is open", verb: "reply", request_id: 1 }]);
});

test("a run frame that arrives after the setting went off, before the port closed, is refused and runs nothing", async () => {
    const { bridge, last, ready, state } = bridge_under_test();
    await bridge.start();
    await ready();
    last().posted.length = 0;
    state.setting = false;
    last().host_says({ verb: "run", request_id: 9, command: "motion.left" });
    await settle();
    assert.deepEqual(last().posted, [{ ...BRIDGE_OFF, verb: "reply", request_id: 9 }]);
    assert.deepEqual(state.runs, []);
});

test("a run that throws answers with fixed text", async () => {
    const { bridge, last, ready } = bridge_under_test({ run: () => Promise.reject(new Error("Folder Secret Plans not found")) });
    await bridge.start();
    await ready();
    last().posted.length = 0;
    last().host_says({ verb: "run", request_id: 1, command: "folder.open" });
    await settle();
    assert.deepEqual(last().posted, [{ ok: false, message: "the command failed", verb: "reply", request_id: 1 }]);
});

test("turning the setting off closes the port, removes its listeners and leaves no timer", async () => {
    const { bridge, last, ready, state, timers } = bridge_under_test();
    await bridge.start();
    await ready();
    const port = last();
    state.setting = false;
    await bridge.settings_changed();
    assert.equal(port.disconnected, true);
    assert.equal(port.listener_count(), 0);
    assert.equal(timers.pending(), 0);
});

test("turning the setting off while a retry waits stops the retry", async () => {
    const { native, bridge, last, state, timers, advance } = bridge_under_test();
    await bridge.start();
    last().host_drops();
    assert.equal(timers.pending(), 1);
    state.setting = false;
    await bridge.settings_changed();
    assert.equal(timers.pending(), 0);
    advance(10 * MAX_RETRY_MS);
    assert.equal(native.ports.length, 1);
});

test("the backoff doubles from 1 s to 60 s and never holds more than one timer", async () => {
    const { native, bridge, last, timers, advance } = bridge_under_test();
    await bridge.start();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 9; attempt++) {
        const ports_before = native.ports.length;
        last().host_drops();
        assert.equal(timers.pending(), 1);
        let waited = 0;
        while (native.ports.length === ports_before) {
            advance(FIRST_RETRY_MS / 2);
            waited += FIRST_RETRY_MS / 2;
            assert.ok(timers.pending() <= 1);
        }
        delays.push(waited);
    }
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
});

test("repeated drop events from one port schedule one retry, and a stale port's drop does nothing", async () => {
    const { native, bridge, last, timers, advance } = bridge_under_test();
    await bridge.start();
    const first = last();
    first.host_drops();
    first.host_drops();
    first.host_drops();
    assert.equal(timers.pending(), 1);
    advance(FIRST_RETRY_MS);
    assert.equal(native.ports.length, 2);
    first.host_drops();
    assert.equal(timers.pending(), 0);
    assert.equal(native.ports.length, 2);
});

test("reconnects leak no listeners: each dead port has none and the live one has its two", async () => {
    const { native, bridge, last, advance } = bridge_under_test();
    await bridge.start();
    for (let attempt = 0; attempt < 5; attempt++) {
        last().host_drops();
        advance(MAX_RETRY_MS);
    }
    assert.equal(native.ports.length, 6);
    assert.deepEqual(native.ports.map((port) => port.listener_count()), [0, 0, 0, 0, 0, 2]);
});

test("a port that stayed up past the stable time starts the backoff over", async () => {
    const { native, bridge, last, ready, advance } = bridge_under_test();
    await bridge.start();
    for (let attempt = 0; attempt < 4; attempt++) {
        last().host_drops();
        advance(MAX_RETRY_MS);
    }
    await ready();
    advance(STABLE_MS);
    const ports_before = native.ports.length;
    last().host_drops();
    advance(FIRST_RETRY_MS);
    assert.equal(native.ports.length, ports_before + 1);
});

test("a connect that throws retries on the backoff", async () => {
    const { native, bridge, timers, advance } = bridge_under_test();
    native.fail_next = true;
    await bridge.start();
    assert.equal(native.ports.length, 0);
    assert.equal(timers.pending(), 1);
    advance(FIRST_RETRY_MS);
    assert.equal(native.ports.length, 1);
});

test("an answer that finishes after a reconnect never reaches the new host", async () => {
    let finish: (answer: BridgeAnswer) => void = () => {};
    const { native, bridge, last, ready, advance } = bridge_under_test({ run: () => new Promise((resolve) => (finish = resolve)) });
    await bridge.start();
    await ready();
    const first = last();
    first.host_says({ verb: "run", request_id: 1, command: "motion.left" });
    await settle();
    first.host_drops();
    advance(FIRST_RETRY_MS);
    await ready();
    const second = native.ports[1]!;
    const posted_before = second.posted.length;
    finish({ ok: true });
    await settle();
    assert.equal(second.posted.length, posted_before);
    assert.equal(first.posted.some((message) => (message as { verb?: string }).verb === "reply"), false);
});

test("a mode change goes to the host only while the port is ready", async () => {
    const { bridge, last, ready, state } = bridge_under_test();
    await bridge.start();
    await bridge.mode_changed();
    assert.deepEqual(last().posted, []);
    await ready();
    state.mode = { mode: "visual", window_id: 3, tab_id: 7 };
    await bridge.mode_changed();
    assert.deepEqual(last().posted.at(-1), { verb: "mode", id: "visual", label: "VISUAL", private: false, tab_id: 7, window_id: 3 });
});

test("turning the setting on again connects at once", async () => {
    const { native, bridge, state } = bridge_under_test();
    await bridge.start();
    state.setting = false;
    await bridge.settings_changed();
    state.setting = true;
    await bridge.settings_changed();
    assert.equal(native.ports.length, 2);
    assert.equal(native.ports[0]!.disconnected, true);
});
