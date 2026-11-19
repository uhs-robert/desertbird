import assert from "node:assert/strict";
import { test } from "node:test";
import { create_widget_reader, position_label, status_widgets } from "../src/background/cmdline/status_widgets.ts";

test("the position counts from 1 over the rows the list shows", () => {
    assert.equal(position_label({ current: 0, count: 40 }), "[1/40]");
    assert.equal(position_label({ current: 39, count: 40 }), "[40/40]");
});

test("widgets follow the order of the setting and drop what is unknown", () => {
    const facts = { folder: "Inbox", place: { current: 1, count: 9 } };
    assert.deepEqual(status_widgets(["position", "folder"], facts), [{ kind: "position", text: "[2/9]" }, { kind: "folder", text: "Inbox" }]);
    assert.deepEqual(status_widgets(["folder", "position"], { place: { current: 1, count: 9 } }), [{ kind: "position", text: "[2/9]" }]);
    assert.deepEqual(status_widgets(["position"], { place: { current: -1, count: 9 } }), []);
    assert.deepEqual(status_widgets(["position"], { place: { current: 0, count: 0 } }), []);
    assert.deepEqual(status_widgets(["folder", "nonsense"], facts), [{ kind: "folder", text: "Inbox" }]);
    assert.deepEqual(status_widgets([], facts), []);
});

function reader_setup(names: string[], options: { tabs?: { displayedFolder?: { name?: string; path: string } | null }[]; experiment?: boolean } = {}) {
    const calls: string[] = [];
    const api = {
        mailTabs: { query: async () => (calls.push("mailTabs.query"), options.tabs ?? [{ displayedFolder: { name: "Inbox", path: "/INBOX" } }]) },
        ...(options.experiment !== false && {
            keys: { viewRows: async () => (calls.push("keys.viewRows"), { current: 4, rows: [] }) },
            folderpane: { viewRowCount: async () => (calls.push("folderpane.viewRowCount"), 20) },
        }),
    };
    return { calls, read: create_widget_reader(api, async () => names) };
}

test("the reader gives the folder text and the position of the mail list", async () => {
    const { read } = reader_setup(["folder", "position"]);
    assert.deepEqual(await read(3), [{ kind: "folder", text: "Inbox" }, { kind: "position", text: "[5/20]" }]);
});

test("the reader asks only for what the setting names", async () => {
    const folder_only = reader_setup(["folder"]);
    await folder_only.read(3);
    assert.deepEqual(folder_only.calls, ["mailTabs.query"]);
    const position_only = reader_setup(["position"]);
    await position_only.read(3);
    assert.deepEqual(position_only.calls.sort(), ["folderpane.viewRowCount", "keys.viewRows", "mailTabs.query"]);
    const none = reader_setup([]);
    assert.deepEqual(await none.read(3), []);
    assert.deepEqual(none.calls, []);
});

test("outside the mail list the widgets drop and the line still opens", async () => {
    assert.deepEqual(await reader_setup(["folder", "position"], { tabs: [] }).read(3), []);
    assert.deepEqual(await reader_setup(["folder"], { tabs: [{ displayedFolder: null }] }).read(3), []);
    assert.deepEqual(await reader_setup(["folder", "position"], { tabs: [{ displayedFolder: null }] }).read(3), [{ kind: "position", text: "[5/20]" }]);
    assert.deepEqual(await reader_setup(["folder", "position"], { experiment: false }).read(3), [{ kind: "folder", text: "Inbox" }]);
});

test("a virtual or unified folder shows the text Thunderbird gives, and a missing name falls back to the path", async () => {
    assert.deepEqual(await reader_setup(["folder"], { tabs: [{ displayedFolder: { name: "Unified Inbox", path: "/" } }] }).read(3), [{ kind: "folder", text: "Unified Inbox" }]);
    assert.deepEqual(await reader_setup(["folder"], { tabs: [{ displayedFolder: { path: "/Archive" } }] }).read(3), [{ kind: "folder", text: "/Archive" }]);
});
