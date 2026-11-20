import assert from "node:assert/strict";
import { test } from "node:test";
import { body_script_is_live, capture_focus, focused_pane, in_reading_pane, innermost_focus, is_typing, menu_is_open, menu_takes_key } from "../src/chrome/focus.ts";
import type { FocusNode } from "../src/chrome/focus.ts";
import { OVERLAY_BROWSER_ID, OVERLAY_LOADING_ID } from "../src/chrome/overlay_id.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE } from "../src/shared/protocol.ts";

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

test("a menu open in the window or in a document on the way to the focus counts, a closed one does not", () => {
    const popups = (...states: string[]) => () => states.map((state) => ({ state }));
    const list = element("tbody");
    const three_pane = (states: string[]) => element("browser", { contentDocument: { activeElement: list, querySelectorAll: popups(...states) } });
    // Measured: the thread list's context menu is a menupopup in about:3pane with state "open" and no `open` attribute.
    assert.equal(menu_is_open({ activeElement: three_pane(["closed", "open"]), querySelectorAll: popups("closed") }), true);
    assert.equal(menu_is_open({ activeElement: three_pane(["closed"]), querySelectorAll: popups("showing") }), true);
    assert.equal(menu_is_open({ activeElement: three_pane(["closed"]), querySelectorAll: popups("closed", "hiding") }), false);
    assert.equal(menu_is_open(document_of(null)), false);
});

test("a key while the overlay's browser has focus is typing, so no command runs from it", () => {
    // The browser is remote: its document is out of reach, so the chain ends at the element and only its id marks it.
    const overlay = element("browser", { id: OVERLAY_BROWSER_ID });
    assert.equal(is_typing({ target: overlay }, document_of(overlay)), true);
    assert.equal(is_typing({ target: element("div") }, document_of(overlay)), true);
});

test("the body script is live when the message body document under the focus carries the marker", () => {
    const body = element("body");
    const live_root = { hasAttribute: (name: string) => name === BODY_SCRIPT_LIVE_ATTRIBUTE };
    const pane_with = (root: { hasAttribute(name: string): boolean } | null) => {
        const message_pane = element("browser", { id: "messagepane", contentDocument: { activeElement: null, body, documentElement: root } });
        const message_browser = element("browser", { id: "messageBrowser", contentDocument: { activeElement: message_pane } });
        return document_of(element("browser", { contentDocument: { activeElement: message_browser } }));
    };
    assert.equal(body_script_is_live(pane_with(live_root)), true);
    assert.equal(body_script_is_live(pane_with({ hasAttribute: () => false })), false);
    assert.equal(body_script_is_live(pane_with(null)), false);
    assert.equal(body_script_is_live(document_of(null)), false);
});

test("focus in the message header is not in the body document, whose marker is then out of the chain", () => {
    const header = element("div", { id: "messageHeader" });
    const message_browser = element("browser", { id: "messageBrowser", contentDocument: { activeElement: header, documentElement: { hasAttribute: () => false } } });
    const three_pane = element("browser", { contentDocument: { activeElement: message_browser } });
    assert.equal(in_reading_pane(document_of(three_pane)), true);
    assert.equal(body_script_is_live(document_of(three_pane)), false);
});

test("focus inside a frame of the mail is not a live body: the body script does not see a key from a subframe, so the swallow stays", () => {
    const frame_field = element("body");
    const frame = element("iframe", { contentDocument: { activeElement: frame_field, documentElement: { hasAttribute: () => false } } });
    const mail_document = { activeElement: frame, body: element("body"), documentElement: { hasAttribute: (name: string) => name === BODY_SCRIPT_LIVE_ATTRIBUTE } };
    const message_pane = element("browser", { id: "messagepane", contentDocument: mail_document });
    const message_browser = element("browser", { id: "messageBrowser", contentDocument: { activeElement: message_pane } });
    const three_pane = element("browser", { contentDocument: { activeElement: message_browser } });
    assert.equal(in_reading_pane(document_of(three_pane)), true);
    assert.equal(body_script_is_live(document_of(three_pane)), false);
    mail_document.activeElement = element("a");
    assert.equal(body_script_is_live(document_of(three_pane)), true);
});

test("a key is not typing but is left alone when the focused message body runs the body script, and a frame in the mail keeps the swallow", () => {
    const frame = element("iframe", { contentDocument: { activeElement: element("body"), documentElement: { hasAttribute: () => false } } });
    const mail_document = { activeElement: element("a") as FocusNode | null, body: element("body"), documentElement: { hasAttribute: (name: string) => name === BODY_SCRIPT_LIVE_ATTRIBUTE } };
    const message_pane = element("browser", { id: "messagepane", contentDocument: mail_document });
    const three_pane = element("browser", { contentDocument: { activeElement: element("browser", { id: "messageBrowser", contentDocument: { activeElement: message_pane } }) } });
    assert.equal(is_typing({ target: element("a") }, document_of(three_pane)), true);
    mail_document.activeElement = frame;
    assert.equal(is_typing({ target: element("a") }, document_of(three_pane)), false);
});

