import assert from "node:assert/strict";
import { test } from "node:test";
import type { FocusNode } from "../src/chrome/focus.ts";
import { situation_of } from "../src/chrome/readable_focus.ts";
import type { FrontTab } from "../src/chrome/readable_focus.ts";

const READABLE_TAB: FrontTab = { mode: "calendar", browser_is_remote: false };
const REMOTE_TAB: FrontTab = { mode: "contentTab", browser_is_remote: true };
const event = (target: FocusNode = { localName: "body" }) => ({ target });

function document_with(active: FocusNode | null, popup_state?: string) {
    return { activeElement: active, querySelectorAll: () => (popup_state ? [{ state: popup_state }] : []) };
}

test("the mail tab and no tab at all pass", () => {
    assert.equal(situation_of(document_with(null), { mode: "mail3PaneTab", browser_is_remote: false }, event()), "pass");
    assert.equal(situation_of(document_with(null), null, event()), "pass");
});

test("a chrome tab with the focus on a button, or on nothing, is a page", () => {
    assert.equal(situation_of(document_with({ localName: "button" }), READABLE_TAB, event()), "page");
    assert.equal(situation_of(document_with(null), READABLE_TAB, event()), "page");
});

test("a parent-process page the walk can enter is a page, also in a tab with a browser", () => {
    const inner = { localName: "a" };
    const browser = { localName: "browser", contentDocument: { activeElement: inner } };
    assert.equal(situation_of(document_with(browser), { mode: "contentTab", browser_is_remote: false }, event()), "page");
});

test("a text field, wherever the event or the focus names it, is a field", () => {
    assert.equal(situation_of(document_with({ localName: "input" }), READABLE_TAB, event()), "field");
    assert.equal(situation_of(document_with(null), READABLE_TAB, event({ localName: "textarea" })), "field");
    const browser = { localName: "browser", contentDocument: { activeElement: { localName: "search-textbox" } } };
    assert.equal(situation_of(document_with(browser), READABLE_TAB, event()), "field");
    assert.equal(situation_of(document_with({ localName: "div", isContentEditable: true }), READABLE_TAB, event()), "field");
});

test("an open menu passes, before any other check", () => {
    assert.equal(situation_of(document_with({ localName: "input" }, "open"), READABLE_TAB, event()), "pass");
    assert.equal(situation_of(document_with({ localName: "button" }, "showing"), READABLE_TAB, event()), "pass");
    assert.equal(situation_of(document_with({ localName: "button" }, "closed"), READABLE_TAB, event()), "page");
});

test("a chain that ends in a browser the walk cannot enter is remote", () => {
    const browser = { localName: "browser", contentDocument: null };
    assert.equal(situation_of(document_with(browser), REMOTE_TAB, event()), "remote");
    assert.equal(situation_of(document_with(browser), { mode: "contentTab", browser_is_remote: false }, event()), "remote");
});

test("nothing focused in a tab whose browser is remote is remote, so j never scrolls a chrome document behind a remote page", () => {
    for (const active of [null, { localName: "body" }, { localName: "tab" }, { localName: "tabs" }]) assert.equal(situation_of(document_with(active), REMOTE_TAB, event()), "remote", String(active?.localName));
});

test("a focused chrome element in a remote tab is the user's own choice and stays a page", () => {
    assert.equal(situation_of(document_with({ localName: "button" }), REMOTE_TAB, event()), "page");
});

test("a remote page whose browser holds the overlay is typing, by its id", () => {
    const overlay = { localName: "browser", id: "desertbird-overlay-browser", contentDocument: null };
    assert.equal(situation_of(document_with(overlay), REMOTE_TAB, event()), "typing");
});

test("a remote page whose browser holds the overlay is no typing target until the overlay's page has loaded", () => {
    const loading = { localName: "browser", id: "desertbird-overlay-loading", contentDocument: null };
    assert.equal(situation_of(document_with(loading), REMOTE_TAB, event()), "remote");
});

test("a message tab with the focus outside the body is a message, and a message body that runs the body script is typing", () => {
    const tab: FrontTab = { mode: "mailMessageTab", browser_is_remote: false };
    assert.equal(situation_of(document_with({ localName: "button" }), tab, event()), "message");
    assert.equal(situation_of(document_with(null), tab, event()), "message");
    const body = { localName: "browser", id: "messagepane", contentDocument: { activeElement: null, documentElement: { hasAttribute: () => true } } };
    assert.equal(situation_of(document_with(body), tab, event()), "typing");
});

test("a text field of the mail tab is a field, and the rest of the mail tab passes", () => {
    const mail: FrontTab = { mode: "mail3PaneTab", browser_is_remote: false };
    assert.equal(situation_of(document_with({ localName: "search-textbox" }), mail, event()), "field");
    assert.equal(situation_of(document_with({ localName: "button" }), mail, event()), "pass");
    assert.equal(situation_of(document_with({ localName: "input" }, "open"), mail, event()), "pass", "an open menu comes first");
});

test("the overlay's browser and a message body that runs the body script are typing and no field", () => {
    const overlay = { localName: "browser", id: "desertbird-overlay-browser", contentDocument: null };
    assert.equal(situation_of(document_with(overlay), READABLE_TAB, event(overlay)), "typing");
    const body = { localName: "body" };
    const live = { hasAttribute: (name: string) => name === "data-desertbird-keys" };
    const message_pane = { localName: "browser", id: "messagepane", contentDocument: { activeElement: null, body, documentElement: live } };
    const message_browser = { localName: "browser", id: "messageBrowser", contentDocument: { activeElement: message_pane } };
    const message_tab: FrontTab = { mode: "mailMessageTab", browser_is_remote: false };
    assert.equal(situation_of(document_with({ localName: "browser", contentDocument: { activeElement: message_browser } }), message_tab, event()), "typing");
});
