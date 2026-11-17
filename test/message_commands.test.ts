import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import { fake_api } from "./fake_api.ts";

const invoke = (command: string, args: Record<string, string> = {}, message_ids: number[] = []) => ({ command, args, count: 1, windowId: 3, messageIds: message_ids });
const notifications = (calls: string[]) => calls.filter((call) => call.startsWith("notify"));
const updates = (calls: string[]) => calls.filter((call) => call.startsWith("messages.update"));
const a1 = { accountId: "a1" };

test("msg.read read and unread set every selected message, one call each", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await create_router(registry, api).run(invoke("msg.read", { state: "read" }, [1, 2, 3]));
    assert.deepEqual(updates(calls), ['messages.update 1 {"read":true}', 'messages.update 2 {"read":true}', 'messages.update 3 {"read":true}']);
    const unread = fake_api({ messages: [{ id: 1 }] });
    await create_router(registry, unread.api).run(invoke("msg.read", { state: "unread" }, [1]));
    assert.deepEqual(updates(unread.calls), ['messages.update 1 {"read":false}']);
});

test("a toggle on a mixed selection follows the first message", async () => {
    const messages = [{ id: 1, read: true, flagged: false, junk: true }, { id: 2, read: false, flagged: true, junk: false }];
    const cases: [string, Record<string, string>, string][] = [
        ["msg.read", { state: "toggle" }, '{"read":false}'],
        ["msg.flag", {}, '{"flagged":true}'],
        ["msg.junk", {}, '{"junk":false}'],
    ];
    for (const [command, args, change] of cases) {
        const { api, calls } = fake_api({ messages });
        await create_router(registry, api).run(invoke(command, args, [1, 2]));
        assert.deepEqual(updates(calls), [`messages.update 1 ${change}`, `messages.update 2 ${change}`], command);
        const reversed = fake_api({ messages });
        await create_router(registry, reversed.api).run(invoke(command, args, [2, 1]));
        assert.notDeepEqual(updates(reversed.calls)[0]?.split(" ")[2], change, `${command} with the other message first`);
    }
});

test("msg.read, msg.flag, msg.junk, msg.tag and msg.move refuse an empty selection", async () => {
    const commands: [string, Record<string, string>][] = [["msg.read", { state: "read" }], ["msg.flag", {}], ["msg.junk", {}], ["msg.tag", { tag: "Work" }], ["msg.move", { folder: "/Archive" }], ["msg.forward", {}]];
    for (const [command, args] of commands) {
        const { api, calls } = fake_api({ tags: [{ key: "$w", tag: "Work" }] });
        await create_router(registry, api).run(invoke(command, args, []));
        assert.equal(notifications(calls).length, 1, command);
        assert.equal(calls.some((call) => /^(messages\.(update|move)|compose\.)/.test(call)), false, command);
    }
});

test("folder.read_all marks the displayed folder of the key's window, and needs no selection", async () => {
    const { api, calls } = fake_api({ displayed: { id: "f9", accountId: "a1", path: "/Inbox" } });
    await create_router(registry, api).run(invoke("folder.read_all", {}, []));
    assert.deepEqual(calls, ["mailTabs.query 3", "folders.markAsRead f9"]);
});

test("folder.read_all refuses when no folder is displayed", async () => {
    const { api, calls } = fake_api();
    await create_router(registry, api).run(invoke("folder.read_all", {}, []));
    assert.equal(calls.some((call) => call.startsWith("folders.markAsRead")), false);
    assert.equal(notifications(calls).length, 1);
});