test("capture_focus gives the focus back to the deepest element it saw, in a nested document", () => {
    const calls: string[] = [];
    const row = element("tbody", { isConnected: true, focus: () => void calls.push("row") } as Partial<FocusNode>);
    const three_pane = element("browser", { contentDocument: { activeElement: row } });
    assert.equal(capture_focus(document_of(three_pane))(), true);
    assert.deepEqual(calls, ["row"]);
});

test("capture_focus answers false when the element left the document, so the caller falls back to the thread list", () => {
    const row = element("tbody", { isConnected: false, focus: () => {} } as Partial<FocusNode>);
    assert.equal(capture_focus(document_of(row))(), false);
});

test("capture_focus answers false for no focus, the page body and the overlay's own browser", () => {
    assert.equal(capture_focus(document_of(null))(), false);
    const focus = () => {};
    assert.equal(capture_focus(document_of(element("body", { isConnected: true, focus } as Partial<FocusNode>)))(), false);
    assert.equal(capture_focus(document_of(element("browser", { id: OVERLAY_BROWSER_ID, isConnected: true, focus } as Partial<FocusNode>)))(), false);
});

test("an element of the mail with the id folderTree stays in the reading pane", () => {
    const mail_link = { localName: "a", id: "folderTree" };
    const body = { localName: "browser", id: "messagepane", contentDocument: { activeElement: mail_link } };
    const about_message = { localName: "browser", id: "messageBrowser", contentDocument: { activeElement: body } };
    const document = { activeElement: { localName: "browser", contentDocument: { activeElement: about_message } } };
    assert.equal(focused_pane(document), 2);
    assert.equal(focused_pane({ activeElement: { localName: "browser", contentDocument: { activeElement: { localName: "ul", id: "folderTree" } } } }), 0);
    assert.equal(focused_pane({ activeElement: { localName: "browser", contentDocument: { activeElement: { localName: "tbody" } } } }), 1);
});

test("the overlay's browser is a typing target by its final id and not by its loading id", () => {
    const browser = (id: string) => element("browser", { id });
    assert.equal(is_typing({ target: browser(OVERLAY_BROWSER_ID) }, document_of(null)), true);
    assert.equal(is_typing({ target: browser(OVERLAY_LOADING_ID) }, document_of(browser(OVERLAY_LOADING_ID))), false);
});

test("an open menupopup takes the access keys of its direct items, a panel takes keys only with the focus inside it", () => {
    const list = element("tbody");
    const item = (key: string, owner: () => unknown, attributes: string[] = []) => ({ getAttribute: () => key, hasAttribute: (name: string) => attributes.includes(name), closest: owner });
    const popup = (local_name: string, state: string, make_items: (self: object) => object[], contains: (node: unknown) => boolean = () => false) => {
        const self: Record<string, unknown> = { localName: local_name, state, contains };
        self.querySelectorAll = () => make_items(self);
        return self;
    };
    const doc = (...popups: object[]) => ({ activeElement: list, querySelectorAll: () => popups as never });
    const menu = popup("menupopup", "open", (self) => [item("K", () => self), item("h", () => self, ["hidden"]), item("s", () => ({}))]);
    assert.equal(menu_takes_key(doc(menu), "k"), true);
    assert.equal(menu_takes_key(doc(menu), "j"), false);
    // A hidden item and an item of a closed nested popup are not items of the open popup.
    assert.equal(menu_takes_key(doc(menu), "h"), false);
    assert.equal(menu_takes_key(doc(menu), "s"), false);
    assert.equal(menu_takes_key(doc(popup("menupopup", "closed", (self) => [item("k", () => self)])), "k"), null);
    assert.equal(menu_takes_key(doc(), "k"), null);
    // The app menu: its hidden panel views hold access keys, and none of them counts.
    const app_menu = popup("panel", "open", (self) => [item("n", () => self), item("a", () => ({}))]);
    for (const key of ["n", "a", "j"]) assert.equal(menu_takes_key(doc(app_menu), key), false, key);
    const focused_panel = popup("panel", "showing", () => [], (node) => node === list);
    assert.equal(menu_takes_key(doc(focused_panel), "j"), true);
    // A panel-list has no state and carries `open`.
    const panel_list = { localName: "panel-list", hasAttribute: (name: string) => name === "open", contains: (node: unknown) => node === list };
    assert.equal(menu_takes_key(doc(panel_list), "j"), true);
    assert.equal(menu_takes_key(doc({ ...panel_list, hasAttribute: () => false }), "j"), null);
});
