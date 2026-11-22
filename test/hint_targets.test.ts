import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { collect_message_targets, collect_page_targets, collect_targets, collect_window_targets } from "../src/chrome/hint_targets.ts";
import type { HintMailPane } from "../src/chrome/hint_targets.ts";

const CONTROLS = "button:not([disabled]), toolbarbutton:not([disabled]), tab, [role=button], input:not([type=hidden]):not([disabled])";

interface FakeElement {
    name: string;
    shown?: boolean;
    inside_row?: boolean;
    index?: number;
    parentElement?: unknown;
    log?: string[];
    href?: string;
    textContent?: string;
    parts?: Record<string, FakeElement>;
}

const tabs = { selectedItem: null as unknown };

// A window whose document answers each selector with the elements listed for it. A key `page` answers the selector of a page tab, which starts with the mail one. Every shown element counts as the one on top at its centre.
function fake_window(by_selector: Record<string, FakeElement[]>) {
    const decorate = (each: FakeElement) => {
        each.log = [];
        return Object.assign(each, {
            getBoundingClientRect: () => (each.shown === false ? { top: 0, left: 0, width: 0, height: 0 } : { top: 10, left: 10, width: 20, height: 10 }),
            contains: () => true,
            focus: () => each.log!.push("focus"),
            click: () => each.log!.push("click"),
            matches: (selector: string) => selector.startsWith(`${CONTROLS}, `) || selector.replace(/:not\([^)]*\)/g, "").split(", ").includes(each.name.split(" ")[0]!),
            querySelector: (selector: string) => each.parts?.[selector] ?? null,
            closest: (selector: string) => (selector === "tabs" ? tabs : selector === "#folderTree, tbody" && each.inside_row ? each : null),
        });
    };
    return {
        innerHeight: 600,
        innerWidth: 800,
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
        document: { querySelectorAll: (selector: string) => (by_selector[selector] ?? (selector.startsWith(`${CONTROLS}, `) || selector === "*" ? by_selector["page"] : undefined) ?? []).map(decorate), elementFromPoint: () => null },
    };
}

function fixture() {
    const folder_row = { name: "li" };
    const log: string[] = [];
    const pane = {
        ...fake_window({
            [CONTROLS]: [{ name: "button pane" }, { name: "button row", inside_row: true }],
            "#folderTree li:not(.unselectable) > .container": [{ name: "container folder", parentElement: folder_row, textContent: " Inbox 3 ", parts: { ".name": { name: "name", textContent: " Inbox " } } }],
            "#threadTree tbody tr": [{ name: "tr thread", index: 4, textContent: "9:41 Hello", parts: { ".subject-line, .subject": { name: "subject", textContent: " Hello there " } } }],
        }),
        folderTree: { rowCount: 3, selectedIndex: 0, getRowAtIndex: (index: number) => (index === 2 ? folder_row : {}), focus: () => log.push("folder focus") },
        threadTree: { selectedIndex: 0, table: { body: { focus: () => log.push("list focus") } } },
        messageBrowser: { contentWindow: fake_window({ [CONTROLS]: [{ name: "button message" }] }) },
    };
    const main = fake_window({ [CONTROLS]: [{ name: "button main", textContent: " Write " }, { name: "button hidden", shown: false }, { name: "input field" }, { name: "tab strip", textContent: "Mail" }] });
    return { pane, main, log, targets: collect_targets(main as never, pane as unknown as HintMailPane) };
}

const name_of = (target: { element: unknown }): string => (target.element as FakeElement).name;

test("targets come in screen order, a row gets one label and its inner buttons none, and a hidden element none", () => {
    assert.deepEqual(fixture().targets.map(name_of), ["button main", "input field", "tab strip", "container folder", "tr thread", "button pane", "button message"]);
});

test("a pick acts by kind: click a button, focus a field, select a tab, select a thread row, open a folder row", () => {
    const { targets, pane, log } = fixture();
    const by_name = (name: string) => targets.find((target) => name_of(target) === name)!;
    for (const name of ["button main", "input field"]) by_name(name).act();
    assert.deepEqual([(by_name("button main").element as unknown as FakeElement).log, (by_name("input field").element as unknown as FakeElement).log], [["click"], ["focus"]]);
    by_name("tab strip").act();
    assert.equal(tabs.selectedItem, by_name("tab strip").element);
    by_name("tr thread").act();
    assert.equal(pane.threadTree.selectedIndex, 4);
    by_name("container folder").act();
    assert.equal(pane.folderTree.selectedIndex, 2, "the index of the row, which opens the folder");
    assert.deepEqual(log, ["list focus", "folder focus"], "the focus stays in the list that was picked from");
});

