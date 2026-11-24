import assert from "node:assert/strict";
import { test } from "node:test";
import { focus_remote_tab, hook_page_focus } from "../src/chrome/page_focus.ts";
import { stub_platform } from "./chrome_stubs.ts";

function window_with(active: { localName: string } | null, browser: { isRemoteBrowser: boolean } | null, mode = "contentTab") {
    const focused: string[] = [];
    const listeners = new Map<string, () => void>();
    const tab_browser = browser && { ...browser, focus: () => void focused.push("browser") };
    const window = {
        document: { activeElement: active, getElementById: () => ({ currentTabInfo: { mode: { name: mode }, browser: tab_browser } }) },
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

// The popup opens the options or help tab while its own browser still holds the focus.
test("a remote tab gets the focus from an add-on's toolbar popup, and not from another browser", () => {
    const popup_browser = { localName: "browser", getAttribute: (name: string) => (name === "webextension-view-type" ? "popup" : null) };
    const from_popup = window_with(popup_browser, { isRemoteBrowser: true });
    focus_remote_tab(from_popup.window);
    assert.deepEqual(from_popup.focused, ["browser"]);
    const from_other_browser = window_with({ localName: "browser", getAttribute: () => null } as never, { isRemoteBrowser: true });
    focus_remote_tab(from_other_browser.window);
    assert.deepEqual(from_other_browser.focused, []);
});

test("an element the user focused keeps the focus, and a page that is not remote is left alone", () => {
    const kept = window_with({ localName: "input" }, { isRemoteBrowser: true });
    focus_remote_tab(kept.window);
    assert.deepEqual(kept.focused, []);
    const local = window_with({ localName: "body" }, { isRemoteBrowser: false });
    focus_remote_tab(local.window);
    assert.deepEqual(local.focused, []);
    const mail = window_with({ localName: "body" }, { isRemoteBrowser: true }, "mail3PaneTab");
    focus_remote_tab(mail.window);
    assert.deepEqual(mail.focused, [], "a mail or message tab is never touched");
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
