import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { create_registry } from "../vendor/desertfox/registry/define.ts";
import { create_router } from "../src/background/router.ts";
import { fake_api } from "./fake_api.ts";

const invoke = (command: string, args: Record<string, string> = {}, message_ids: number[] = []) => ({ command, args, count: 1, windowId: 3, messageIds: message_ids });
const notifications = (calls: string[]) => calls.filter((call) => call.startsWith("notify"));

const reply_args = { to: "sender" };

test("r with no identity refuses and never calls beginReply", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 5, folder: { accountId: "a1" } }], identities: [] });
    await create_router(registry, api).run(invoke("msg.reply", reply_args, [5]));
    assert.ok(calls.includes("identities.list"));
    assert.equal(calls.some((call) => call.startsWith("compose.beginReply")), false);
    assert.equal(notifications(calls).length, 1);
});

test("r with one id replies to that message", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 5, folder: { accountId: "a1" } }, { id: 9, folder: { accountId: "a1" } }] });
    await create_router(registry, api).run(invoke("msg.reply", reply_args, [5]));
    assert.deepEqual(calls.filter((call) => call.startsWith("compose.")), ["compose.beginReply 5 replyToSender i1"]);
    assert.deepEqual(notifications(calls), []);
});

test("r with several ids, such as a collapsed thread root, replies to the newest by date", async () => {
    // The id order is not the date order here, so the date decides.
    const at_minute = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
    const thread = [
        { id: 5, date: at_minute(1) },
        { id: 8, date: at_minute(4) },
        { id: 6, date: at_minute(2) },
        { id: 7, date: at_minute(3) },
    ].map((message) => ({ ...message, folder: { accountId: "a1" } }));
    const { api, calls } = fake_api({ messages: thread });
    await create_router(registry, api).run(invoke("msg.reply", reply_args, [5, 8, 6, 7]));
    assert.deepEqual(calls.filter((call) => call.startsWith("compose.")), ["compose.beginReply 8 replyToSender i1"]);
    assert.deepEqual(notifications(calls), []);
});

test("r with several ids and no identity refuses and never calls beginReply", async () => {
    const { api, calls } = fake_api({ messages: [5, 6].map((id) => ({ id, folder: { accountId: "a1" } })), identities: [] });
    await create_router(registry, api).run(invoke("msg.reply", reply_args, [5, 6]));
    assert.ok(calls.includes("identities.list"));
    assert.equal(calls.some((call) => call.startsWith("compose.beginReply")), false);
    assert.equal(notifications(calls).length, 1);
});

test("every command with no ids refuses", async () => {
    for (const [command, args] of [["msg.reply", reply_args], ["msg.archive", {}], ["msg.delete", {}]] as const) {
        const { api, calls } = fake_api({ messages: [{ id: 5, folder: { accountId: "a1" } }] });
        await create_router(registry, api).run(invoke(command, args, []));
        assert.deepEqual(calls.map((call) => call.split(" ")[0]), ["notify"], command);
    }
});

test("a missing Experiment refuses a command that needs it, before any message call", async () => {
    const local = create_registry();
    local.define("test.needs_keys", { runs_in: "background", label: "Probe", intent: "Probe the Experiment check.", needs: ["keys.install"], run: async () => {} });
    const { api, calls } = fake_api({ messages: [{ id: 5 }], experiment: false });
    await create_router(local, api).run(invoke("test.needs_keys", {}, [5]));
    assert.deepEqual(calls.map((call) => call.split(" ")[0]), ["notify"]);
    assert.match(notifications(calls)[0] ?? "", /Experiment/);
});

test("a missing Experiment does not block a command that needs no Experiment verb", async () => {
    for (const [command, call] of [["msg.reply", "compose.beginReply 5 replyToSender i1"], ["msg.archive", "messages.archive 5"], ["msg.delete", "messages.delete 5"]] as const) {
        const { api, calls } = fake_api({ messages: [{ id: 5, folder: { accountId: "a1" } }], experiment: false });
        await create_router(registry, api).run(invoke(command, command === "msg.reply" ? reply_args : {}, [5]));
        assert.ok(calls.includes(call), command);
    }
});

test("x and d d act on exactly the ids sent, with no selection read", async () => {
    for (const [command, call] of [["msg.archive", "messages.archive 4,5,6"], ["msg.delete", "messages.delete 4,5,6"]] as const) {
        const { api, calls } = fake_api();
        await create_router(registry, api).run(invoke(command, {}, [4, 5, 6]));
        assert.deepEqual(calls, [call], command);
    }
});

test("a bad arg, an unknown command and a chrome command each end in a notification", async () => {
    for (const bad of [invoke("msg.reply", { to: "everyone" }, [5]), invoke("no.such", {}, [5]), invoke("motion.down", {}, [5])]) {
        const { api, calls } = fake_api({ messages: [{ id: 5 }] });
        await create_router(registry, api).run(bad);
        assert.equal(notifications(calls).length, 1, bad.command);
        assert.equal(calls.some((call) => call.startsWith("messages.") || call.startsWith("compose.")), false);
    }
});

test("an API failure becomes a notification, not a throw", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 5 }] });
    api.messages.archive = () => Promise.reject(new Error("disk full"));
    await create_router(registry, api).run(invoke("msg.archive", {}, [5]));
    assert.match(notifications(calls)[0] ?? "", /disk full/);
});