test("a mail tab that shows no message draws no label in the message document", () => {
    const { pane, main } = fixture();
    pane.messageBrowser.contentWindow = null as never;
    assert.equal(collect_targets(main as never, pane as unknown as HintMailPane).some((target) => name_of(target) === "button message"), false);
});

test("a yank copies the link address, else the trimmed text, the folder name and the subject cell, and a target with no text gets none", () => {
    const { targets } = fixture();
    assert.deepEqual(targets.map((target) => [name_of(target), target.text]), [["button main", "Write"], ["input field", ""], ["tab strip", "Mail"], ["container folder", "Inbox"], ["tr thread", "Hello there"], ["button pane", ""], ["button message", ""]]);
});

test("a link target yanks its href over its text", () => {
    const { pane, main } = fixture();
    (pane.messageBrowser.contentWindow as { document: { querySelectorAll: (selector: string) => unknown[] } }).document.querySelectorAll = () => [{ name: "button link", href: "https://example.org/", textContent: "Click", getBoundingClientRect: () => ({ top: 10, left: 10, width: 20, height: 10 }), contains: () => true, focus() {}, click() {}, matches: () => false, closest: () => null }];
    const [link] = collect_targets(main as never, pane as unknown as HintMailPane).filter((target) => name_of(target) === "button link");
    assert.equal(link!.text, "https://example.org/");
});

test("the focus action focuses a control and selects a row like the pick does", () => {
    const { targets, pane, log } = fixture();
    const by_name = (name: string) => targets.find((target) => name_of(target) === name)!;
    by_name("button main").focus();
    assert.deepEqual((by_name("button main").element as unknown as FakeElement).log, ["focus"], "no click");
    by_name("tr thread").focus();
    assert.equal(pane.threadTree.selectedIndex, 4);
    by_name("container folder").focus();
    assert.equal(pane.folderTree.selectedIndex, 2);
    assert.deepEqual(log, ["list focus", "folder focus"]);
});

test("a thread row in card view yanks its subject from the card subject element", () => {
    const { pane, main } = fixture();
    const subject = { textContent: " Card subject " };
    const row = { name: "tr card", index: 1, getBoundingClientRect: () => ({ top: 10, left: 10, width: 20, height: 10 }), contains: () => true, focus() {}, click() {}, matches: () => false, closest: () => null, querySelector: (selector: string) => (selector.split(", ").includes(".subject") ? subject : null) };
    const document = pane.document as unknown as { querySelectorAll: (selector: string) => unknown[] };
    const original = document.querySelectorAll;
    document.querySelectorAll = (selector) => (selector === "#threadTree tbody tr" ? [row] : original(selector));
    const card = collect_targets(main as never, pane as unknown as HintMailPane).find((target) => name_of(target) === "tr card");
    assert.equal(card?.text, "Card subject");
});

test("a page tab labels the controls of the window and then of its page: a field takes the focus, a link and a check box a click", () => {
    const main = fake_window({ page: [{ name: "toolbarbutton spaces", textContent: " Mail " }, { name: "button hidden", shown: false }] });
    const page = fake_window({ page: [{ name: "a link", href: "about:support", textContent: "Support" }, { name: "textarea notes" }, { name: "checkbox option", textContent: " Wrap " }] });
    const targets = collect_page_targets(main as never, page as never);
    assert.deepEqual(targets.map((target) => [name_of(target), target.text, (target.window as unknown) === page]), [["toolbarbutton spaces", "Mail", false], ["a link", "about:support", true], ["textarea notes", "", true], ["checkbox option", "Wrap", true]]);
    for (const target of targets) target.act();
    assert.deepEqual(targets.map((target) => (target.element as unknown as FakeElement).log), [["click"], ["click"], ["focus"], ["click"]]);
    targets[1]!.focus();
    assert.deepEqual((targets[1]!.element as unknown as FakeElement).log, ["click", "focus"]);
});

test("a page tab with no page the parent can read labels the window alone", () => {
    const main = fake_window({ page: [{ name: "button today" }] });
    assert.deepEqual(collect_page_targets(main as never, null).map(name_of), ["button today"]);
});

