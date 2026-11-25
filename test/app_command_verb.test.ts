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

/** A view that answers `viewNavigate` from a table of motion to the index it finds. The key follows the index, and `NONE` is the all-ones key. Previous unread with none left gives index 0 and no key, as Thunderbird does. */
const NONE = 0xffffffff;
const SHOWN_KEY = 40;
const view_finding = (found: Record<number, number>, asked: [number, boolean][] = []) => ({
    dbView: {
        viewNavigate: (motion: number, key: { value: number }, index: { value: number }, _thread: unknown, wrap: boolean) => {
            asked.push([motion, wrap]);
            index.value = found[motion] ?? 0;
            key.value = motion in found ? 100 + index.value : NONE;
        },
    },
});

test("a step command runs only when the view has a row to step to, asks with no wrap, and answers false at the end", async () => {
    const motions = { cmd_nextMsg: 2, cmd_previousMsg: 3, cmd_nextUnreadMsg: 7, cmd_previousUnreadMsg: 8 } as const;
    for (const [name, motion] of Object.entries(motions)) {
        const log: string[] = [];
        const asked: [number, boolean][] = [];
        const window = { messageBrowser: { contentWindow: { ...holder_for("window", log), gMessage: { messageKey: SHOWN_KEY }, gViewWrapper: view_finding({ [motion]: 5 }, asked) } } };
        const platform = with_windows({ "mail:messageWindow": [window] });
        assert.equal(await verbs().appCommand({ windowId: 1, name: name as keyof typeof motions }), true, name);
        assert.deepEqual(log, [`window ${name}`]);
        assert.deepEqual(asked, [[motion, false]], "the question never wraps");
        platform.restore();
    }
});

test("a step command at the first or last message answers false and does not run, so next unread never wraps", async () => {
    for (const name of ["cmd_nextMsg", "cmd_previousMsg", "cmd_nextUnreadMsg", "cmd_previousUnreadMsg"] as const) {
        const log: string[] = [];
        const platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: { ...holder_for("window", log), gViewWrapper: view_finding({}) } } }] });
        assert.equal(await verbs().appCommand({ windowId: 1, name }), false, name);
        assert.deepEqual(log, [], name);
        platform.restore();
    }
});

test("a step command answers false when the view hands back the shown message, as it does at the first and last message", async () => {
    const log: string[] = [];
    const stays = { dbView: { viewNavigate: (_motion: number, key: { value: number }, index: { value: number }) => ((key.value = SHOWN_KEY), (index.value = 3)) } };
    const platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: { ...holder_for("window", log), gMessage: { messageKey: SHOWN_KEY }, gViewWrapper: stays } } }] });
    for (const name of ["cmd_nextMsg", "cmd_previousMsg", "cmd_previousUnreadMsg"] as const) assert.equal(await verbs().appCommand({ windowId: 1, name }), false, name);
    assert.deepEqual(log, []);
    platform.restore();
});

test("a step command in a window with no view (an .eml file) answers false, and a disabled controller is not asked about the view", async () => {
    const log: string[] = [];
    let platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: { ...holder_for("window", log, false), gViewWrapper: null } } }] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_nextMsg" }), false);
    platform.restore();
    // A controller that claims enabled with no view still refuses: there is no row to step to.
    platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: { ...holder_for("window", log), gViewWrapper: null } } }] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_nextUnreadMsg" }), false);
    assert.deepEqual(log, []);
    platform.restore();
});

test("a name outside the fixed table throws and runs nothing", async () => {
    const log: string[] = [];
    const platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: holder_for("window", log) } }] });
    await assert.rejects(verbs().appCommand({ windowId: 1, name: "cmd_deleteMsg" as never }), /bad name/);
    assert.deepEqual(log, []);
    platform.restore();
});

test("the conversation command never asks the view", async () => {
    const log: string[] = [];
    const platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: holder_for("window", log) } }] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_openConversation" }), true);
    platform.restore();
});

/** A page holder whose top window has the controller that answers the fetch commands. */
const holder_with_top = (log: string[], enabled = true) => ({ ...holder_for("page", log), browsingContext: { topChromeWindow: { controllers: { getControllerForCommand: (name: string) => (log.push(`asked ${name}`), controller_for("top", log, enabled)) } } } });

test("the fetch commands run on the controller of the top window, in the mail tab and in a message window", async () => {
    for (const name of ["cmd_getNewMessages", "cmd_getMsgsForAuthAccounts"] as const) {
        let log: string[] = [];
        let platform = with_windows({ "mail:3pane": [main_window("mail3PaneTab", holder_with_top(log))] });
        assert.equal(await verbs().appCommand({ windowId: 1, name }), true, name);
        assert.deepEqual(log, [`asked ${name}`, `top ${name}`], "the page controller is not used");
        platform.restore();
        log = [];
        platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: holder_with_top(log) } }] });
        assert.equal(await verbs().appCommand({ windowId: 1, name }), true, name);
        assert.deepEqual(log, [`asked ${name}`, `top ${name}`]);
        platform.restore();
    }
});

test("a fetch command the top window has disabled answers false and does not run", async () => {
    const log: string[] = [];
    const platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: holder_with_top(log, false) } }] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_getNewMessages" }), false);
    assert.deepEqual(log, ["asked cmd_getNewMessages"]);
    platform.restore();
});

test("a fetch command in a tab with no page of its own runs on the window controller, and a missing controller answers false", async () => {
    const log: string[] = [];
    const top = { controllers: { getControllerForCommand: (name: string) => (log.push(`asked ${name}`), controller_for("top", log)) } };
    let platform = with_windows({ "mail:3pane": [{ ...main_window("calendar", undefined), ...top }] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_getNewMessages" }), true);
    assert.deepEqual(log, ["asked cmd_getNewMessages", "top cmd_getNewMessages"]);
    platform.restore();
    platform = with_windows({ "mail:3pane": [{ ...main_window("calendar", undefined), controllers: { getControllerForCommand: () => null } }] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_getNewMessages" }), false, "a null controller");
    platform.restore();
    platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: {} } }] });
    assert.equal(await verbs().appCommand({ windowId: 1, name: "cmd_getNewMessages" }), false, "no browsing context");
    platform.restore();
    platform = with_windows({ "mail:messageWindow": [{ messageBrowser: { contentWindow: {} } }] });
    await assert.rejects(verbs().appCommand({ windowId: 1, name: "cmd_nextMsg" }), /shows no message/, "a page command still needs its page controller");
    platform.restore();
});
