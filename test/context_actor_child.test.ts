import assert from "node:assert/strict";
import { before, test } from "node:test";

// The actor system gives the child its base class as a global, and the document and window of its page.
class FakeActorChild {
    document: Record<string, unknown> = {};
    contentWindow: Record<string, unknown> = {};
}

type Child = FakeActorChild & { receiveMessage(message: { name: string }): boolean };
let ChildClass: new () => Child;

before(async () => {
    (globalThis as Record<string, unknown>)["JSWindowActorChild"] = FakeActorChild;
    ChildClass = (await import("../src/chrome/context_actor_child.ts")).DesertBirdContextChild as unknown as typeof ChildClass;
});

interface Sent {
    on: string;
    init: Record<string, unknown>;
}

const element = (name: string, box: { left: number; top: number; right: number; bottom: number }, sent: Sent[]) => ({ localName: name, nodeType: 1, getBoundingClientRect: () => box, dispatchEvent(event: { init: Record<string, unknown> }) { sent.push({ on: name, init: event.init }); return true; } });

function child_with(document: Record<string, unknown>, selection_anchor: unknown = null) {
    const child = new ChildClass();
    child.document = document;
    child.contentWindow = { innerWidth: 800, innerHeight: 600, mozInnerScreenX: 100, mozInnerScreenY: 300, getSelection: () => (selection_anchor ? { anchorNode: selection_anchor } : null), MouseEvent: class { init: Record<string, unknown>; constructor(_type: string, init: Record<string, unknown>) { this.init = init; } } };
    return child;
}

test("a focused link takes the event, with screen coordinates inside its box", () => {
    const sent: Sent[] = [];
    const body = element("body", { left: 0, top: 0, right: 800, bottom: 2000 }, sent);
    const link = element("a", { left: 50, top: 100, right: 250, bottom: 118 }, sent);
    assert.equal(child_with({ activeElement: link, body }).receiveMessage({ name: "DesertBird:ContextMenu" }), true);
    assert.deepEqual(sent.map((each) => each.on), ["a"]);
    assert.equal(sent[0]!.init["button"], 0);
    assert.equal(sent[0]!.init["screenX"], 100 + 50 + 20);
    assert.equal(sent[0]!.init["screenY"], 300 + 100 + 9);
});

test("with the body focused the caret's element takes it, else the body", () => {
    const sent: Sent[] = [];
    const body = element("body", { left: 0, top: 0, right: 800, bottom: 2000 }, sent);
    const paragraph = element("p", { left: 8, top: 40, right: 700, bottom: 60 }, sent);
    child_with({ activeElement: body, body }, { nodeType: 3, parentElement: paragraph }).receiveMessage({ name: "DesertBird:ContextMenu" });
    child_with({ activeElement: body, body }).receiveMessage({ name: "DesertBird:ContextMenu" });
    assert.deepEqual(sent.map((each) => each.on), ["p", "body"]);
});

test("the point stays in the visible part of a body scrolled up and taller than the window", () => {
    const sent: Sent[] = [];
    const body = element("body", { left: 0, top: -900, right: 800, bottom: 1100 }, sent);
    child_with({ activeElement: body, body }).receiveMessage({ name: "DesertBird:ContextMenu" });
    assert.equal(sent[0]!.init["clientY"], 10);
    assert.equal(sent[0]!.init["clientX"], 20);
});

test("a document with no element, and any other message, do nothing", () => {
    assert.equal(child_with({ activeElement: null, body: null }).receiveMessage({ name: "DesertBird:ContextMenu" }), false);
    const sent: Sent[] = [];
    const body = element("body", { left: 0, top: 0, right: 800, bottom: 600 }, sent);
    assert.equal(child_with({ activeElement: body, body }).receiveMessage({ name: "Other" }), false);
    assert.deepEqual(sent, []);
});