// The real selectors against a real document: a web page writes `contenteditable` bare, `true` or `plaintext-only`.
test("every contenteditable but false gets a label, and a pick focuses it and does not click it", () => {
    const { window } = new JSDOM(`<div id="bare" contenteditable></div><div id="on" contenteditable="true"></div><div id="plain" contenteditable="plaintext-only"></div><div id="off" contenteditable="false"></div><button id="button">Go</button>`);
    const log: string[] = [];
    Object.assign(window.HTMLElement.prototype, {
        getBoundingClientRect: () => ({ top: 10, left: 10, width: 20, height: 10 }),
        contains: () => true,
        focus(this: { id: string }) { log.push(`focus ${this.id}`); },
        click(this: { id: string }) { log.push(`click ${this.id}`); },
    });
    const page = { innerHeight: 600, innerWidth: 800, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }), document: { querySelectorAll: (selector: string) => window.document.querySelectorAll(selector), elementFromPoint: () => null } };
    const targets = collect_window_targets(page as never);
    assert.deepEqual(targets.map((target) => (target.element as unknown as { id: string }).id), ["bare", "on", "plain", "button"]);
    for (const target of targets) target.act();
    assert.deepEqual(log, ["focus bare", "focus on", "focus plain", "click button"]);
    window.close();
});

// Real shadow roots in jsdom. jsdom has no layout, no hit test, no chrome-only `openOrClosedShadowRoot` and no `flattenedTreeParentNode`, so each is stood in for here. Every element gets a box of its own the first time it is measured, and the hit test answers from that box: the element itself, or the one `covered_by` names for it, retargeted to the scope of the document or the shadow root that is asked.
function shadow_page(html: string, covered_by: Record<string, string> = {}) {
    const { window } = new JSDOM(html);
    const document = window.document;
    const roots = new WeakMap<object, ShadowRoot>();
    const attach = window.Element.prototype.attachShadow;
    window.Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
        const root = attach.call(this, init);
        roots.set(this, root);
        (root as unknown as { elementFromPoint: unknown }).elementFromPoint = (_x: number, y: number) => retarget(at_height(y), root);
        return root;
    };
    Object.defineProperty(window.Element.prototype, "openOrClosedShadowRoot", { get(this: Element) { return roots.get(this) ?? null; } });
    Object.defineProperty(window.Node.prototype, "flattenedTreeParentNode", { get(this: Element & { host?: Node }) { return this.assignedSlot ?? this.parentNode ?? this.host ?? null; } });
    const tops = new Map<Element, number>();
    Object.assign(window.HTMLElement.prototype, {
        getBoundingClientRect(this: Element) {
            if (!tops.has(this)) tops.set(this, 10 + 30 * tops.size);
            return { top: tops.get(this)!, left: 10, width: 20, height: 10 };
        },
    });
    const log: string[] = [];
    Object.assign(window.HTMLElement.prototype, { click(this: { id: string }) { log.push(`click ${this.id}`); }, focus(this: { id: string }) { log.push(`focus ${this.id}`); } });
    const by_id = (id: string): Element | null => {
        const search = (scope: ParentNode): Element | null => {
            for (const element of scope.querySelectorAll("*")) {
                if (element.id === id) return element;
                const inner = roots.get(element) && search(roots.get(element)!);
                if (inner) return inner;
            }
            return null;
        };
        return search(document);
    };
    // The element under a point is the one measured at that height, or its cover.
    const at_height = (y: number): Element | null => {
        const [element] = [...tops].find(([, top]) => top + 5 === y) ?? [null];
        const cover = element && covered_by[element.id];
        return (cover && by_id(cover)) || element;
    };
    // What a scope can see of an element: itself, or the host of the shadow root that holds it, up to the scope.
    const retarget = (element: Element | null, scope: Document | ShadowRoot): Element | null => {
        let at = element;
        while (at && at.getRootNode() !== scope) at = (at.getRootNode() as ShadowRoot).host ?? null;
        return at;
    };
    document.elementFromPoint = (_x: number, y: number) => retarget(at_height(y), document);
    const page = { innerHeight: 600, innerWidth: 800, getComputedStyle: (element: Element) => ({ display: element.id === "hidden" ? "none" : "block", visibility: "visible", opacity: "1" }), document };
    const root_of = (id: string, markup: string, mode: "open" | "closed" = "open") => {
        const shadow = document.getElementById(id)!.attachShadow({ mode });
        shadow.innerHTML = markup;
        return shadow;
    };
    return { window, page, log, root_of, ids: () => collect_window_targets(page as never).map((target) => (target.element as unknown as Element).id), pick: (id: string) => collect_window_targets(page as never).find((target) => (target.element as unknown as Element).id === id)!.act() };
}

