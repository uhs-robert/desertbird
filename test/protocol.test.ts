import assert from "node:assert/strict";
import { test } from "node:test";
import { BODY_SCRIPT_LIVE_ATTRIBUTE, EXPERIMENT_VERBS, KEYMAP_STORAGE_KEY, type KeysInvocation } from "../src/shared/protocol.ts";

test("the Experiment exposes the fixed verb table", () => {
    assert.deepEqual(EXPERIMENT_VERBS.keys.functions, ["install"]);
    assert.deepEqual(EXPERIMENT_VERBS.app.functions, ["viewRows", "viewThread", "viewAllThreads", "viewScroll", "paneFocus", "appCommand", "appOpenPage"]);
    assert.deepEqual(EXPERIMENT_VERBS.overlay.functions, ["mount", "unmount", "setModeLabel"]);
    assert.deepEqual(Object.keys(EXPERIMENT_VERBS), ["keys", "overlay", "hints", "pages", "folderpane", "app", "zoom"]);
    assert.deepEqual(EXPERIMENT_VERBS.zoom, { functions: ["get", "set"], events: [] });
    assert.deepEqual(EXPERIMENT_VERBS.hints.functions, ["sendEnter", "pick"]);
    assert.deepEqual(EXPERIMENT_VERBS.folderpane.functions, ["fold", "focused", "viewRowCount"]);
    assert.deepEqual(EXPERIMENT_VERBS.pages, { functions: ["install"], events: ["onInvocation"] });
});

test("an invocation payload is plain data", () => {
    const invocation: KeysInvocation = { command: "msg.delete", args: {}, count: 1, windowId: 1, messageIds: [4, 5] };
    assert.deepEqual(JSON.parse(JSON.stringify(invocation)), invocation);
});

test("the handoff and storage names the body script and the chrome runtime share are fixed strings", () => {
    assert.equal(BODY_SCRIPT_LIVE_ATTRIBUTE, "data-desertbird-keys");
    assert.equal(KEYMAP_STORAGE_KEY, "desertbird_compiled_keymap");
});

test("the handoff is no Experiment verb: the body script talks to the chrome runtime through a document attribute", () => {
    assert.deepEqual(EXPERIMENT_VERBS.keys.events, ["onInvocation"]);
    assert.match(BODY_SCRIPT_LIVE_ATTRIBUTE, /^data-[a-z-]+$/);
});
