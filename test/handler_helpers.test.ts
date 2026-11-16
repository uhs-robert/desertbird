import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeRefusal } from "../vendor/desertfox/command.ts";
import { for_each_message } from "../src/background/handlers/each_message.ts";
import { displayed_folder } from "../src/background/handlers/displayed_folder.ts";
import type { MailFolder } from "../src/background/handlers/displayed_folder.ts";
import { special_folder } from "../src/background/handlers/special_folder.ts";

test("for_each_message acts on each id in order and waits for each", async () => {
    const log: string[] = [];
    await for_each_message([3, 1, 2], async (id) => {
        log.push(`start ${id}`);
        await new Promise((resolve) => setTimeout(resolve, 1));
        log.push(`end ${id}`);
    });
    assert.deepEqual(log, ["start 3", "end 3", "start 1", "end 1", "start 2", "end 2"]);
});

test("for_each_message refuses an empty selection and stops at the first failure", async () => {
    await assert.rejects(for_each_message([], async () => {}), RuntimeRefusal);
    const seen: number[] = [];
    await assert.rejects(
        for_each_message([1, 2, 3], async (id) => {
            seen.push(id);
            if (id === 2) throw new Error("boom");
        }),
        /boom/,
    );
    assert.deepEqual(seen, [1, 2]);
});

test("displayed_folder reads the active mail tab of the current window", async () => {
    const folder: MailFolder = { accountId: "a1", path: "/Inbox" };
    const queries: unknown[] = [];
    const api = { mailTabs: { query: async (query: unknown) => (queries.push(query), [{ displayedFolder: folder }]) } };
    assert.equal(await displayed_folder(api), folder);
    assert.deepEqual(queries, [{ active: true, currentWindow: true }]);
});

test("displayed_folder refuses when no folder is displayed", async () => {
    await assert.rejects(displayed_folder({ mailTabs: { query: async () => [{}] } }), RuntimeRefusal);
    await assert.rejects(displayed_folder({ mailTabs: { query: async () => [] } }), RuntimeRefusal);
});

test("special_folder queries by special use, in one account when given", async () => {
    const queries: unknown[] = [];
    const trash: MailFolder = { accountId: "a1", path: "/Trash", specialUse: ["trash"] };
    const api = { folders: { query: async (query: unknown) => (queries.push(query), [trash]) } };
    assert.equal(await special_folder(api, "trash", "a1"), trash);
    assert.equal(await special_folder(api, "trash"), trash);
    assert.deepEqual(queries, [{ accountId: "a1", specialUse: ["trash"] }, { specialUse: ["trash"] }]);
});

test("special_folder refuses when the account has none", async () => {
    await assert.rejects(special_folder({ folders: { query: async () => [] } }, "archives", "a1"), /no archives folder/);
});