const SHADOW_HTML = `<button id="light">Light</button><div id="host"></div><div id="outer"></div><div id="field_host"></div><div id="slot_host"><span id="label">Label</span></div><div id="overlay"></div>`;

test("a button in an open or a closed shadow root gets a label, in document order, and a hidden one none", () => {
    const { ids, root_of } = shadow_page(SHADOW_HTML);
    root_of("host", `<button id="inner">In</button><button id="hidden">Hidden</button>`);
    const outer = root_of("outer", `<div id="nested"></div><button id="after">After</button>`, "closed");
    outer.getElementById("nested")!.attachShadow({ mode: "closed" }).innerHTML = `<button id="deep">Deep</button>`;
    assert.deepEqual(ids(), ["light", "inner", "deep", "after"]);
});

test("a pick on a shadow button clicks that button", () => {
    const { pick, log, root_of } = shadow_page(SHADOW_HTML);
    root_of("host", `<button id="inner">In</button>`);
    pick("inner");
    assert.deepEqual(log, ["click inner"]);
});

test("a host whose shadow root holds the field gets no label of its own, so the field has one", () => {
    const { ids, root_of } = shadow_page(`<search-textbox id="field_host"></search-textbox>`);
    root_of("field_host", `<input id="field">`);
    assert.deepEqual(ids(), ["field"]);
});

test("a button inside a slot sits under its own light child: the hit on the child counts as the button", () => {
    const { ids, root_of, window } = shadow_page(SHADOW_HTML, { slot_btn: "label" });
    root_of("slot_host", `<button id="slot_btn"><slot></slot></button>`);
    assert.deepEqual(ids(), ["light", "slot_btn"]);
    assert.equal(window.document.getElementById("label")!.assignedSlot?.parentElement?.id, "slot_btn");
});

test("an overlay outside the host covers a shadow button, and a hit on another shadow element does too", () => {
    const { ids, root_of } = shadow_page(SHADOW_HTML, { inner: "overlay", other: "inner" });
    root_of("host", `<button id="inner">In</button><button id="other">Other</button>`);
    assert.deepEqual(ids(), ["light"]);
});

test("the mail tab keeps its flat scan and labels no shadow button", () => {
    const { page, root_of } = shadow_page(SHADOW_HTML);
    root_of("host", `<button id="inner">In</button>`);
    const empty = new JSDOM("").window;
    const pane = { ...fake_window({}), document: empty.document, folderTree: {}, threadTree: {}, messageBrowser: { contentWindow: null } };
    const targets = collect_targets(page as never, pane as unknown as HintMailPane);
    assert.deepEqual(targets.map((target) => (target.element as unknown as Element).id), ["light"]);
    empty.close();
});

test("a host that is a field keeps its label next to its shadow button, and a search-textbox host does not", () => {
    const { ids, root_of } = shadow_page(`<div id="field_host" contenteditable></div><search-textbox id="search"></search-textbox>`);
    root_of("field_host", `<button id="calendar">Calendar</button>`);
    root_of("search", `<input id="search_input">`);
    assert.deepEqual(ids(), ["field_host", "calendar", "search_input"]);
});

test("a visible host whose shadow targets are all hidden keeps its label", () => {
    const { ids, root_of } = shadow_page(`<div id="host" role="button"></div>`);
    root_of("host", `<button id="hidden">Hidden</button>`);
    assert.deepEqual(ids(), ["host"]);
});

test("a shadow target with no text of its own yanks the text of its host, which a slot carries", () => {
    const { page, root_of } = shadow_page(`<div id="slot_host"><span id="label">  Themes </span></div>`, { slot_btn: "label" });
    root_of("slot_host", `<button id="slot_btn"><slot></slot></button>`);
    const [target] = collect_window_targets(page as never);
    assert.equal((target!.element as unknown as Element).id, "slot_btn");
    assert.equal(target!.text, "Themes");
});

