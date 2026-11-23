import assert from "node:assert/strict";
import { test } from "node:test";
import { ESCAPE_ANSWER_MS, READY_FAILSAFE_MS, claim_id_when_page_ready, create_overlay_host, on_escape_key } from "../src/chrome/overlay.ts";

class FakeWindow {
    tab_listeners = new Set<() => void>();
    unload_listeners = new Set<() => void>();
    escape_listeners = new Set<() => void>();
    boxes: string[] = [];
    is_message_window = false;
    /** What has the focus when a surface mounts, or null for nothing that can be given back. */
    held_focus: string | null = null;
    /** The `on_not_ready` callback of each mount, in order. */
    not_ready: (() => void)[] = [];
}

function setup() {
    const windows = new Map([[1, new FakeWindow()], [2, new FakeWindow()]]);
    const log: string[] = [];
    const host = create_overlay_host<FakeWindow>({
        window_with_id: (window_id, surface) => (surface === "hud" && windows.get(window_id)?.is_message_window ? null : windows.get(window_id) ?? null),
        create(window, surface, window_id, _click_through, on_not_ready) {
            window.not_ready.push(on_not_ready);
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
        emit_closed: (window_id, surface, reason) => void log.push(surface === "cmdline" ? `closed ${window_id}${reason ? ` ${reason}` : ""}` : `closed ${surface} ${window_id}`),
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

test("a tab change focuses the new tab's thread list, not the element held in the tab it left", () => {
    const { windows, log, host } = setup();
    windows.get(1)!.held_focus = "message browser";
    host.mount({ windowId: 1, surface: "cmdline" });
    for (const listener of [...windows.get(1)!.tab_listeners]) listener();
    assert.deepEqual(log, ["create cmdline@1", "remove cmdline@1", "focus list of 1", "closed 1"]);
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
    assert.throws(() => host.mount({ windowId: 9, surface: "cmdline" }), /no window has id 9/);
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

test("Escape closes at once when the page never loaded, and after the wait when a loaded page does not answer", () => {
    const waits: { run: () => void; ms: number }[] = [];
    const wait = (run: () => void, ms: number) => void waits.push({ run, ms });
    const closed: string[] = [];
    on_escape_key(() => "", wait, () => closed.push("never loaded"));
    assert.deepEqual([closed, waits.length], [["never loaded"], 0]);
    on_escape_key(() => "DesertBird command line", wait, () => closed.push("hung"));
    assert.deepEqual([closed.length, waits[0]!.ms], [1, ESCAPE_ANSWER_MS]);
    waits[0]!.run();
    assert.deepEqual(closed, ["never loaded", "hung"]);
});

test("a page that answers Escape by changing its title keeps the overlay open", () => {
    let title = "DesertBird command line";
    const waits: (() => void)[] = [];
    const closed: string[] = [];
    on_escape_key(() => title, (run) => void waits.push(run), () => closed.push("closed"));
    title = "DesertBird command line 1";
    waits[0]!();
    assert.deepEqual(closed, []);
});

function fake_browser() {
    const listeners = new Map<string, Set<() => void>>();
    const timers: (() => void)[] = [];
    const browser = {
        id: "loading",
        contentTitle: "",
        listeners,
        timers,
        wait: (run: () => void) => void timers.push(run),
        addEventListener: (type: string, listener: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener),
        removeEventListener: (type: string, listener: () => void) => void listeners.get(type)?.delete(listener),
        fire: (type: string, title: string) => void ((browser.contentTitle = title), [...(listeners.get(type) ?? [])].forEach((listener) => listener())),
    };
    return browser;
}

test("the browser keeps its loading id until its page sets the ready title, then takes the final id and drops its listeners", () => {
    const browser = fake_browser();
    claim_id_when_page_ready(browser, "final", "Ready", browser.wait, () => {});
    assert.equal(browser.id, "loading");
    browser.fire("pagetitlechanged", "Ready");
    assert.equal(browser.id, "final");
    assert.deepEqual([...browser.listeners.values()].map((set) => set.size), [0, 0]);
});

test("an empty title or another title does not claim the id", () => {
    const browser = fake_browser();
    claim_id_when_page_ready(browser, "final", "Ready", browser.wait, () => {});
    browser.fire("pagetitlechanged", "");
    browser.fire("pagetitlechanged", "about:blank");
    assert.equal(browser.id, "loading");
});

test("the older title event name claims the id too", () => {
    const browser = fake_browser();
    claim_id_when_page_ready(browser, "final", "Ready", browser.wait, () => {});
    browser.fire("DOMTitleChanged", "Ready");
    assert.equal(browser.id, "final");
});

test("a page that is not ready in time never gets the typing id: the caller is told, and the listeners go", () => {
    const browser = fake_browser();
    let told = 0;
    claim_id_when_page_ready(browser, "final", "Ready", browser.wait, () => void told++);
    assert.equal(browser.timers.length, 1);
    browser.timers[0]!();
    assert.equal(browser.id, "loading");
    assert.equal(told, 1);
    assert.deepEqual([...browser.listeners.values()].map((set) => set.size), [0, 0]);
});

test("a page that is ready before the timer is not reported when the timer runs", () => {
    const browser = fake_browser();
    let told = 0;
    claim_id_when_page_ready(browser, "final", "Ready", browser.wait, () => void told++);
    browser.fire("pagetitlechanged", "Ready");
    browser.timers[0]!();
    assert.equal(told, 0);
    assert.equal(browser.id, "final");
});

test("the wait for the ready title is under the hold of the key runtime", () => {
    assert.ok(READY_FAILSAFE_MS < 1500);
});

test("an overlay whose page is not ready in time is removed, the focus goes back, and the background hears why", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    windows.get(1)!.held_focus = "thread list";
    windows.get(1)!.not_ready[0]!();
    assert.deepEqual(log.slice(-3), ["remove cmdline@1", "focus list of 1", "closed 1 not_ready"]);
    assert.equal(windows.get(1)!.escape_listeners.size, 0);
});

test("the not ready callback of an overlay that is already gone does nothing", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    host.unmount({ windowId: 1, surface: "cmdline" });
    const before = log.length;
    windows.get(1)!.not_ready[0]!();
    assert.equal(log.length, before);
});

test("a second mount's late callback does not close the first mount's replacement", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    host.mount({ windowId: 1, surface: "cmdline" });
    const before = log.length;
    windows.get(1)!.not_ready[0]!();
    assert.equal(log.length, before);
    windows.get(1)!.not_ready[1]!();
    assert.ok(log.includes("closed 1 not_ready"));
});

// Window 1 is a main window and window 2 a message window: the host treats both alike, one table entry per window.
test("a main window and a message window each hold a command line, and each closes on its own", () => {
    const { windows, log, host } = setup();
    windows.get(2)!.held_focus = "message pane";
    host.mount({ windowId: 1, surface: "cmdline" });
    host.mount({ windowId: 2, surface: "cmdline" });
    for (const listener of [...windows.get(2)!.escape_listeners]) listener();
    assert.deepEqual(log, ["create cmdline@1", "create cmdline@2", "remove cmdline@2", "restore message pane", "closed 2"]);
    assert.deepEqual([windows.get(1)!.boxes, windows.get(2)!.boxes], [["cmdline@1"], []]);
    assert.equal(windows.get(1)!.escape_listeners.size, 1);
});

test("a message window that closes with its line open leaves the line of the main window and moves no focus", () => {
    const { windows, log, host } = setup();
    host.mount({ windowId: 1, surface: "cmdline" });
    host.mount({ windowId: 2, surface: "cmdline" });
    for (const listener of [...windows.get(2)!.unload_listeners]) listener();
    assert.deepEqual(log, ["create cmdline@1", "create cmdline@2", "remove cmdline@2", "closed 2"]);
    assert.deepEqual(windows.get(1)!.boxes, ["cmdline@1"]);
    host.unmount({ windowId: 2, surface: "cmdline" });
    assert.equal(log.length, 4, "an unmount for the closed window does nothing");
});

test("the element the line took the focus from is gone when it closes, so the window falls back to the thread list, which a message window lacks, and the keys stay where Thunderbird put them", () => {
    const { windows, log, host } = setup();
    windows.get(2)!.held_focus = null;
    host.mount({ windowId: 2, surface: "cmdline" });
    host.unmount({ windowId: 2, surface: "cmdline" });
    assert.deepEqual(log, ["create cmdline@2", "remove cmdline@2", "focus list of 2"]);
});

test("the hud is refused in a message window and the command line is not, and a refused hud leaves no state", () => {
    const { windows, log, host } = setup();
    windows.get(2)!.is_message_window = true;
    assert.throws(() => host.mount({ windowId: 2, surface: "hud" }), /no window has id 2/);
    host.mount({ windowId: 2, surface: "cmdline" });
    host.mount({ windowId: 1, surface: "hud" });
    assert.deepEqual([windows.get(1)!.boxes, windows.get(2)!.boxes], [["hud@1"], ["cmdline@2"]]);
    assert.deepEqual(log, ["create cmdline@2", "create hud@1"]);
});
