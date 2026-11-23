import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_tab_keymap, compile_typing_keymap, page_message_tree } from "../src/background/commands/tab_keymaps.ts";
import { COMPILED_KEYMAP_VERSION, HINTS_LIVE_ATTRIBUTE } from "../src/shared/protocol.ts";
import { stub_platform } from "./chrome_stubs.ts";

const tree_of = (result: ReturnType<typeof compile_tab_keymap>) => ({ version: COMPILED_KEYMAP_VERSION, root: JSON.parse(JSON.stringify(result.compiled.modes.normal)) as unknown });

// The hint pick and the page keys both listen on the window root, and the page keys were there first. The marker the pick sets is what keeps a hint letter from running as a page key after the hold runs out.
test("the page keys pass every key while the window root carries the hint marker, and take them again after", async () => {
    const key_listeners: ((event: unknown) => void)[] = [];
    const marks = new Set<string>();
    const body = { localName: "body" };
    const window = {
        windowRoot: { addEventListener: (_type: string, listener: (event: unknown) => void) => void key_listeners.push(listener), removeEventListener() {} },
        addEventListener() {},
        removeEventListener() {},
        document: { activeElement: body, documentElement: { hasAttribute: (name: string) => marks.has(name) }, querySelectorAll: () => [], getElementById: (id: string) => (id === "tabmail" ? { currentTabInfo: { mode: { name: "calendar" } } } : null), hasFocus: () => true },
    };
    const platform = stub_platform([window]);
    try {
        const { get_pages_api, shutdown } = await import("../src/chrome/parent_pages.ts");
        const context = { extension: { windowManager: { getWrapper: () => ({ id: 3 }) }, messageManager: { convert: () => null } } };
        const pages = get_pages_api(context as never).pages;
        const ran: string[] = [];
        (pages.onInvocation as { subscribe(listener: (event: { command: string }) => void): void }).subscribe((event) => ran.push(event.command));
        await pages.install({ pageTree: tree_of(compile_tab_keymap("page")) as never, messageTree: page_message_tree(tree_of(compile_tab_keymap("message")) as never), windowTree: page_message_tree(tree_of(compile_tab_keymap("window")) as never), typingTree: tree_of(compile_typing_keymap()) as never, holdCommands: [] });
        const press = (key: string) => {
            const outcome = { cancelled: false };
            const event = { key, code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, target: body, preventDefault: () => void (outcome.cancelled = true), stopPropagation() {} };
            for (const listener of key_listeners) listener(event);
            return outcome;
        };
        marks.add(HINTS_LIVE_ATTRIBUTE);
        assert.deepEqual(press("q"), { cancelled: false });
        assert.deepEqual(ran, [], "q is a hint key while the labels show, not a close");
        marks.delete(HINTS_LIVE_ATTRIBUTE);
        assert.deepEqual(press("q"), { cancelled: true });
        assert.deepEqual(ran, ["tab.close"]);
        shutdown();
    } finally {
        platform.restore();
    }
});

// A message window has no tabmail. The pages runtime hooks it too and reads its message from `messageBrowser` at key time.
test("a message window header runs message mode: j scrolls the body, m s flags the window's message, J does nothing, and a key before about:message loads is safe", async () => {
    const key_listeners: ((event: unknown) => void)[] = [];
    const header = { localName: "div" };
    const scrolled: number[] = [];
    const body_root = { scrollHeight: 2000, clientHeight: 500, scrollBy: ({ top }: { top?: number }) => void scrolled.push(top ?? 0), scrollTo() {} };
    const message_header = { subject: "a message" };
    const window: Record<string, unknown> = {
        windowRoot: { addEventListener: (_type: string, listener: (event: unknown) => void) => void key_listeners.push(listener), removeEventListener() {} },
        addEventListener() {},
        removeEventListener() {},
        document: { activeElement: header, documentElement: { hasAttribute: () => false }, querySelectorAll: () => [], getElementById: () => null, hasFocus: () => true },
    };
    const platform = stub_platform([window]);
    try {
        const { get_pages_api, shutdown } = await import("../src/chrome/parent_pages.ts");
        const context = { extension: { windowManager: { getWrapper: () => ({ id: 4 }) }, messageManager: { convert: (header: unknown) => (header === message_header ? { id: 77 } : null) } } };
        const pages = get_pages_api(context as never).pages;
        const ran: { command: string; messageIds?: number[] }[] = [];
        (pages.onInvocation as { subscribe(listener: (event: { command: string; messageIds?: number[] }) => void): void }).subscribe((event) => ran.push(event));
        await pages.install({ pageTree: tree_of(compile_tab_keymap("page")) as never, messageTree: page_message_tree(tree_of(compile_tab_keymap("message")) as never), windowTree: page_message_tree(tree_of(compile_tab_keymap("window")) as never), typingTree: tree_of(compile_typing_keymap()) as never, holdCommands: [] });
        const listener = platform.window_listeners.get("desertbird@uhs-robert/pages") as { chromeURLs: string[] };
        assert.deepEqual(listener.chromeURLs, ["chrome://messenger/content/messenger.xhtml", "chrome://messenger/content/messageWindow.xhtml"]);
        const press = (key: string) => {
            const outcome = { cancelled: false };
            const event = { key, code: "", ctrlKey: false, altKey: false, shiftKey: key !== key.toLowerCase(), metaKey: false, target: header, preventDefault: () => void (outcome.cancelled = true), stopPropagation() {} };
            for (const each of key_listeners) each(event);
            return outcome;
        };
        assert.equal(press("j").cancelled, true, "about:message not loaded yet: the key is taken and nothing throws");
        window["messageBrowser"] = { contentWindow: { gMessage: message_header, document: { getElementById: (id: string) => (id === "messagepane" ? { contentDocument: { scrollingElement: body_root } } : null) } } };
        press("j");
        assert.equal(scrolled.length, 1);
        press("m");
        press("s");
        assert.equal(press("J").cancelled, true);
        assert.deepEqual(ran.filter((event) => event.command !== "pending").map((event) => [event.command, event.messageIds]), [["msg.flag", [77]]]);
        shutdown();
    } finally {
        platform.restore();
    }
});
