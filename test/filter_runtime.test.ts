import assert from "node:assert/strict";
import { test } from "node:test";
import { append_message_terms, define_message_filter, MESSAGE_FILTER_NAME, show_message_filter } from "../src/chrome/filter_runtime.ts";
import type { MessageFilterState, QuickFilterManagerLike } from "../src/chrome/filter_runtime.ts";
import { get_filter_api, shutdown } from "../src/chrome/parent_filter.ts";
import { stub_platform } from "./chrome_stubs.ts";

const CONSTANTS = { nsMsgSearchAttrib: { OtherHeader: 52, Date: 3 }, nsMsgSearchOp: { Contains: 0, Is: 8 } };

// A term creator whose terms copy their value on read, as the XPCOM terms do, so a value changed and not assigned back is lost.
function creator() {
    return {
        createTerm() {
            let stored = { attrib: -1, str: "", date: 0 };
            return { attrib: -1, op: -1, booleanAnd: false, arbitraryHeader: "", get value() { return { ...stored }; }, set value(next) { stored = next; } };
        },
    };
}

function fake_manager() {
    const manager = {
        filterDefsByName: {} as Record<string, { appendTerms: (...args: never[]) => void }>,
        killed: [] as string[],
        defineFilter(definition: { name: string; appendTerms: (...args: never[]) => void }) {
            manager.filterDefsByName[definition.name] = definition;
        },
        killFilter(name: string) {
            manager.killed.push(name);
            delete manager.filterDefsByName[name];
        },
    };
    return manager;
}

function fake_bar() {
    const steps: string[] = [];
    const bar = {
        filterer: {
            visible: false,
            setFilterValue: (name: string, value: MessageFilterState) => void steps.push(`value ${name} ${JSON.stringify(value)} visible=${bar.filterer.visible}`),
        },
        reflectFiltererState: () => void steps.push("reflect"),
        updateSearch: async () => void steps.push("search"),
    };
    return { bar, steps };
}

test("a list state builds one AND term on the List-Id header that contains the id", () => {
    const terms: ReturnType<ReturnType<typeof creator>["createTerm"]>[] = [];
    append_message_terms(CONSTANTS, creator(), terms, { listId: "<dev.example.org>" });
    assert.equal(terms.length, 1);
    assert.deepEqual([terms[0]!.attrib, terms[0]!.op, terms[0]!.booleanAnd, terms[0]!.arbitraryHeader], [52, 0, true, "List-Id"]);
    assert.deepEqual(terms[0]!.value, { attrib: 52, str: "<dev.example.org>", date: 0 });
});

test("a date state builds one Is term on the date, and both states build both terms", () => {
    const terms: ReturnType<ReturnType<typeof creator>["createTerm"]>[] = [];
    append_message_terms(CONSTANTS, creator(), terms, { dateUs: 1_700_000_000_000_000 });
    assert.deepEqual([terms[0]!.attrib, terms[0]!.op, terms[0]!.value.date], [3, 8, 1_700_000_000_000_000]);
    const both: typeof terms = [];
    append_message_terms(CONSTANTS, creator(), both, { listId: "<a.b>", dateUs: 1 });
    assert.deepEqual(both.map((term) => term.attrib), [52, 3]);
});

test("the filter is defined once, and its terms come from the state Thunderbird passes", () => {
    const manager = fake_manager();
    define_message_filter(manager as unknown as QuickFilterManagerLike, CONSTANTS);
    const first = manager.filterDefsByName[MESSAGE_FILTER_NAME];
    define_message_filter(manager as unknown as QuickFilterManagerLike, CONSTANTS);
    assert.equal(manager.filterDefsByName[MESSAGE_FILTER_NAME], first);
    const terms: unknown[] = [];
    (first!.appendTerms as unknown as (c: unknown, t: unknown[], s: MessageFilterState) => void)(creator(), terms, { listId: "<a.b>" });
    assert.equal(terms.length, 1);
});

test("showing the filter makes the bar visible before it sets the value, then draws the bar and runs the search", async () => {
    const { bar, steps } = fake_bar();
    await show_message_filter(bar, { listId: "<a.b>" });
    assert.deepEqual(steps, [`value ${MESSAGE_FILTER_NAME} {"listId":"<a.b>"} visible=true`, "reflect", "search"]);
});

test("filter.set finds the bar of the tab by id, drops the empty optional args, and shutdown removes the filter", async () => {
    const platform = stub_platform();
    const manager = fake_manager();
    const globals = globalThis as Record<string, unknown>;
    const chrome_utils = globals["ChromeUtils"] as { importESModule(url: string): unknown };
    globals["ChromeUtils"] = { importESModule: (url: string) => (url === "resource:///modules/QuickFilterManager.sys.mjs" ? { QuickFilterManager: manager } : chrome_utils.importESModule(url)) };
    globals["Ci"] = CONSTANTS;
    const { bar, steps } = fake_bar();
    const tabs: Record<number, unknown> = { 5: { nativeTab: { chromeBrowser: { contentWindow: { quickFilterBar: bar } } } }, 6: { nativeTab: { chromeBrowser: null } } };
    const api = get_filter_api({ extension: { windowManager: { getWrapper: () => null }, messageManager: { convert: () => null }, tabManager: { get: (id: number) => tabs[id] } } } as never);
    try {
        await api.filter.set({ tabId: 5, listId: "<a.b>", dateUs: null as never });
        assert.equal(steps[0], `value ${MESSAGE_FILTER_NAME} {"listId":"<a.b>"} visible=true`);
        assert.ok(MESSAGE_FILTER_NAME in manager.filterDefsByName);
        await assert.rejects(api.filter.set({ tabId: 6, listId: "<a.b>" }), /filter\.set: tab 6 shows no message list/);
        shutdown();
        assert.deepEqual(manager.killed, [MESSAGE_FILTER_NAME]);
        shutdown();
        assert.deepEqual(manager.killed, [MESSAGE_FILTER_NAME]);
    } finally {
        platform.restore();
    }
});
