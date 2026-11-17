import assert from "node:assert/strict";
import { test } from "node:test";
import { create_overlay_host } from "../src/chrome/overlay.ts";

class FakeWindow {
    tab_listeners = new Set<() => void>();
    unload_listeners = new Set<() => void>();
    escape_listeners = new Set<() => void>();
    boxes: string[] = [];
    /** What has the focus when a surface mounts, or null for nothing that can be given back. */
    held_focus: string | null = null;
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
        capture_focus: (window) => {
            const held = window.held_focus;
            return () => (held === null ? false : (log.push(`restore ${held}`), true));
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
        on_escape(window, listener) {
            window.escape_listeners.add(listener);
            return () => void window.escape_listeners.delete(listener);
        },
        emit_closed: (window_id, surface) => void log.push(surface === "cmdline" ? `closed ${window_id}` : `closed ${surface} ${window_id}`),
    });
    return { windows, log, host };
}

test("mount shows the surface once and unmount removes it and returns the focus to the thread list", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    assert.deepEqual(windows.get(1)!.boxes, ["cmdline@1"]);
    host.unmount({ windowId: 1, surface: "cmdline" });
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
    host.unmount({ windowId: 1, surface: "cmdline" });
    host.mount({ windowId: 1, surface: "cmdline" });
    host.unmount({ windowId: 1, surface: "cmdline" });
    host.unmount({ windowId: 1, surface: "cmdline" });
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
    host.unmount({ windowId: 1, surface: "cmdline" });
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

test("Escape removes an overlay whose page never answered, tells the background and returns the focus", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    for (const listener of [...windows.get(1)!.escape_listeners]) listener();
    assert.deepEqual(log, ["create cmdline@1", "remove cmdline@1", "focus list of 1", "closed 1"]);
    assert.equal(windows.get(1)!.escape_listeners.size, 0);
});

test("the command line and the hud mount together in one window and leave one at a time", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "hud" });
    host.mount({ windowId: 1, surface: "cmdline" });
    assert.deepEqual(windows.get(1)!.boxes, ["hud@1", "cmdline@1"]);
    host.unmount({ windowId: 1, surface: "cmdline" });
    assert.deepEqual(windows.get(1)!.boxes, ["hud@1"]);
    assert.deepEqual(log, ["create hud@1", "create cmdline@1", "remove cmdline@1", "focus list of 1"]);
});

test("removing the hud returns the focus to nothing: it never held the keyboard", () => {
    const { log, host } = setup();
    host.mount({ windowId: 1, surface: "hud" });
    host.unmount({ windowId: 1, surface: "hud" });
    assert.deepEqual(log, ["create hud@1", "remove hud@1"]);
});

test("a second hud mount replaces the first and a hud unmount leaves the command line", () => {
    const { windows, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    host.mount({ windowId: 1, surface: "hud" });
    host.mount({ windowId: 1, surface: "hud" });
    assert.deepEqual(windows.get(1)!.boxes, ["cmdline@1", "hud@1"]);
    host.unmount({ windowId: 1, surface: "hud" });
    assert.deepEqual(windows.get(1)!.boxes, ["cmdline@1"]);
});

test("a tab change or Escape closes the command line and leaves the hud", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "hud" });
    host.mount({ windowId: 1, surface: "cmdline" });
    for (const listener of windows.get(1)!.escape_listeners) listener();
    assert.deepEqual(windows.get(1)!.boxes, ["hud@1"]);
    assert.deepEqual(log.slice(-2), ["focus list of 1", "closed 1"]);
    assert.equal(windows.get(1)!.tab_listeners.size, 0);
});

test("a closing window removes both and reports each with its surface", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "hud" });
    host.mount({ windowId: 1, surface: "cmdline" });
    for (const listener of [...windows.get(1)!.unload_listeners]) listener();
    assert.deepEqual(windows.get(1)!.boxes, []);
    assert.ok(log.includes("closed hud 1") && log.includes("closed 1"));
    assert.ok(!log.some((line) => line.startsWith("focus")));
});

test("unmount names a surface from the fixed list", () => {
    const { host } = setup();
    assert.throws(() => host.unmount({ windowId: 1, surface: "elsewhere" as never }), /unknown surface/);
});

test("closing the command line gives the focus back to what had it, such as the reading pane", () => {
    const { windows, log, host } = setup();
    windows.get(1)!.held_focus = "message browser";
    host.mount({ windowId: 1, surface: "cmdline" });
    host.unmount({ windowId: 1, surface: "cmdline" });
    assert.deepEqual(log, ["create cmdline@1", "remove cmdline@1", "restore message browser"]);
});

test("Escape from outside the page restores the same element, and a gone element falls back to the thread list", () => {
    const { windows, log, host } = setup();
    windows.get(1)!.held_focus = "message browser";
    host.mount({ windowId: 1, surface: "cmdline" });
    for (const listener of windows.get(1)!.escape_listeners) listener();
    assert.deepEqual(log.slice(-2), ["restore message browser", "closed 1"]);
    windows.get(2)!.held_focus = null;
    host.mount({ windowId: 2, surface: "cmdline" });
    host.unmount({ windowId: 2, surface: "cmdline" });
    assert.equal(log.at(-1), "focus list of 2");
});
