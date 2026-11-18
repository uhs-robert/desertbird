import assert from "node:assert/strict";
import { test } from "node:test";
import { app_verbs } from "../src/chrome/app_verbs.ts";
import { stub_platform } from "./chrome_stubs.ts";

/** A controller that records what ran and whether the page's message may open a conversation. */
const controller_for = (page: string, log: string[], enabled = true) => ({ isCommandEnabled: () => enabled, doCommand: (name: string) => void log.push(`${page} ${name}`) });
const holder_for = (page: string, log: string[], enabled?: boolean) => ({ commandController: controller_for(page, log, enabled) });

/** Windows by type: `Services.wm.getEnumerator` answers each type with its own list. */
function with_windows(by_type: Record<string, unknown[]>) {
    const platform = stub_platform();
    const services = (globalThis as unknown as { Services: { wm: { getEnumerator(type: string): unknown[] } } }).Services;
    services.wm.getEnumerator = (type: string) => by_type[type] ?? [];
    return platform;
}

const main_window = (mode: string, holder: unknown) => ({ document: { getElementById: () => ({ currentTabInfo: { mode: { name: mode }, chromeBrowser: { contentWindow: holder } } }) } });
const verbs = () => app_verbs({ extension: { windowManager: { getWrapper: () => ({ id: 1 }) }, messageManager: { convert: () => null } } } as never);

test("the conversation command runs on the page of the front tab: the mail tab and a message tab", async () => {
    for (const mode of ["mail3PaneTab", "mailMessageTab"]) {
        const log: string[] = [];
        const platform = with_windows({ "mail:3pane": [main_window(mode, holder_for(mode, log))] });
        assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_openConversation" }), true, mode);
        assert.deepEqual(log, [`${mode} cmd_openConversation`]);
        platform.restore();
    }
});

test("the conversation command runs on the about:message of a message window", async () => {
    const log: string[] = [];
    const platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: holder_for("window", log) } }] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_openConversation" }), true);
    assert.deepEqual(log, ["window cmd_openConversation"]);
    platform.restore();
});

test("a disabled controller answers false, and a window with no controller refuses", async () => {
    const log: string[] = [];
    let platform = with_windows({ "mail:3pane": [main_window("mailMessageTab", holder_for("tab", log, false))] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_openConversation" }), false);
    assert.deepEqual(log, []);
    platform.restore();
    platform = with_windows({ "mail:3pane": [main_window("calendar", {})] });
    await assert.rejects(verbs().appCommand({ windowId: 1, name: "cmd_openConversation" }), /shows no message/);
    platform.restore();
});
