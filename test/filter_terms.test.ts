import assert from "node:assert/strict";
import { test } from "node:test";
import { filter_set_args, list_id_of, message_term } from "../src/background/handlers/filter_terms.ts";
import type { FilterTermsApi } from "../src/background/handlers/filter_terms.ts";
import { RuntimeRefusal } from "../vendor/desertfox/command.ts";

const DAY = new Date("2026-11-01T23:59:59-05:00");

function scope(headers: Record<number, Record<string, string[]>>, app?: FilterTermsApi["app"]) {
    const api: FilterTermsApi = { messages: { get: async (id) => ({ id, date: DAY }), getFull: async (id) => ({ headers: headers[id] ?? {} }) }, app };
    return { api, window_id: 3, message_ids: [], count: 1 };
}

test("list_id_of takes the bracketed id after any phrase, in any header case, even after a phrase with brackets, and nothing from a header with no brackets", () => {
    assert.equal(list_id_of({ "List-Id": ["Dev list <dev.example.org>"] }), "<dev.example.org>");
    assert.equal(list_id_of({ "list-id": ["<ops.example.org>"] }), "<ops.example.org>");
    assert.equal(list_id_of({ "LIST-ID": ['"A <b>" <c.example.org>'] }), "<c.example.org>");
    assert.equal(list_id_of({ "List-Id": ["dev.example.org"] }), undefined);
    assert.equal(list_id_of({}), undefined);
});

test("the date term is the message date in microseconds, with no midnight arithmetic", async () => {
    assert.deepEqual(await message_term(scope({}), [1], "date"), { date_us: DAY.getTime() * 1000 });
});

test("the list term refuses a message that is not from a mailing list", async () => {
    await assert.rejects(message_term(scope({ 1: { subject: ["x"] } }), [1], "list"), (error) => error instanceof RuntimeRefusal && /not from a mailing list/.test(error.message));
});

test("with several messages the cursor message gives the term, and without the app verbs the first selected does", async () => {
    const headers = { 1: { "List-Id": ["<one.example.org>"] }, 2: { "List-Id": ["<two.example.org>"] } };
    const rows: Parameters<NonNullable<FilterTermsApi["app"]>["viewRows"]>[0][] = [];
    const app = { viewRows: async (args: { windowId: number; first: number; last: number }) => (rows.push(args), { current: 7, rows: [{ index: args.first, id: 2, depth: 0, collapsed: false, unread: false, flags: 0 }] }) };
    assert.deepEqual(await message_term(scope(headers, app), [1, 2], "list"), { list_id: "<two.example.org>" });
    assert.deepEqual(rows.at(-1), { windowId: 3, first: 7, last: 7 });
    assert.deepEqual(await message_term(scope(headers), [1, 2], "list"), { list_id: "<one.example.org>" });
    const no_cursor = { viewRows: async () => ({ current: -1, rows: [] }) };
    assert.deepEqual(await message_term(scope(headers, no_cursor), [2, 1], "list"), { list_id: "<two.example.org>" });
});

test("filter_set_args names only the terms that are set", () => {
    assert.deepEqual(filter_set_args(4, { list_id: "<a.b>" }), { tabId: 4, listId: "<a.b>" });
    assert.deepEqual(filter_set_args(4, { date_us: 5 }), { tabId: 4, dateUs: 5 });
    assert.deepEqual(filter_set_args(4, {}), { tabId: 4 });
});
