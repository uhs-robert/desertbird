import assert from "node:assert/strict";
import { test } from "node:test";
import { create_overlay_host } from "../src/chrome/overlay.ts";

class FakeWindow {
    tab_listeners = new Set<() => void>();
    unload_listeners = new Set<() => void>();
    boxes: string[] = [];
}

function setup() {
    const windows = new Map([[1, new FakeWindow()], [2, new FakeWindow()]]);
    const log: string[] = [];
    const host = create_overlay_host<FakeWindow>({
        window_with_id: (window_id) => windows.get(window_id) ?? null,
        create(window, surface, window_id) {
            const box = `${surface}@${window_id}`;
            window.boxes.push(box);
            log.push(`create ${box}`);
            return () => {
                window.boxes.splice(window.boxes.indexOf(box), 1);
                log.push(`remove ${box}`);
            };
        },
        focus_thread_list: (window) => void log.push(`focus list of ${[...windows].find(([, each]) => each === window)?.[0]}`),
        on_tab_select(window, listener) {
            window.tab_listeners.add(listener);
            return () => void window.tab_listeners.delete(listener);
        },
        on_window_unload(window, listener) {
            window.unload_listeners.add(listener);
            return () => void window.unload_listeners.delete(listener);
        },
        emit_closed: (window_id) => void log.push(`closed ${window_id}`),
    });
    return { windows, log, host };
}

test("mount shows the surface once and unmount removes it and returns the focus to the thread list", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    assert.deepEqual(windows.get(1)!.boxes, ["cmdline@1"]);
    host.unmount({ windowId: 1 });
    assert.deepEqual(log, ["create cmdline@1", "remove cmdline@1", "focus list of 1"]);
    assert.equal(windows.get(1)!.tab_listeners.size + windows.get(1)!.unload_listeners.size, 0);
});

test("mount twice replaces the first overlay: one box and one set of listeners remain", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    host.mount({ windowId: 1, surface: "cmdline" });
    assert.deepEqual(log, ["create cmdline@1", "remove cmdline@1", "create cmdline@1"]);
    assert.equal(windows.get(1)!.boxes.length, 1);
    assert.equal(windows.get(1)!.tab_listeners.size, 1);
    assert.equal(windows.get(1)!.unload_listeners.size, 1);
});

test("unmount with nothing mounted, or twice, does nothing", () => {
    const { log, host } = setup();
    host.unmount({ windowId: 1 });
    host.mount({ windowId: 1, surface: "cmdline" });
    host.unmount({ windowId: 1 });
    host.unmount({ windowId: 1 });
    assert.deepEqual(log, ["create cmdline@1", "remove cmdline@1", "focus list of 1"]);
});

test("a tab change removes the overlay, tells the background and leaves the focus to the list", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    for (const listener of [...windows.get(1)!.tab_listeners]) listener();
    assert.deepEqual(log, ["create cmdline@1", "remove cmdline@1", "focus list of 1", "closed 1"]);
    assert.equal(windows.get(1)!.tab_listeners.size, 0);
});

test("a closing window removes the overlay and tells the background, without a focus call", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 2, surface: "cmdline" });
    for (const listener of [...windows.get(2)!.unload_listeners]) listener();
    assert.deepEqual(log, ["create cmdline@2", "remove cmdline@2", "closed 2"]);
});

test("each window keeps its own overlay", () => {
    const { windows, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    host.mount({ windowId: 2, surface: "cmdline" });
    host.unmount({ windowId: 1 });
    assert.deepEqual([windows.get(1)!.boxes, windows.get(2)!.boxes], [[], ["cmdline@2"]]);
});

test("mount refuses a surface off the list, a window id that is not a window and an unknown window", () => {
    const { log, host } = setup();
    assert.throws(() => host.mount({ windowId: 1, surface: "../x" as "cmdline" }), /unknown surface/);
    assert.throws(() => host.mount({ windowId: -1, surface: "cmdline" }), /window id/);
    assert.throws(() => host.mount({ windowId: 1.5, surface: "cmdline" }), /window id/);
    assert.throws(() => host.mount({ windowId: "1" as unknown as number, surface: "cmdline" }), /window id/);
    assert.throws(() => host.mount({ windowId: 9, surface: "cmdline" }), /no main window/);
    assert.deepEqual(log, []);
});

test("shutdown removes every overlay and every listener", () => {
    const { windows, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    host.mount({ windowId: 2, surface: "cmdline" });
    host.shutdown();
    for (const window of windows.values()) assert.deepEqual([window.boxes.length, window.tab_listeners.size, window.unload_listeners.size], [0, 0, 0]);
});
