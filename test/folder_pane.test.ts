import assert from "node:assert/strict";
import { test } from "node:test";
import { get_folderpane_api } from "../src/chrome/parent_folderpane.ts";
import { stub_platform } from "./chrome_stubs.ts";

interface FakeRow {
    name: string;
    children: FakeRow[];
    collapsed: boolean;
    unselectable: boolean;
    parent: FakeRow | null;
    classList: { contains(name: string): boolean };
    parentNode: { closest(selector: string): FakeRow | null };
}

// A folder tree given as nested [name, children] pairs, all open, inside the invisible wrapper row that Thunderbird puts around the accounts. The wrapper is no visible row, and closing it hides every row. A row is visible when no ancestor is closed.
function folder_tree(shape: [string, unknown[]][]) {
    const all: FakeRow[] = [];
    const build = (entries: [string, unknown[]][], parent: FakeRow | null, unselectable = false): FakeRow[] =>
        entries.map(([name, kids]) => {
            const row: FakeRow = {
                name,
                children: [],
                collapsed: false,
                unselectable,
                parent,
                classList: { contains: (cls) => (cls === "children" ? row.children.length > 0 : cls === "collapsed" ? row.collapsed : cls === "unselectable" && row.unselectable) },
                // `closest` here honors the two selectors the code uses: the nearest ancestor that is not the wrapper, and the nearest closed ancestor.
                parentNode: {
                    closest(selector: string) {
                        for (let up = row.parent; up; up = up.parent) if (selector.includes(".collapsed") ? up.collapsed : !(selector.includes(":not(.unselectable)") && up.unselectable)) return up;
                        return null;
                    },
                },
            };
            all.push(row);
            row.children = build(kids as [string, unknown[]][], row);
            return row;
        });
    const wrapper = build([["wrapper", shape]], null, true)[0]!;
    const real = () => all.filter((row) => row !== wrapper);
    const visible = () => real().filter((row) => { for (let up = row.parent; up; up = up.parent) if (up.collapsed) return false; return true; });
    let selected: FakeRow = real()[0]!;
    const tree = {
        get rowCount() { return visible().length; },
        get selectedIndex() { return visible().indexOf(selected); },
        set selectedIndex(index: number) { selected = visible()[index]!; },
        get selectedRow() { return selected; },
        getRowAtIndex: (index: number) => visible()[index],
        querySelectorAll: (selector: string) => all.filter((row) => row.children.length > 0 && !(selector.includes(":not(.unselectable)") && row.unselectable) && (selector.includes(":not(.collapsed)") ? !row.collapsed : row.collapsed)),
        expandRow(row: FakeRow) { row.collapsed = false; },
        collapseRow(row: FakeRow) {
            row.collapsed = true;
            if (!visible().includes(selected)) selected = row;
        },
    };
    return { tree, wrapper, row: (name: string) => all.find((candidate) => candidate.name === name)!, select: (name: string) => void (selected = all.find((candidate) => candidate.name === name)!), selected: () => selected.name, open_state: () => real().map((row) => `${row.name}${row.collapsed ? "+" : ""}`).join(" ") };
}

function window_with(tree: unknown, folder_focused: boolean, view?: { rowCount: number }) {
    const about_3pane = { folderTree: tree, gDBView: view, browsingContext: { topChromeWindow: {} as unknown } };
    const document = {
        activeElement: { localName: "browser", contentDocument: { activeElement: folder_focused ? { id: "folderTree" } : { localName: "tbody" } } },
        getElementById: () => ({ currentTabInfo: { mode: { name: "mail3PaneTab" }, chromeBrowser: { contentWindow: about_3pane } } }),
        hasFocus: () => true,
    };
    about_3pane.browsingContext.topChromeWindow = { document };
    return { document, addEventListener() {}, removeEventListener() {} };
}

function api_for(windows: Map<number, unknown>) {
    const platform = stub_platform([...windows.values()]);
    const ids = new Map([...windows].map(([id, window]) => [window, id]));
    const api = get_folderpane_api({ extension: { windowManager: { getWrapper: (window: unknown) => ({ id: ids.get(window)! }) }, messageManager: { convert: () => null } } } as never);
    return { fold: api.folderpane.fold, focused: api.folderpane.focused, viewRowCount: api.folderpane.viewRowCount, restore: platform.restore };
}

const SHAPE: [string, unknown[]][] = [["Account", [["Inbox", [["Work", []], ["Home", []]]], ["Sent", []]]], ["Local", [["Trash", []]]]];

test("extent all closes every folder and opens them all again, nested ones included", async () => {
    const fake = folder_tree(SHAPE);
    fake.row("Inbox").collapsed = true;
    const { fold, restore } = api_for(new Map([[1, window_with(fake.tree, true)]]));
    assert.equal(await fold({ windowId: 1, open: false, extent: "all" }), true);
    assert.equal(fake.open_state(), "Account+ Inbox+ Work Home Sent Local+ Trash");
    assert.equal(await fold({ windowId: 1, open: true, extent: "all" }), true);
    assert.equal(fake.open_state(), "Account Inbox Work Home Sent Local Trash");
    restore();
});