test("msg.tag adds the tag by name or key and keeps each message's own tags", async () => {
    const tags = [{ key: "$label1", tag: "Important" }, { key: "work", tag: "Work" }];
    for (const typed of ["work", "WORK", "Work"]) {
        const { api, calls } = fake_api({ tags, messages: [{ id: 1, tags: ["$label1"] }, { id: 2, tags: ["work"] }, { id: 3 }] });
        await create_router(registry, api).run(invoke("msg.tag", { tag: typed }, [1, 2, 3]));
        assert.deepEqual(updates(calls), ['messages.update 1 {"tags":["$label1","work"]}', 'messages.update 3 {"tags":["work"]}'], typed);
    }
    const by_key = fake_api({ tags, messages: [{ id: 1 }] });
    await create_router(registry, by_key.api).run(invoke("msg.tag", { tag: "$label1" }, [1]));
    assert.deepEqual(updates(by_key.calls), ['messages.update 1 {"tags":["$label1"]}']);
});

test("msg.tag with an unknown tag refuses and changes nothing", async () => {
    const { api, calls } = fake_api({ tags: [{ key: "work", tag: "Work" }], messages: [{ id: 1 }] });
    await create_router(registry, api).run(invoke("msg.tag", { tag: "Nope" }, [1]));
    assert.deepEqual(updates(calls), []);
    assert.equal(notifications(calls).length, 1);
});

test("msg.move looks the path up in the first message's account and moves every id", async () => {
    const folders = [{ id: "fx", accountId: "a2", path: "/Archive" }, { id: "f1", accountId: "a1", path: "/Archive" }];
    const { api, calls } = fake_api({ folders, messages: [{ id: 4, folder: a1 }, { id: 5, folder: a1 }] });
    await create_router(registry, api).run(invoke("msg.move", { folder: "/Archive" }, [4, 5]));
    assert.ok(calls.includes('folders.query {"accountId":"a1","path":"/Archive"}'));
    assert.ok(calls.includes("messages.move 4,5 f1"));
});

test("msg.move to a folder the account lacks refuses and moves nothing", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 4, folder: a1 }] });
    await create_router(registry, api).run(invoke("msg.move", { folder: "/Nowhere" }, [4]));
    assert.equal(calls.some((call) => call.startsWith("messages.move")), false);
    assert.equal(notifications(calls).length, 1);
});

test("the validator rejects a bad msg.move folder and a bad msg.tag value", () => {
    const move = registry.get("msg.move");
    const tag = registry.get("msg.tag");
    assert.ok(move && tag);
    for (const folder of ["", "  ", " proj"]) assert.equal(check_args(move, { folder }).ok, false, `folder ${JSON.stringify(folder)}`);
    assert.equal(check_args(move, {}).ok, false);
    assert.equal(check_args(move, { folder: "/Archive/2026" }).ok, true);
    for (const value of ["", "  ", " Work", "Work "]) assert.equal(check_args(tag, { tag: value }).ok, false, `tag ${JSON.stringify(value)}`);
    assert.equal(check_args(tag, {}).ok, false);
    assert.equal(check_args(tag, { tag: "Work" }).ok, true);
    assert.equal(check_args(tag, { tag: "To Do" }).ok, true);
});

test("the validator rejects a bad msg.read state and args on commands that take none", () => {
    const read = registry.get("msg.read");
    assert.ok(read);
    assert.equal(check_args(read, { state: "toggle" }).ok, true);
    assert.equal(check_args(read, { state: "maybe" }).ok, false);
    for (const id of ["msg.flag", "msg.junk", "folder.read_all", "msg.forward", "msg.new"]) assert.equal(check_args(registry.get(id)!, { x: "1" }).ok, false, id);
});

test("msg.reply to all and to list pick the matching compose type", async () => {
    for (const [to, type] of [["all", "replyToAll"], ["list", "replyToList"]] as const) {
        const { api, calls } = fake_api({ messages: [{ id: 5, folder: a1 }] });
        await create_router(registry, api).run(invoke("msg.reply", { to }, [5]));
        assert.deepEqual(calls.filter((call) => call.startsWith("compose.")), [`compose.beginReply 5 ${type} i1`]);
    }
});

