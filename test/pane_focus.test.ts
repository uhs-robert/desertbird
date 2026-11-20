import assert from "node:assert/strict";
import { test } from "node:test";
import { app_verbs } from "../src/chrome/app_verbs.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE } from "../src/shared/protocol.ts";
import type { Pane } from "../src/shared/protocol.ts";
import { stub_platform } from "./chrome_stubs.ts";

/** A main window with one mail tab. `focus` names the pane whose element holds the focus, and each pane's `focus()` moves it there. */
function mail_window({ folder_pane = true, message_pane = true, body_live = true } = {}) {
    let focus: Pane | "header" = "threads";
    const focusable = (pane: Pane) => ({ focus: () => void (focus = pane) });
    const node_of = (pane: Pane | "header") => ({ folders: { id: "folderTree" }, threads: { localName: "tbody" }, header: { localName: "button" }, message: { id: "messageBrowser" } })[pane];
    const message_body = { ...focusable("message"), contentDocument: { documentElement: { hasAttribute: (name: string) => body_live && name === BODY_SCRIPT_LIVE_ATTRIBUTE } } };
    const about_3pane = {
        folderTree: focusable("folders"),
        threadTree: { table: { body: focusable("threads") } },
        messageBrowser: { contentWindow: { getMessagePaneBrowser: () => message_body } },
        paneLayout: { folderPaneVisible: folder_pane, messagePaneVisible: message_pane },
        browsingContext: { topChromeWindow: {} as unknown },
    };
    const document = {
        get activeElement() {
            return { localName: "browser", contentDocument: { activeElement: node_of(focus) } };
        },
        getElementById: () => ({ currentTabInfo: { mode: { name: "mail3PaneTab" }, chromeBrowser: { contentWindow: about_3pane } } }),
        hasFocus: () => true,
    };
    about_3pane.browsingContext.topChromeWindow = { document };
    return { window: { document, addEventListener() {}, removeEventListener() {} }, focused: () => focus, set_focus: (pane: Pane | "header") => void (focus = pane) };
}

function verbs(window: unknown) {
    const platform = stub_platform([window]);
    const app = app_verbs({ extension: { windowManager: { getWrapper: () => ({ id: 1 }) }, messageManager: { convert: () => null } } });
    return { focus: (pane: Pane | "left" | "right") => app.paneFocus({ windowId: 1, pane }), restore: platform.restore };
}

test("pane focus by name moves the focus there and answers true", async () => {
    const mail = mail_window();
    const { focus, restore } = verbs(mail.window);
    for (const pane of ["folders", "message", "threads"] as const) {
        assert.equal(await focus(pane), true, pane);
        assert.equal(mail.focused(), pane);
    }
    restore();
});

test("left and right step one pane and stop at the ends", async () => {
    const mail = mail_window();
    const { focus, restore } = verbs(mail.window);
    const steps: [Pane, "left" | "right", Pane, boolean][] = [
        ["threads", "left", "folders", true],
        ["folders", "left", "folders", false],
        ["folders", "right", "threads", true],
        ["threads", "right", "message", true],
        ["message", "right", "message", false],
        ["message", "left", "threads", true],
    ];
    for (const [from, side, to, moved] of steps) {
        mail.set_focus(from);
        assert.equal(await focus(side), moved, `${side} from ${from}`);
        assert.equal(mail.focused(), to, `${side} from ${from}`);
    }
    restore();
});

test("focus on something else in the mail tab counts as the thread list", async () => {
    const mail = mail_window();
    const { focus, restore } = verbs(mail.window);
    mail.set_focus("header");
    assert.equal(await focus("left"), true);
    assert.equal(mail.focused(), "folders");
    restore();
});

test("a hidden folder pane takes no focus, by name or from the thread list", async () => {
    const mail = mail_window({ folder_pane: false });
    const { focus, restore } = verbs(mail.window);
    assert.equal(await focus("folders"), false);
    assert.equal(await focus("left"), false);
    assert.equal(mail.focused(), "threads");
    restore();
});

test("a hidden message pane, or one with no live message body, takes no focus", async () => {
    for (const options of [{ message_pane: false }, { body_live: false }]) {
        const mail = mail_window(options);
        const { focus, restore } = verbs(mail.window);
        assert.equal(await focus("message"), false, JSON.stringify(options));
        assert.equal(await focus("right"), false, JSON.stringify(options));
        assert.equal(mail.focused(), "threads", JSON.stringify(options));
        restore();
    }
});