test("extent parent closes an open folder, and on a child closes the parent and selects it", async () => {
    const fake = folder_tree(SHAPE);
    const { fold, restore } = api_for(new Map([[1, window_with(fake.tree, true)]]));
    fake.select("Inbox");
    await fold({ windowId: 1, open: false, extent: "parent" });
    assert.equal(fake.open_state(), "Account Inbox+ Work Home Sent Local Trash");
    assert.equal(fake.selected(), "Inbox");
    fake.row("Inbox").collapsed = false;
    fake.select("Home");
    await fold({ windowId: 1, open: false, extent: "parent" });
    assert.equal(fake.open_state(), "Account Inbox+ Work Home Sent Local Trash");
    assert.equal(fake.selected(), "Inbox");
    restore();
});

test("extent parent on a top-level leaf or a closed top-level folder does nothing", async () => {
    const fake = folder_tree([["Only", []]]);
    const { fold, restore } = api_for(new Map([[1, window_with(fake.tree, true)]]));
    assert.equal(await fold({ windowId: 1, open: false, extent: "parent" }), true);
    assert.equal(fake.selected(), "Only");
    restore();
});

test("extent row opens and closes the selected folder only", async () => {
    const fake = folder_tree(SHAPE);
    const { fold, restore } = api_for(new Map([[1, window_with(fake.tree, true)]]));
    fake.select("Inbox");
    await fold({ windowId: 1, open: false, extent: "row" });
    assert.equal(fake.open_state(), "Account Inbox+ Work Home Sent Local Trash");
    await fold({ windowId: 1, open: true, extent: "row" });
    assert.equal(fake.open_state(), "Account Inbox Work Home Sent Local Trash");
    restore();
});

test("outside the folder pane every extent answers false and changes nothing", async () => {
    const fake = folder_tree(SHAPE);
    const { fold, restore } = api_for(new Map([[1, window_with(fake.tree, false)]]));
    for (const extent of ["row", "all", "parent"] as const) assert.equal(await fold({ windowId: 1, open: false, extent }), false, extent);
    assert.equal(fake.open_state(), "Account Inbox Work Home Sent Local Trash");
    restore();
});

test("a call acts on the window it names, so a second window keeps its own tree", async () => {
    const first = folder_tree(SHAPE);
    const second = folder_tree(SHAPE);
    const { fold, restore } = api_for(new Map([[1, window_with(first.tree, true)], [2, window_with(second.tree, true)]]));
    await fold({ windowId: 2, open: false, extent: "all" });
    assert.equal(first.open_state(), "Account Inbox Work Home Sent Local Trash");
    assert.equal(second.open_state(), "Account+ Inbox+ Work Home Sent Local+ Trash");
    restore();
});

test("z M and H on an account leave the wrapper row open, or every row would vanish", async () => {
    const fake = folder_tree(SHAPE);
    const { fold, restore } = api_for(new Map([[1, window_with(fake.tree, true)]]));
    await fold({ windowId: 1, open: false, extent: "all" });
    assert.equal(fake.wrapper.collapsed, false);
    fake.row("Account").collapsed = false;
    fake.select("Local");
    fake.row("Local").collapsed = true;
    await fold({ windowId: 1, open: false, extent: "parent" });
    assert.equal(fake.wrapper.collapsed, false);
    assert.equal(fake.selected(), "Local");
    restore();
});

test("z M leaves an open subfolder inside a closed parent alone", async () => {
    const fake = folder_tree([["Account", [["Inbox", [["Work", [["Deep", []]]]]]]], ["Local", [["Trash", []]]]]);
    const { fold, restore } = api_for(new Map([[1, window_with(fake.tree, true)]]));
    fake.row("Inbox").collapsed = true;
    const closed: string[] = [];
    const collapse = fake.tree.collapseRow;
    fake.tree.collapseRow = (row) => (closed.push(row.name), collapse(row));
    await fold({ windowId: 1, open: false, extent: "all" });
    assert.deepEqual(closed.sort(), ["Account", "Local"]);
    restore();
});

test("focused tells the folder pane from the other panes", async () => {
    const fake = folder_tree(SHAPE);
    for (const folder_focused of [true, false]) {
        const { focused, restore } = api_for(new Map([[1, window_with(fake.tree, folder_focused)]]));
        assert.equal(await focused({ windowId: 1 }), folder_focused);
        restore();
    }
});

test("viewRowCount answers the rows the message list shows, and 0 while it has no view", async () => {
    const fake = folder_tree(SHAPE);
    const view = { rowCount: 12 };
    const { viewRowCount, restore } = api_for(new Map([[1, window_with(fake.tree, false, view)], [2, window_with(fake.tree, false)]]));
    assert.equal(await viewRowCount({ windowId: 1 }), 12);
    view.rowCount = 3;
    assert.equal(await viewRowCount({ windowId: 1 }), 3);
    assert.equal(await viewRowCount({ windowId: 2 }), 0);
    restore();
});
