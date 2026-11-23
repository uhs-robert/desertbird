import assert from "node:assert/strict";
import { test } from "node:test";
import { create_popup_requests } from "../src/background/popup_requests.ts";
import type { KeysInvocation } from "../src/shared/protocol.ts";

const POPUP_URL = "moz-extension://abc/popup/popup.html";

function setup(window_id: number | undefined) {
    const runs: KeysInvocation[] = [];
    const handle = create_popup_requests({ popup_url: () => POPUP_URL, target_window: async () => window_id, run: async (invocation) => void runs.push(invocation) });
    return { runs, handle };
}

test("each popup entry runs its command in the last focused main window", async () => {
    const { runs, handle } = setup(4);
    for (const command of ["options.open", "help.open", "help.whichkey"]) assert.deepEqual(await handle({ type: "popup.run", command }, { url: POPUP_URL }), {});
    assert.deepEqual(runs.map((run) => [run.command, run.windowId, run.count, run.messageIds]), [["options.open", 4, 1, []], ["help.open", 4, 1, []], ["help.whichkey", 4, 1, []]]);
});

test("any other command, a sender with a tab and another page run nothing", async () => {
    const { runs, handle } = setup(4);
    assert.deepEqual(await handle({ type: "popup.run", command: "msg.delete" }, { url: POPUP_URL }), {});
    assert.deepEqual(await handle({ type: "popup.run", command: "help.open" }, { url: POPUP_URL, tab: { id: 1 } }), {});
    assert.deepEqual(await handle({ type: "popup.run", command: "help.open" }, { url: "moz-extension://abc/options/options.html" }), {});
    assert.deepEqual(runs, []);
});

test("no main window means no run, and a message of another type is left to other handlers", async () => {
    const { runs, handle } = setup(undefined);
    assert.deepEqual(await handle({ type: "popup.run", command: "help.open" }, { url: POPUP_URL }), {});
    assert.deepEqual(runs, []);
    assert.equal(handle({ type: "body.invoke" }, {}), undefined);
});
