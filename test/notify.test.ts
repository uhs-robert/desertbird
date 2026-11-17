import assert from "node:assert/strict";
import { test } from "node:test";
import { notify_refusal, notify_result } from "../src/background/notify.ts";
import type { NotificationsApi } from "../src/background/notify.ts";

function setup(toast_answer: boolean | "absent") {
    const calls: string[] = [];
    const api: NotificationsApi = {
        notifications: { create: async (_id, options) => (calls.push(`notification ${options.message}`), "n") },
        ...(toast_answer !== "absent" && { toasts: { toast: async (window_id: number, text: string, is_error: boolean) => (calls.push(`toast ${window_id} ${is_error ? "error" : "result"} ${text}`), toast_answer) } }),
    };
    return { api, calls };
}

test("a refusal in a window is an error toast and no notification", async () => {
    const { api, calls } = setup(true);
    await notify_refusal(api, "No.", 3);
    assert.deepEqual(calls, ["toast 3 error No."]);
});

test("a result is a toast of the result kind", async () => {
    const { api, calls } = setup(true);
    await notify_result(api, "Done.", 3);
    assert.deepEqual(calls, ["toast 3 result Done."]);
});

test("a toast that cannot show falls back to a notification", async () => {
    const { api, calls } = setup(false);
    await notify_refusal(api, "No.", 3);
    assert.deepEqual(calls, ["toast 3 error No.", "notification No."]);
});

test("with no toast sink the message is a notification", async () => {
    const { api, calls } = setup("absent");
    await notify_refusal(api, "No.");
    assert.deepEqual(calls, ["notification No."]);
});
