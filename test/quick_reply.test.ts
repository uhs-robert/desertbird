import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, registry } from "../src/background/commands/index.ts";
import { insert_into_plain } from "../src/background/handlers/quick_reply.ts";
import { create_quick_reply_store, migrate_quick_reply_record, QUICK_REPLY_STORAGE_KEY } from "../src/background/quick_reply_store.ts";
import { create_router } from "../src/background/router.ts";
import { fake_api, fake_storage } from "./fake_api.ts";

const invocation = (slot: number) => ({ command: "msg.reply_with", args: { slot }, windowId: 1, messageIds: [5], count: 1 });
const MESSAGES = [{ id: 5, headerMessageId: "m5", folder: { accountId: "a1" } }];

test("g r 1 to g r 9 bind msg.reply_with with the slot", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    for (let slot = 1; slot <= 9; slot++) assert.deepEqual(normal[`gr${slot}`], { id: "msg.reply_with", args: { slot }, label: `Slot ${slot}` });
});

test("the slot is checked by the param schema", () => {
    const command = registry.get("msg.reply_with")!;
    assert.equal(check_args(command, { slot: 9 }).ok, true);
    assert.equal(check_args(command, { slot: 0 }).ok, false);
    assert.equal(check_args(command, { slot: 10 }).ok, false);
    assert.equal(check_args(command, {}).ok, false);
});

test("a filled slot opens a reply to the sender and puts the text above the quote in plain compose", async () => {
    const { api, calls } = fake_api({ messages: MESSAGES, quick_replies: ["", "Thanks.\nI will look."] });
    await create_router(registry, api).run(invocation(2));
    assert.deepEqual(calls.filter((call) => call.startsWith("compose.")), [
        "compose.beginReply 5 replyToSender i1",
        "compose.getComposeDetails 7",
        `compose.setComposeDetails 7 ${JSON.stringify({ plainTextBody: "Thanks.\nI will look.\n\nOn x wrote:\n> quoted" })}`,
    ]);
    assert.equal(calls.some((call) => call.startsWith("notify")), false);
});

test("an empty slot refuses with a message and opens nothing", async () => {
    const { api, calls } = fake_api({ messages: MESSAGES, quick_replies: ["", "  \n"] });
    await create_router(registry, api).run(invocation(2));
    await create_router(registry, api).run(invocation(5));
    assert.deepEqual(calls.filter((call) => call.startsWith("notify")), ["notify Quick reply 2 is empty. Write it on the options page.", "notify Quick reply 5 is empty. Write it on the options page."]);
    assert.equal(calls.some((call) => call.startsWith("compose.")), false);
});

test("plain insert keeps the quote and drops the leading blank lines of the draft", () => {
    assert.equal(insert_into_plain("\n\nOn x wrote:\n> q\n\n-- \nsig", "Hi"), "Hi\n\nOn x wrote:\n> q\n\n-- \nsig");
});

test("the store keeps nine slots, pads short lists and drops bad entries", async () => {
    const storage = fake_storage();
    const store = create_quick_reply_store({ storage: storage.api });
    assert.deepEqual(await store.read_all(), Array(9).fill(""));
    await store.write_all(["one", "two"]);
    assert.equal(await store.read_slot(2), "two");
    assert.equal(await store.read_slot(9), "");
    assert.equal((storage.data[QUICK_REPLY_STORAGE_KEY] as { slots: string[] }).slots.length, 9);
    assert.deepEqual(migrate_quick_reply_record({ record_version: 1, slots: ["a", 3] })?.slots.slice(0, 3), ["a", "", ""]);
    assert.equal(migrate_quick_reply_record({ record_version: 2, slots: [] }), undefined);
    assert.equal(migrate_quick_reply_record(undefined), undefined);
});
