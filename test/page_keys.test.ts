import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMPILED_KEYMAP_VERSION } from "../vendor/desertfox/prefix_tree.ts";
import { start_body_script } from "../src/content/body_keys.ts";
import type { BodyKeyEvent, BodyWindow } from "../src/content/body_keys.ts";
import { default_keymap_of, compile_tab_keymap } from "../src/background/commands/tab_keymaps.ts";
import { KEYMAP_STORAGE_KEY } from "../src/shared/protocol.ts";

// The own pages run the message key script as it is, so these tests drive it the way an options or help tab does.

async function page_started() {
    const listeners: ((event: BodyKeyEvent) => void)[] = [];
    const window = {
        innerHeight: 600,
        document: { body: {}, documentElement: { scrollHeight: 2000, setAttribute() {}, removeAttribute() {} } },
        addEventListener: (type: string, listener: (event: BodyKeyEvent) => void) => void (type === "keydown" && listeners.push(listener)),
        scrollBy() {},
        scrollTo() {},
    } as unknown as BodyWindow;
    const sent: unknown[] = [];
    const root = JSON.parse(JSON.stringify(compile_tab_keymap("message").compiled.modes.normal)) as unknown;
    const stored = { [KEYMAP_STORAGE_KEY]: { message_tree: { version: COMPILED_KEYMAP_VERSION, root } } };
    await start_body_script(window, { get: async () => stored, onChanged: { addListener() {} } }, { sendMessage: async (message) => void sent.push(message), onMessage: { addListener() {} } });
    const press = (key: string, local_name: string) => {
        let cancelled = false;
        const event = { key, code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isTrusted: true, target: { localName: local_name }, preventDefault: () => void (cancelled = true), stopPropagation() {} } as BodyKeyEvent;
        listeners.forEach((listener) => listener(event));
        return cancelled;
    };
    return { press, sent };
}

test("q on the page asks the background to close the tab", async () => {
    const { press, sent } = await page_started();
    assert.equal(press("q", "body"), true);
    assert.deepEqual(sent, [{ type: "body.invoke", command: "tab.close", args: {}, count: 1 }]);
});

test("q typed in an option input, a text area or a select is left to the page", async () => {
    const { press, sent } = await page_started();
    for (const element of ["input", "textarea", "select"]) assert.equal(press("q", element), false, element);
    assert.deepEqual(sent, []);
});

test("both own pages load the page key script before their own script", () => {
    for (const html of ["src/options/options.html", "src/help/help.html"]) {
        const text = readFileSync(html, "utf8");
        const shared = text.indexOf("../content/page_keys.js");
        assert.ok(shared >= 0, html);
        assert.ok(shared < text.indexOf(html.includes("options") ? 'src="options.js"' : 'src="help.js"'), `${html} loads page_keys.js before its own script`);
    }
});

test("the message keys open the help page on g?, ,? and Alt+?, since no key could close a panel there", () => {
    const normal = default_keymap_of("message").normal;
    for (const key of ["g?", ",?", "<A-?>"]) assert.equal((normal?.[key] as { id: string } | undefined)?.id, "help.open", key);
});
