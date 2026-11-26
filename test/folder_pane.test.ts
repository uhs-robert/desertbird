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

function window_with(tree: unknown, folder_focused: boolean, view?: { rowCount: number; getMsgHdrAt?: (index: number) => { flags: number } | null }) {
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
    const api = get_folderpane_api({ extension: { windowManager: { getWrapper: (window: unknown) => ({ id: ids.get(window)! }) }, messageManager: { convert: (header: { id?: number }) => (header.id === undefined ? null : { id: header.id }) } } } as never);
    return { fold: api.folderpane.fold, focused: api.folderpane.focused, viewRowCount: api.folderpane.viewRowCount, viewFindRow: api.folderpane.viewFindRow, restore: platform.restore };
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

// Row flags as Thunderbird keeps them: 0x1 read, 0x4 starred, 0x10000000 attachment. `null` stands for a row with no header. The message id of a header is its index, so the answer shows which header was converted.
function flag_view(flags: (number | null)[]) {
    const view = { rows: flags, get rowCount() { return view.rows.length; }, getMsgHdrAt: (index: number) => { const word = view.rows[index]; return word === null || word === undefined ? null : { flags: word, id: index }; } };
    return view;
}

test("viewFindRow finds a flagged row far ahead in one call, and answers -1 when none is ahead", async () => {
    const fake = folder_tree(SHAPE);
    const flags: (number | null)[] = Array.from({ length: 10000 }, () => 0x1);
    flags[9000] = 0x1 | 0x4;
    flags[9500] = 0;
    const view = flag_view(flags);
    const { viewFindRow, restore } = api_for(new Map([[1, window_with(fake.tree, false, view)]]));
    assert.deepEqual(await viewFindRow({ windowId: 1, from: 5, forward: true, flag: "flagged", wanted: 1 }), { index: 9000, id: 9000 });
    assert.deepEqual(await viewFindRow({ windowId: 1, from: 5, forward: true, flag: "unread", wanted: 1 }), { index: 9500, id: 9500 });
    assert.deepEqual(await viewFindRow({ windowId: 1, from: 9501, forward: true, flag: "unread", wanted: 1 }), { index: -1, id: null });
    assert.deepEqual(await viewFindRow({ windowId: 1, from: 8999, forward: false, flag: "flagged", wanted: 1 }), { index: -1, id: null });
    assert.deepEqual(await viewFindRow({ windowId: 1, from: 5, forward: true, flag: "attachment", wanted: 1 }), { index: -1, id: null });
    restore();
});

test("viewFindRow counts matches, stops at the last one found, skips group rows and starts back from the last row", async () => {
    const fake = folder_tree(SHAPE);
    const view = flag_view([0, null, 0x1, 0, 0x10000000 | 0x1, 0]);
    const { viewFindRow, restore } = api_for(new Map([[1, window_with(fake.tree, false, view)], [2, window_with(fake.tree, false)]]));
    const index_of = async (search: { from: number; forward: boolean; flag: "unread" | "flagged" | "attachment"; wanted: number }, window_id = 1) => (await viewFindRow({ windowId: window_id, ...search })).index;
    assert.equal(await index_of({ from: 0, forward: true, flag: "unread", wanted: 2 }), 3);
    assert.equal(await index_of({ from: 0, forward: true, flag: "unread", wanted: 9 }), 5);
    assert.equal(await index_of({ from: 0, forward: true, flag: "attachment", wanted: 1 }), 4);
    // The list shrank after the caller counted it: a `from` past the end starts at the last row.
    assert.equal(await index_of({ from: 40, forward: false, flag: "unread", wanted: 1 }), 5);
    // Back with a count passes the group row and stops at the last match before row 0.
    assert.equal(await index_of({ from: 5, forward: false, flag: "unread", wanted: 2 }), 3);
    assert.equal(await index_of({ from: 4, forward: false, flag: "unread", wanted: 5 }), 0);
    assert.equal(await index_of({ from: -1, forward: true, flag: "unread", wanted: 1 }), -1);
    assert.equal(await index_of({ from: 0, forward: true, flag: "unread", wanted: 1 }, 2), -1);
    restore();
});

// A local folder and the services indexFolder reaches through ChromeUtils. `reparse` is what getDatabaseWithReparse does: return at once (a valid summary) or throw (a parse started or runs).
function index_env(options: { local: boolean; reparse: "valid" | "starts" }) {
    const platform = stub_platform();
    const globals = globalThis as Record<string, any>;
    class LocalFolder {
        URI = "mailbox://nobody@Local%20Folders/Receipts";
        reparses = 0;
        getDatabaseWithReparse() {
            this.reparses++;
            if (options.reparse === "starts") throw new Error("NS_ERROR_NOT_INITIALIZED");
            return {};
        }
    }
    // An IMAP folder is no nsIMsgLocalMailFolder, so it has no `getDatabaseWithReparse`.
    class ImapFolder {
        URI = "imap://nobody@host/Receipts";
    }
    const folder = options.local ? new LocalFolder() : new ImapFolder();
    const listeners = new Set<{ onFolderEvent(folder: unknown, event: string): void }>();
    const timers = new Map<number, () => void>();
    let next_timer = 1;
    const modules: Record<string, unknown> = {
        "resource:///modules/ExtensionAccounts.sys.mjs": { getFolder: (id: string) => (id === "f1" ? { folder } : assert.fail(`unknown folder ${id}`)) },
        "resource:///modules/MailServices.sys.mjs": { MailServices: { mailSession: { AddFolderListener: (listener: never) => void listeners.add(listener), RemoveFolderListener: (listener: never) => void listeners.delete(listener) } } },
        "resource://gre/modules/Timer.sys.mjs": { setTimeout: (run: () => void) => (timers.set(next_timer, run), next_timer++) },
    };
    const base = globals["ChromeUtils"].importESModule;
    globals["ChromeUtils"].importESModule = (url: string) => modules[url] ?? base(url);
    globals["Ci"].nsIMsgLocalMailFolder = LocalFolder;
    globals["Ci"].nsIFolderListener = { event: 1 };
    const api = get_folderpane_api({ extension: {} } as never);
    return {
        index: api.folderpane.indexFolder,
        folder,
        listeners,
        timers,
        says: (event: string, from = folder) => listeners.forEach((listener) => listener.onFolderEvent(from, event)),
        restore: platform.restore,
    };
}

test("indexFolder answers true at once for a folder whose summary is valid, leaves no listener, and its late timer does nothing", async () => {
    const env = index_env({ local: true, reparse: "valid" });
    assert.equal(await env.index({ folderId: "f1" }), true);
    assert.equal(env.listeners.size, 0);
    [...env.timers.values()].forEach((run) => run());
    assert.equal(env.listeners.size, 0);
    env.restore();
});

test("indexFolder waits for FolderLoaded of its own folder after a parse starts, then answers true", async () => {
    const env = index_env({ local: true, reparse: "starts" });
    let answer: boolean | undefined;
    const pending = env.index({ folderId: "f1" }).then((loaded) => void (answer = loaded));
    assert.equal(env.listeners.size, 1, "the listener is on before the reparse call");
    env.says("FolderLoaded", {} as never);
    env.says("DeleteOrMoveMsgCompleted");
    await Promise.resolve();
    assert.equal(answer, undefined, "another folder, or another event, does not end the wait");
    env.says("FolderLoaded");
    await pending;
    assert.equal(answer, true);
    assert.equal((env.folder as { reparses: number }).reparses, 1);
    assert.equal(env.listeners.size, 0);
    env.restore();
});

test("indexFolder answers false at the timeout when FolderLoaded never fires, and removes its listener", async () => {
    const env = index_env({ local: true, reparse: "starts" });
    const pending = env.index({ folderId: "f1" });
    assert.equal(env.timers.size, 1);
    [...env.timers.values()][0]!();
    assert.equal(await pending, false);
    assert.equal(env.listeners.size, 0);
    env.says("FolderLoaded");
    env.restore();
});

test("indexFolder answers false for a folder that is not local, without a reparse or a listener", async () => {
    const env = index_env({ local: false, reparse: "valid" });
    assert.equal(await env.index({ folderId: "f1" }), false);
    assert.equal(env.listeners.size, 0);
    assert.equal(env.timers.size, 0);
    env.restore();
});

test("indexFolder carries the reason when the folder id is unknown", async () => {
    const env = index_env({ local: true, reparse: "valid" });
    await assert.rejects(env.index({ folderId: "nope" }), /^Error: folderpane.indexFolder: unknown folder nope/);
    env.restore();
});
