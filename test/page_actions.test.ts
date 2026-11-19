import assert from "node:assert/strict";
import { test } from "node:test";
import { run_scroll, scroll_target } from "../src/chrome/page_actions.ts";
import type { ScrollNode } from "../src/chrome/page_actions.ts";

interface Fake extends ScrollNode {
    calls: string[];
}

function node(options: { scroll_height?: number; client_height?: number; overflow?: string; parent?: Fake | null; scrolling_element?: Fake | null; host?: Fake | null } = {}): Fake {
    const calls: string[] = [];
    const fake: Fake = {
        calls,
        scrollHeight: options.scroll_height ?? 100,
        clientHeight: options.client_height ?? 100,
        parentElement: options.parent ?? null,
        getRootNode: () => ({ host: options.host ?? null }),
        ownerDocument: { scrollingElement: options.scrolling_element ?? null, defaultView: { getComputedStyle: () => ({ overflowY: options.overflow ?? "visible" }) } },
        scrollBy: (move) => void calls.push(`by ${move.top}`),
        scrollTo: (move) => void calls.push(`to ${move.top}`),
    };
    return fake;
}

test("the scroll target is the nearest scrollable ancestor of the focused element", () => {
    const outer = node({ scroll_height: 900, client_height: 300, overflow: "auto" });
    const inner = node({ scroll_height: 500, client_height: 200, overflow: "scroll", parent: outer });
    const focused = node({ parent: inner });
    assert.equal(scroll_target(focused as never, {}), inner);
});

test("an element that overflows with overflow hidden or visible is not a target", () => {
    const hidden = node({ scroll_height: 500, client_height: 200, overflow: "hidden" });
    const page = node();
    const focused = node({ parent: hidden, scrolling_element: page });
    assert.equal(scroll_target(focused as never, {}), page);
});

test("the target climbs out of a shadow tree through its host", () => {
    const host = node({ scroll_height: 500, client_height: 200, overflow: "auto" });
    const focused = node({ host });
    assert.equal(scroll_target(focused as never, {}), host);
});

test("with nothing focused the target is the scrolling element of the fallback document", () => {
    const page = node();
    assert.equal(scroll_target(undefined, { scrollingElement: page }), page);
    assert.equal(scroll_target(null, {}), null);
});

test("when the root does not scroll the target is the largest scrollable element of the document", () => {
    const small = node({ scroll_height: 900, client_height: 100, overflow: "auto" });
    const pane = node({ scroll_height: 2000, client_height: 500, overflow: "auto" });
    const hidden = node({ scroll_height: 5000, client_height: 900, overflow: "hidden" });
    const root = node();
    const doc = { scrollingElement: root, querySelectorAll: () => [small, hidden, pane] };
    const sidebar_button = node();
    sidebar_button.ownerDocument = { ...doc, defaultView: { getComputedStyle: () => ({ overflowY: "visible" }) } };
    assert.equal(scroll_target(sidebar_button as never, doc), pane);
    assert.equal(scroll_target(undefined, doc), pane);
});

test("a root that scrolls wins over the search, and with nothing scrollable the root is the answer", () => {
    const pane = node({ scroll_height: 2000, client_height: 500, overflow: "auto" });
    const long_root = node({ scroll_height: 3000, client_height: 700 });
    assert.equal(scroll_target(undefined, { scrollingElement: long_root, querySelectorAll: () => [pane] }), long_root);
    const flat_root = node();
    assert.equal(scroll_target(undefined, { scrollingElement: flat_root, querySelectorAll: () => [node()] }), flat_root);
});

test("each page action scrolls the target by its own amount, with a count", () => {
    const target = node({ scroll_height: 1000, client_height: 400 });
    run_scroll("page.scroll_down", target, 3);
    run_scroll("page.scroll_up", target, undefined);
    run_scroll("page.half_down", target, 2);
    run_scroll("page.half_up", target, 1);
    run_scroll("page.top", target, undefined);
    run_scroll("page.bottom", target, undefined);
    assert.deepEqual(target.calls, ["by 120", "by -40", "by 400", "by -200", "to 0", "to 1000"]);
});

test("a message id runs the same action, and a zero count counts as one", () => {
    const target = node();
    assert.equal(run_scroll("message.scroll_down", target, 0), true);
    assert.deepEqual(target.calls, ["by 40"]);
});

test("an id outside the table does nothing, and a missing target is no failure", () => {
    const target = node();
    assert.equal(run_scroll("tab.close", target, 1), false);
    assert.equal(run_scroll("toString", target, 1), false);
    assert.deepEqual(target.calls, []);
    assert.equal(run_scroll("page.top", null, 1), true);
});
