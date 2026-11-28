import assert from "node:assert/strict";
import { test } from "node:test";
import { focus_folder_pane_when_ready, focus_remote_tab } from "../src/chrome/page_focus.ts";
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
        clearTimeout: () => {},
        performance: { now: () => 500 },
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

test("every main window is hooked on load, and unhooked on unload and on stop", async () => {
    const hook_page_focus = await fresh_hook_page_focus();
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

// The startup focus: a fake window whose timers the test runs by hand.
interface StartupOptions {
    mode?: string;
    folder_pane_visible?: boolean;
    ready_state?: string;
    active?: "thread_body" | "folder_tree" | "input" | "none" | "body";
    age_ms?: number;
    has_tab?: boolean;
}

function startup_window(options: StartupOptions = {}) {
    const thread_body = { localName: "tbody" };
    const folder_tree = { localName: "ul", id: "folderTree" };
    const focused: string[] = [];
    const pane = {
        document: { readyState: options.ready_state ?? "complete" },
        folderTree: { focus: () => void focused.push("folders") },
        threadTree: { table: { body: thread_body } },
        paneLayout: { folderPaneVisible: options.folder_pane_visible ?? true },
    };
    const state = { active: options.active ?? "thread_body", mode: options.mode ?? "mail3PaneTab", has_tab: options.has_tab ?? true, pane: pane as typeof pane | null };
    const timers: (() => void)[] = [];
    const listeners = new Map<string, () => void>();
    const nodes = { thread_body, folder_tree, input: { localName: "input" }, none: null, body: { localName: "body" } };
    const window = {
        document: {
            get activeElement() {
                return nodes[state.active];
            },
            getElementById: () => ({ currentTabInfo: state.has_tab ? { mode: { name: state.mode }, chromeBrowser: { contentWindow: state.pane } } : null }),
        },
        performance: { now: () => options.age_ms ?? 500 },
        setTimeout: (run: () => void) => timers.push(run),
        clearTimeout: () => void (timers.length = 0),
        addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
        removeEventListener: (type: string) => void listeners.delete(type),
    };
    return { window: window as never, state, focused, timers };
}

let instance = 0;
// The once-only startup claim lives in module state, so each case loads its own copy of the module.
const fresh_hook_page_focus = async () => (await import(`../src/chrome/page_focus.ts?instance=${instance++}`) as typeof import("../src/chrome/page_focus.ts")).hook_page_focus;

async function hooked(...windows: { window: never }[]) {
    const hook_page_focus = await fresh_hook_page_focus();
    const platform = stub_platform();
    const stop = hook_page_focus();
    const [listener] = [...platform.window_listeners.values()] as { onLoadWindow(window: never): void }[];
    for (const each of windows) listener!.onLoadWindow(each.window);
    return {
        stop() {
            stop();
            platform.restore();
        },
    };
}

test("the first window gets the folder tree focus once the mail tab is ready", async () => {
    const first = startup_window({ ready_state: "loading" });
    const hook = await hooked(first);
    try {
        assert.deepEqual(first.focused, [], "the page is not ready yet");
        assert.equal(first.timers.length, 1, "a poll is waiting");
        first.state.pane!.document.readyState = "complete";
        first.timers.shift()!();
        assert.deepEqual(first.focused, ["folders"]);
        assert.equal(first.timers.length, 0, "the poll ends after the one focus");
    } finally {
        hook.stop();
    }
});

test("no mail tab yet is waited out, and the focus lands once the tab appears", async () => {
    const first = startup_window({ has_tab: false });
    const hook = await hooked(first);
    try {
        assert.equal(first.timers.length, 1);
        first.state.has_tab = true;
        first.timers.shift()!();
        assert.deepEqual(first.focused, ["folders"]);
    } finally {
        hook.stop();
    }
});

test("a hidden folder pane keeps the focus where it is", async () => {
    const first = startup_window({ folder_pane_visible: false });
    const hook = await hooked(first);
    try {
        assert.deepEqual(first.focused, []);
        assert.equal(first.timers.length, 0, "nothing is left to wait for");
    } finally {
        hook.stop();
    }
});

test("a front tab that is not a mail tab keeps the focus", async () => {
    for (const mode of ["contentTab", "calendar", "chat", "mailMessageTab"]) {
        const first = startup_window({ mode });
        const hook = await hooked(first);
        try {
            assert.deepEqual(first.focused, [], mode);
            assert.equal(first.timers.length, 0, mode);
        } finally {
            hook.stop();
        }
    }
});

test("focus the user already moved stays, and an empty or body focus counts as untouched", async () => {
    for (const active of ["input", "folder_tree"] as const) {
        const first = startup_window({ active });
        const hook = await hooked(first);
        try {
            assert.deepEqual(first.focused, [], active);
        } finally {
            hook.stop();
        }
    }
    for (const active of ["none", "body"] as const) {
        const first = startup_window({ active });
        const hook = await hooked(first);
        try {
            assert.deepEqual(first.focused, ["folders"], active);
        } finally {
            hook.stop();
        }
    }
});

test("a second main window keeps Thunderbird's focus, also when the first is gone", async () => {
    const first = startup_window();
    const second = startup_window();
    const hook = await hooked(first, second);
    try {
        assert.deepEqual(first.focused, ["folders"]);
        assert.deepEqual(second.focused, [], "only the first main window of the run");
    } finally {
        hook.stop();
    }
});

test("an add-on reload with a window that has been open a while does not move the focus", async () => {
    const open = startup_window({ age_ms: 5 * 60_000 });
    const later = startup_window();
    const hook = await hooked(open, later);
    try {
        assert.deepEqual(open.focused, []);
        assert.equal(open.timers.length, 0);
        assert.deepEqual(later.focused, [], "the open window used the claim");
    } finally {
        hook.stop();
    }
});

test("a window that never gets a ready mail tab gives up after the startup window, and unhooking ends the poll", async () => {
    const slow = startup_window({ ready_state: "loading" });
    const hook = await hooked(slow);
    try {
        assert.equal(slow.timers.length, 1);
        slow.timers.shift()!();
        assert.equal(slow.timers.length, 1, "still waiting");
    } finally {
        hook.stop();
    }
    assert.equal(slow.timers.length, 0, "unhooking cancels the live poll");
    const old = startup_window({ ready_state: "loading", age_ms: 31_000 });
    const hook2 = await hooked(old);
    try {
        assert.equal(old.timers.length, 0, "past the window the poll gives up");
        assert.deepEqual(old.focused, []);
    } finally {
        hook2.stop();
    }
});

test("focus_folder_pane_when_ready reports wait for a pane without its trees", () => {
    const first = startup_window();
    first.state.pane = { document: { readyState: "complete" } } as never;
    assert.equal(focus_folder_pane_when_ready(first.window), "wait");
});
