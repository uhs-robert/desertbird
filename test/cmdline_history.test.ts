import assert from "node:assert/strict";
import { test } from "node:test";
import { HISTORY_LIMIT, create_cmdline_history, record_entry } from "../src/background/cmdline/history.ts";
import { CMDLINE_HISTORY_STORAGE_KEY } from "../src/shared/protocol.ts";

test("a recorded line moves to the newest place, blanks are skipped and the oldest fall off", () => {
    assert.deepEqual(record_entry(["a", "b"], "a"), ["b", "a"]);
    assert.deepEqual(record_entry(["a"], "  "), ["a"]);
    assert.deepEqual(record_entry(["a"], " b "), ["a", "b"]);
    const full = Array.from({ length: HISTORY_LIMIT }, (_, index) => `c${index}`);
    const grown = record_entry(full, "new");
    assert.equal(grown.length, HISTORY_LIMIT);
    assert.equal(grown[0], "c1");
    assert.equal(grown.at(-1), "new");
});

function slow_storage(initial: unknown, options: { fail_first_set?: boolean } = {}) {
    const items: Record<string, unknown> = { [CMDLINE_HISTORY_STORAGE_KEY]: initial };
    let failures_left = options.fail_first_set ? 1 : 0;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
    return {
        items,
        get: async (key: string) => {
            const value = items[key];
            await tick();
            return { [key]: value };
        },
        set: async (changes: Record<string, unknown>) => {
            await tick();
            if (failures_left-- > 0) throw new Error("disk full");
            Object.assign(items, changes);
        },
    };
}

test("two lines recorded at once both stay", async () => {
    const storage = slow_storage(["old"]);
    const history = create_cmdline_history(storage);
    await Promise.all([history.record("x"), history.record("y")]);
    assert.deepEqual(storage.items[CMDLINE_HISTORY_STORAGE_KEY], ["old", "x", "y"]);
});

test("a failed write rejects its own call and the next one still runs", async () => {
    const storage = slow_storage([], { fail_first_set: true });
    const history = create_cmdline_history(storage);
    const first = history.record("x");
    const second = history.record("y");
    await assert.rejects(first, /disk full/);
    await second;
    assert.deepEqual(storage.items[CMDLINE_HISTORY_STORAGE_KEY], ["y"]);
});

test("stored data that is not a list of strings counts as empty", async () => {
    const storage = slow_storage({ bad: true });
    await create_cmdline_history(storage).record("x");
    assert.deepEqual(storage.items[CMDLINE_HISTORY_STORAGE_KEY], ["x"]);
});