test("msg.forward uses the newest message of a collapsed thread", async () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
    const { api, calls } = fake_api({ messages: [{ id: 5, date: at(1), folder: a1 }, { id: 8, date: at(4), folder: a1 }, { id: 6, date: at(2), folder: a1 }] });
    await create_router(registry, api).run(invoke("msg.forward", {}, [5, 8, 6]));
    assert.deepEqual(calls.filter((call) => call.startsWith("compose.")), ["compose.beginForward 8 i1"]);
});

const identity = (id: string, email: string, account_id: string) => ({ id, email, account_id });
const forwarded_with = async (options: Parameters<typeof fake_api>[0], message_ids = [5]) => {
    const { api, calls } = fake_api(options);
    await create_router(registry, api).run(invoke("msg.forward", {}, message_ids));
    return calls.filter((call) => call.startsWith("compose.")).concat(notifications(calls));
};

test("the identity is one the message was addressed to, in any account, over every other", async () => {
    const identities = [identity("main", "main@x.invalid", "a2"), identity("alias", "list@x.invalid", "a2"), identity("other", "other@x.invalid", "a3")];
    const messages = [{ id: 5, folder: a1, recipients: ["Someone <LIST@x.invalid>"] }];
    assert.deepEqual(await forwarded_with({ identities, messages }), ["compose.beginForward 5 alias"]);
    assert.deepEqual(await forwarded_with({ identities, messages: [{ id: 5, folder: a1, recipients: ["a@b.invalid"], ccList: ["other@x.invalid"] }] }), ["compose.beginForward 5 other"]);
    assert.deepEqual(await forwarded_with({ identities, messages: [{ id: 5, folder: a1, bccList: ["main@x.invalid"] }] }), ["compose.beginForward 5 main"]);
});

test("an address that is an identity in two accounts resolves to the message's own account", async () => {
    const identities = [identity("other", "me@x.invalid", "a9"), identity("own", "me@x.invalid", "a1")];
    assert.deepEqual(await forwarded_with({ identities, messages: [{ id: 5, folder: a1, recipients: ["me@x.invalid"] }] }), ["compose.beginForward 5 own"]);
    assert.deepEqual(await forwarded_with({ identities, messages: [{ id: 5, folder: { accountId: "a3" }, recipients: ["me@x.invalid"] }] }), ["compose.beginForward 5 other"]);
});

test("with no addressed identity the message account's default identity wins", async () => {
    const identities = [identity("d", "d@x.invalid", "a9"), identity("first", "first@x.invalid", "a1"), identity("second", "second@x.invalid", "a1")];
    assert.deepEqual(await forwarded_with({ identities, default_account: { id: "a9" }, messages: [{ id: 5, folder: a1, recipients: ["nobody@x.invalid"] }] }), ["compose.beginForward 5 first"]);
});

test("a message in an account with no identity borrows the default account's default identity", async () => {
    const identities = [identity("d1", "d1@x.invalid", "a9"), identity("d2", "d2@x.invalid", "a9")];
    assert.deepEqual(await forwarded_with({ identities, default_account: { id: "a9" }, messages: [{ id: 5, folder: a1 }] }), ["compose.beginForward 5 d1"]);
    assert.deepEqual(await forwarded_with({ identities, default_account: { id: "a9" }, messages: [{ id: 5 }] }), ["compose.beginForward 5 d1"]);
});

test("with no default account, any identity serves", async () => {
    const identities = [identity("only", "o@x.invalid", "a5")];
    assert.deepEqual(await forwarded_with({ identities, default_account: null, messages: [{ id: 5, folder: a1 }] }), ["compose.beginForward 5 only"]);
});