test("a shadow root that answers a hit with its own host ends the descent", () => {
    const { ids, root_of, window } = shadow_page(`<div id="host"></div>`);
    const root = root_of("host", `<button id="inner">In</button>`);
    (root as unknown as { elementFromPoint: unknown }).elementFromPoint = () => window.document.getElementById("host");
    assert.deepEqual(ids(), []);
});

test("a check box or a radio button is clicked by a pick, and a text field still takes the focus", () => {
    const { page, log } = shadow_page(`<input id="check" type="checkbox"><input id="radio" type="radio"><input id="text">`);
    for (const target of collect_window_targets(page as never)) target.act();
    assert.deepEqual(log, ["click check", "click radio", "focus text"]);
});

// The header of about:message as the probe listed it (docs/thunderbird-behavior.md, "Message header controls"), cut to one of each kind.
const HEADER_HTML = `<toolbarbutton id="reply"></toolbarbutton>
<toolbarbutton id="reply_all" is="toolbarbutton-menu-button" type="menu"><toolbarbutton id="reply_all_main" class="toolbarbutton-menubutton-button"></toolbarbutton></toolbarbutton>
<toolbarbutton id="more" type="menu"></toolbarbutton>
<button id="star" role="checkbox"></button>
<ul><li id="from" class="header-recipient">Fixture Sender<button id="address_book"></button></li></ul>
<ul><li id="tag" class="tag" tabindex="0">Important</li></ul>
<input id="dark" type="checkbox">
<button id="hidden"></button>
<richlistbox id="attachmentList"><richlistitem id="item">note.txt</richlistitem></richlistbox>`;

function message_fixture() {
    const message = shadow_page(HEADER_HTML);
    const body = shadow_page(`<p>Text <a id="link" href="https://example.org/one">a link</a></p><button id="body_button">Go</button><input id="body_field">`);
    const item = message.window.document.getElementById("item")!;
    Object.assign(message.window.document.getElementById("from")!, { emailAddress: "sender@example.org" });
    Object.defineProperty(item, "control", { value: { selectItem: (picked: Element) => message.log.push(`select ${picked.id}`), focus: () => message.log.push("focus list") } });
    let opened = 0;
    const targets = collect_message_targets(message.page as never, body.page as never, () => opened++);
    const by_id = (id: string) => targets.find((target) => (target.element as unknown as Element).id === id)!;
    return { message, body, targets, by_id, opened: () => opened };
}

test("a message labels its header first and then the body, with one label per pill and per split button, and none for a hidden control", () => {
    const { targets, message, body } = message_fixture();
    assert.deepEqual(targets.map((target) => [(target.element as unknown as Element).id, (target.window as unknown) === message.page ? "header" : "body"]), [
        ["reply", "header"], ["reply_all_main", "header"], ["more", "header"], ["star", "header"], ["from", "header"], ["tag", "header"], ["dark", "header"], ["item", "header"],
        ["link", "body"], ["body_button", "body"], ["body_field", "body"],
    ]);
    message.window.close();
    body.window.close();
});

test("a header pick clicks a control, a split button's main part and the dark switch, focuses a tag, and selects an attachment in its focused list", () => {
    const { by_id, message } = message_fixture();
    for (const id of ["reply", "reply_all_main", "more", "star", "from", "tag", "dark", "item"]) by_id(id).act();
    assert.deepEqual(message.log, ["click reply", "click reply_all_main", "click more", "click star", "click from", "focus tag", "click dark", "select item", "focus list"]);
    message.log.length = 0;
    by_id("item").focus();
    by_id("star").focus();
    assert.deepEqual(message.log, ["select item", "focus list", "focus star"], "the focus action on an attachment is its pick too");
    message.window.close();
});

test("a body pick focuses its target and asks for the Enter only on a link or a button, and a yank copies the address of a link or a pill, else the text", () => {
    const { by_id, body, opened } = message_fixture();
    for (const id of ["link", "body_button", "body_field"]) by_id(id).act();
    assert.deepEqual(body.log, ["focus link", "focus body_button", "focus body_field"], "no script click: Thunderbird's link check needs the real Enter");
    assert.equal(opened(), 2);
    by_id("link").focus();
    assert.equal(opened(), 2, "the focus action opens nothing");
    assert.deepEqual(["link", "from", "tag", "reply"].map((id) => by_id(id).text), ["https://example.org/one", "sender@example.org", "Important", ""]);
    body.window.close();
});
