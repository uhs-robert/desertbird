import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeRefusal } from "../vendor/desertfox/command.ts";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { registry } from "../src/background/commands/index.ts";
import { open_message, plain_body, yank } from "../src/background/handlers/clipboard.ts";
import type { ClipboardScope, MessagePart } from "../src/background/handlers/clipboard.ts";

const MULTIPART: MessagePart = {
    contentType: "multipart/mixed",
    parts: [
        { contentType: "multipart/alternative", parts: [{ contentType: "text/plain", body: "Plain one." }, { contentType: "text/html", body: "<p>Html <b>one</b>.</p>" }] },
        { contentType: "text/plain", name: "notes.txt", body: "attachment text" },
        { contentType: "text/plain", body: "Plain two." },
    ],
};

function fake(parts: MessagePart = MULTIPART, message_ids = [4]) {
    const calls: string[] = [];
    const scope: ClipboardScope = {
        message_ids,
        window_id: 1,
        count: 1,
        api: {
            messages: {
                get: async (id) => (calls.push(`get ${id}`), { id, subject: "Hello", author: "Ann Lee <ann@example.org>", headerMessageId: "abc@example.org" }),
                getFull: async (id) => (calls.push(`getFull ${id}`), parts),
            },
            messengerUtilities: { convertToPlainText: async (html) => html.replace(/<[^>]*>/g, "") },
            messageDisplay: { open: async (properties) => (calls.push(`open ${properties.messageId} ${properties.location}`), undefined) },
        },
    };
    const written: string[] = [];
    return { scope, calls, written, write: async (text: string) => void written.push(text) };
}

test("each yank form writes its field", async () => {
    const expected = { content: "Plain one.\nPlain two.", subject: "Hello", sender: "Ann Lee <ann@example.org>", address: "ann@example.org", message_id: "abc@example.org" };
    for (const [field, text] of Object.entries(expected)) {
        const { scope, written, write } = fake();
        await yank(scope, { field }, write);
        assert.deepEqual(written, [text], field);
    }
});

const same_html = async (html: string) => html;

test("the body walk skips named parts and attached messages", async () => {
    assert.equal(await plain_body(MULTIPART, same_html), "Plain one.\nPlain two.");
    assert.equal(await plain_body({ contentType: "text/plain", name: "a.txt", body: "x" }, same_html), "");
    const with_eml: MessagePart = {
        contentType: "multipart/mixed",
        parts: [{ contentType: "message/rfc822", parts: [{ contentType: "text/plain", body: "forwarded body" }] }, { contentType: "text/plain", body: "real body" }],
    };
    assert.equal(await plain_body(with_eml, same_html), "real body");
    assert.equal(await plain_body({ contentType: "message/rfc822", parts: [with_eml] }, same_html), "real body");
    const only_eml: MessagePart = { contentType: "multipart/mixed", parts: [{ contentType: "message/rfc822", parts: [{ contentType: "text/plain", body: "forwarded body" }] }] };
    assert.equal(await plain_body(only_eml, same_html), "");
});

test("an empty plain part gives way to the html part, which goes through the converter", async () => {
    const root: MessagePart = { contentType: "multipart/alternative", parts: [{ contentType: "text/plain", body: " \n" }, { contentType: "text/html", body: "<p>Html body</p>" }] };
    const seen: string[] = [];
    assert.equal(await plain_body(root, async (html) => (seen.push(html), "converted")), "converted");
    assert.deepEqual(seen, ["<p>Html body</p>"]);
});

test("an address without angle brackets is the whole author", async () => {
    const { scope, written, write } = fake();
    scope.api.messages.get = async (id) => ({ id, subject: "s", author: "bare@example.org", headerMessageId: "m" });
    await yank(scope, { field: "address" }, write);
    assert.deepEqual(written, ["bare@example.org"]);
});

test("yank reads the first selected message and refuses an empty selection", async () => {
    const { scope, calls, write } = fake(MULTIPART, [9, 2]);
    await yank(scope, { field: "subject" }, write);
    assert.deepEqual(calls, ["get 9"]);
    const empty = fake(MULTIPART, []);
    await assert.rejects(yank(empty.scope, { field: "subject" }, empty.write), RuntimeRefusal);
    assert.deepEqual(empty.written, []);
});

test("yank content refuses a message with no text body and writes nothing", async () => {
    for (const parts of [{ contentType: "multipart/mixed", parts: [{ contentType: "application/pdf", name: "a.pdf" }] }, { contentType: "text/plain", body: "" }, { contentType: "text/html", body: "<p></p>" }] as MessagePart[]) {
        const { scope, written, write } = fake(parts);
        scope.api.messengerUtilities.convertToPlainText = async () => "  ";
        await assert.rejects(yank(scope, { field: "content" }, write), { message: /no text/ });
        assert.deepEqual(written, []);
    }
});

test("msg.open opens one message in a tab, refuses several and refuses none", async () => {
    const one = fake();
    await open_message(one.scope);
    assert.deepEqual(one.calls, ["open 4 tab"]);
    const several = fake(MULTIPART, [4, 5]);
    await assert.rejects(open_message(several.scope), { message: /one message/ });
    assert.deepEqual(several.calls, []);
    await assert.rejects(open_message(fake(MULTIPART, []).scope), RuntimeRefusal);
});

test("msg.yank takes only its fields", () => {
    const command = registry.get("msg.yank");
    assert.ok(command);
    assert.equal(check_args(command, { field: "subject" }).ok, true);
    assert.equal(check_args(command, {}).ok, true);
    assert.equal(check_args(command, { field: "date" }).ok, false);
});

test("the commands run through the registry with the scope the router builds", async () => {
    const { scope, written } = fake();
    const context = { tab_id: undefined, frame_id: 0, mode: "normal", ...scope };
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text: string) => void written.push(text) } }, configurable: true });
    try {
        await registry.get("msg.yank")!.run!(context as never, { field: "subject" });
    } finally {
        if (original) Object.defineProperty(globalThis, "navigator", original);
    }
    assert.deepEqual(written, ["Hello"]);
});