test("reply and forward refuse only when no identity exists anywhere, and call nothing", async () => {
    for (const command of ["msg.forward", "msg.reply", "msg.new"]) {
        const { api, calls } = fake_api({ identities: [], messages: [{ id: 5, folder: a1 }] });
        await create_router(registry, api).run(invoke(command, command === "msg.reply" ? { to: "sender" } : {}, command === "msg.new" ? [] : [5]));
        assert.equal(calls.some((call) => call.startsWith("compose.")), false, command);
        assert.equal(notifications(calls).length, 1, command);
    }
});

test("msg.forward uses the identity of the newest message of a thread", async () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
    const identities = [identity("a", "a@x.invalid", "a1"), identity("b", "b@x.invalid", "a1")];
    const messages = [{ id: 5, date: at(1), folder: a1, recipients: ["a@x.invalid"] }, { id: 8, date: at(4), folder: a1, recipients: ["b@x.invalid"] }];
    assert.deepEqual(await forwarded_with({ identities, messages }, [5, 8]), ["compose.beginForward 8 b"]);
});

test("msg.new needs no selection and composes when any identity exists", async () => {
    const { api, calls } = fake_api({ default_account: { id: "a7" }, identities: [identity("i7", "i@x.invalid", "a7")] });
    await create_router(registry, api).run(invoke("msg.new", {}, []));
    assert.deepEqual(calls, ["identities.list", "accounts.getDefault", "identities.list a7", "compose.beginNew"]);
});

test("msg.move refuses a selection that spans accounts and moves nothing", async () => {
    const { api, calls } = fake_api({ folders: [{ id: "f1", accountId: "a1", path: "/Archive" }], messages: [{ id: 4, folder: a1 }, { id: 5, folder: { accountId: "a2" } }] });
    await create_router(registry, api).run(invoke("msg.move", { folder: "/Archive" }, [4, 5]));
    assert.equal(calls.some((call) => call.startsWith("messages.move") || call.startsWith("folders.query")), false);
    assert.match(notifications(calls)[0] ?? "", /more than one account/);
});

test("folder.read_all refuses in a saved search and works in a unified folder", async () => {
    const search = fake_api({ displayed: { id: "v1", accountId: "a1", path: "/Search", isVirtual: true } });
    await create_router(registry, search.api).run(invoke("folder.read_all", {}, []));
    assert.equal(search.calls.some((call) => call.startsWith("folders.markAsRead")), false);
    assert.match(notifications(search.calls)[0] ?? "", /saved search/);
    const unified = fake_api({ displayed: { id: "u1", accountId: "a1", path: "/Inbox", isVirtual: true, isUnified: true } });
    await create_router(registry, unified.api).run(invoke("folder.read_all", {}, []));
    assert.ok(unified.calls.includes("folders.markAsRead u1"));
});

test("a failure part way says how many messages changed", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] });
    api.messages.update = async (id, properties) => {
        if (id === 3) throw new Error("Message not found: 3.");
        calls.push(`messages.update ${id} ${JSON.stringify(properties)}`);
    };
    await create_router(registry, api).run(invoke("msg.flag", {}, [1, 2, 3, 4]));
    assert.deepEqual(updates(calls), ['messages.update 1 {"flagged":true}', 'messages.update 2 {"flagged":true}']);
    assert.match(notifications(calls)[0] ?? "", /Message not found: 3\..*2 of 4 messages changed/);
    const first = fake_api({ messages: [{ id: 1 }, { id: 2 }] });
    first.api.messages.update = () => Promise.reject(new Error("boom"));
    await create_router(registry, first.api).run(invoke("msg.flag", {}, [1, 2]));
    assert.doesNotMatch(notifications(first.calls)[0] ?? "", /changed/);
});

test("msg.junk says in its intent that it moves nothing", () => {
    assert.match(registry.get("msg.junk")?.intent ?? "", /without moving/);
});

test("every command of this group states bridge false", () => {
    for (const id of ["msg.read", "folder.read_all", "msg.flag", "msg.junk", "msg.tag", "msg.move", "msg.forward", "msg.new"]) assert.equal(registry.get(id)?.bridge, false, id);
});
