import assert from "node:assert/strict";
import { test } from "node:test";
import { collect_targets } from "../src/chrome/hint_targets.ts";
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

// A window whose document answers each selector with the elements listed for it. Every shown element counts as the one on top at its centre.
function fake_window(by_selector: Record<string, FakeElement[]>) {
    const decorate = (each: FakeElement) => {
        each.log = [];
        return Object.assign(each, {
            getBoundingClientRect: () => (each.shown === false ? { top: 0, left: 0, width: 0, height: 0 } : { top: 10, left: 10, width: 20, height: 10 }),
            contains: () => true,
            focus: () => each.log!.push("focus"),
            click: () => each.log!.push("click"),
            matches: (selector: string) => selector === each.name.split(" ")[0],
            querySelector: (selector: string) => each.parts?.[selector] ?? null,
            closest: (selector: string) => (selector === "tabs" ? tabs : selector === "#folderTree, tbody" && each.inside_row ? each : null),
        });
    };
    return {
        innerHeight: 600,
        innerWidth: 800,
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
        document: { querySelectorAll: (selector: string) => (by_selector[selector] ?? []).map(decorate), elementFromPoint: () => null },
    };
}

function fixture() {
    const folder_row = { name: "li" };
    const log: string[] = [];
    const pane = {
        ...fake_window({
            [CONTROLS]: [{ name: "button pane" }, { name: "button row", inside_row: true }],
            "#folderTree li:not(.unselectable) > .container": [{ name: "container folder", parentElement: folder_row, textContent: " Inbox 3 ", parts: { ".name": { name: "name", textContent: " Inbox " } } }],
            "#threadTree tbody tr": [{ name: "tr thread", index: 4, textContent: "9:41 Hello", parts: { ".subject-line": { name: "subject", textContent: " Hello there " } } }],
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
