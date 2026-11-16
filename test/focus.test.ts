import assert from "node:assert/strict";
import { test } from "node:test";
import { in_reading_pane, innermost_focus, is_typing } from "../src/chrome/focus.ts";
import type { FocusNode } from "../src/chrome/focus.ts";

const element = (localName: string, extra: Partial<FocusNode> = {}): FocusNode => ({ localName, ...extra });
const document_of = (active: FocusNode | null) => ({ activeElement: active });

test("a key whose target is the wrapping browser still finds the text field inside", () => {
    // The top window sees the `browser` of about:3pane. The quick filter input has focus inside its document.
    const field = element("input");
    const three_pane = element("browser", { contentDocument: { activeElement: field } });
    assert.equal(innermost_focus(document_of(three_pane)), field);
    assert.equal(is_typing({ target: element("div") }, document_of(three_pane)), true);
});

test("focus is followed through a shadow root", () => {
    const field = element("input");
    const host = element("search-bar", { shadowRoot: { activeElement: field } });
    assert.equal(innermost_focus(document_of(host)), field);
    assert.equal(is_typing({ target: host }, document_of(host)), true);
});

test("a textarea or an editable element is typing", () => {
    assert.equal(is_typing({ target: element("textarea") }, document_of(null)), true);
    assert.equal(is_typing({ target: element("div", { isContentEditable: true }) }, document_of(null)), true);
});

test("the original target counts", () => {
    assert.equal(is_typing({ target: element("div"), originalTarget: element("input") }, document_of(null)), true);
});

test("a key in the thread list is not typing, though the top window's composed path starts at the about:3pane browser", () => {
    // Measured in Thunderbird 153.7 and Betterbird: target and originalTarget are the list's tbody, composedPath()[0] is the browser that holds about:3pane.
    const tbody = element("tbody");
    const three_pane = element("browser", { id: "mail3PaneTabBrowser1", contentDocument: { activeElement: tbody } });
    const event = { target: tbody, originalTarget: tbody, composedPath: () => [three_pane] };
    assert.equal(is_typing(event, document_of(three_pane)), false);
});

test("a key in the folder pane is not typing", () => {
    const folder_tree = element("ul", { id: "folderTree" });
    const three_pane = element("browser", { contentDocument: { activeElement: folder_tree } });
    const event = { target: folder_tree, originalTarget: folder_tree, composedPath: () => [three_pane] };
    assert.equal(is_typing(event, document_of(three_pane)), false);
});

test("a key in the quick filter or the global search is typing", () => {
    const quick_filter_input = element("input");
    const quick_filter = element("search-bar", { id: "qfb-qs-textbox", shadowRoot: { activeElement: quick_filter_input } });
    const three_pane = element("browser", { contentDocument: { activeElement: quick_filter } });
    assert.equal(is_typing({ target: quick_filter, originalTarget: quick_filter_input }, document_of(three_pane)), true);
    const search_input = element("input");
    const global_search = element("global-search-bar", { shadowRoot: { activeElement: search_input } });
    assert.equal(is_typing({ target: global_search, originalTarget: search_input }, document_of(global_search)), true);
});

test("the thread list and the message body are not typing", () => {
    const body = element("body");
    const message_pane = element("browser", { contentDocument: { activeElement: null, body } });
    const message_browser = element("browser", { contentDocument: { activeElement: message_pane } });
    const three_pane = element("browser", { contentDocument: { activeElement: message_browser } });
    assert.equal(innermost_focus(document_of(three_pane)), body);
    assert.equal(is_typing({ target: body }, document_of(three_pane)), false);
    assert.equal(is_typing({ target: element("tbody") }, document_of(element("tbody"))), false);
});

test("a browser whose document is out of reach is not typing", () => {
    const remote = element("browser", { contentDocument: null });
    assert.equal(innermost_focus(document_of(element("browser", { contentDocument: { activeElement: remote } }))), remote);
    assert.equal(is_typing({ target: element("div") }, document_of(remote)), false);
});

test("no focus at all is not typing", () => {
    assert.equal(is_typing({ target: element("div") }, document_of(null)), false);
});

test("focus in the message browser or the message pane is the reading pane", () => {
    const body = element("body");
    const message_pane = element("browser", { id: "messagepane", contentDocument: { activeElement: null, body } });
    const message_browser = element("browser", { id: "messageBrowser", contentDocument: { activeElement: message_pane } });
    const three_pane = element("browser", { contentDocument: { activeElement: message_browser } });
    assert.equal(in_reading_pane(document_of(three_pane)), true);
    const list = element("browser", { contentDocument: { activeElement: element("tbody", { id: "threadTree" }) } });
    assert.equal(in_reading_pane(document_of(list)), false);
    assert.equal(in_reading_pane(document_of(null)), false);
});
