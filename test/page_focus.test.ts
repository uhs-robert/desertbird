import assert from "node:assert/strict";
import { test } from "node:test";
import { focus_remote_tab, hook_page_focus } from "../src/chrome/page_focus.ts";
import { stub_platform } from "./chrome_stubs.ts";

function window_with(active: { localName: string } | null, browser: { isRemoteBrowser: boolean } | null) {
    const focused: string[] = [];
    const listeners = new Map<string, () => void>();
    const tab_browser = browser && { ...browser, focus: () => void focused.push("browser") };
    const window = {
        document: { activeElement: active, getElementById: () => ({ currentTabInfo: { mode: { name: "contentTab" }, browser: tab_browser } }) },
        addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
        removeEventListener: (type: string) => void listeners.delete(type),
        setTimeout: (run: () => void) => void run(),
    };
    return { window: window as never, focused, listeners };
}

test("a remote tab gets the focus when nothing or the tab strip has it", () => {
    for (const active of [null, { localName: "body" }, { localName: "tab" }, { localName: "tabs" }]) {
        const { window, focused } = window_with(active, { isRemoteBrowser: true });
        focus_remote_tab(window);
        assert.deepEqual(focused, ["browser"], String(active?.localName));
    }
});

test("an element the user focused keeps the focus, and a page that is not remote is left alone", () => {
    const kept = window_with({ localName: "input" }, { isRemoteBrowser: true });
    focus_remote_tab(kept.window);
    assert.deepEqual(kept.focused, []);
    const local = window_with({ localName: "body" }, { isRemoteBrowser: false });
    focus_remote_tab(local.window);
    assert.deepEqual(local.focused, []);
    const none = window_with({ localName: "body" }, null);
    focus_remote_tab(none.window);
    assert.deepEqual(none.focused, []);
});

test("every main window is hooked on load, and unhooked on unload and on stop", () => {
    const platform = stub_platform();
    try {
        const stop = hook_page_focus();
        const [listener] = [...platform.window_listeners.values()] as { onLoadWindow(window: never): void; onUnloadWindow(window: never): void }[];
        const first = window_with({ localName: "body" }, { isRemoteBrowser: true });
        listener!.onLoadWindow(first.window);
        first.listeners.get("TabSelect")!();
        assert.deepEqual(first.focused, ["browser"], "TabSelect hands the focus over");
        listener!.onUnloadWindow(first.window);
        assert.equal(first.listeners.size, 0);
        const second = window_with(null, { isRemoteBrowser: true });
        listener!.onLoadWindow(second.window);
        stop();
        assert.equal(second.listeners.size, 0);
        assert.equal(platform.window_listeners.size, 0);
    } finally {
        platform.restore();
    }
});
