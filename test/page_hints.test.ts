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
        await pages.install({ pageTree: tree_of(compile_tab_keymap("page")) as never, messageTree: page_message_tree(tree_of(compile_tab_keymap("message")) as never), typingTree: tree_of(compile_typing_keymap()) as never, holdCommands: [] });
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
