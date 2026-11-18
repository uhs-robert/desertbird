import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BODY_BYTES, MAX_REPLY_BYTES, create_bridge_reads, cut_to_bytes } from "../src/background/bridge/reads.ts";
import type { ReadVerb, ReadsApi, ShareSettings } from "../src/background/bridge/reads.ts";
import { SETTING_DEFAULTS } from "../src/background/config/settings.ts";
import { fake_reads_api } from "./fake_api.ts";

const ALL_ON: ShareSettings = { bridge: true, bridge_share_headers: true, bridge_share_bodies: true, bridge_share_attachments: true, bridge_share_folders: true };

function reads_under_test(options: Parameters<typeof fake_reads_api>[0] = {}, settings: Partial<ShareSettings> = {}) {
    const { api, calls } = fake_reads_api(options);
    const current = { ...ALL_ON, ...settings };
    const reads = create_bridge_reads({ api: api as unknown as ReadsApi, read_settings: async () => current });
    return { read: (verb: ReadVerb, request: Record<string, unknown> = {}) => reads.read(verb, request), calls, settings: current };
}

const INBOX = { id: "a1://INBOX", name: "Inbox", path: "/INBOX", accountId: "a1", unread: 2, total: 9 };
const header = (id: number, extra: object = {}) => ({ id, folder: INBOX.id, author: "Ann <ann@x.invalid>", subject: `Subject ${id}`, date: new Date(Date.UTC(2026, 0, id)), recipients: ["me@x.invalid"], ...extra });
const text_part = (body: string, type = "text/plain") => ({ contentType: "message/rfc822", parts: [{ contentType: type, body }] });

test("the four share settings default to off", () => {
    assert.deepEqual([SETTING_DEFAULTS.bridge, SETTING_DEFAULTS.bridge_share_headers, SETTING_DEFAULTS.bridge_share_bodies, SETTING_DEFAULTS.bridge_share_attachments, SETTING_DEFAULTS.bridge_share_folders], [false, false, false, false, false]);
});

test("each read refuses while its setting is off and makes no API call", async () => {
    const cases: [ReadVerb, Partial<ShareSettings>, RegExp][] = [
        ["folders", { bridge_share_folders: false }, /bridge_share_folders/],
        ["messages", { bridge_share_headers: false }, /bridge_share_headers/],
        ["message", { bridge_share_bodies: false }, /bridge_share_bodies/],
        ["message", { bridge_share_headers: false }, /bridge_share_headers/],
        ["attachments", { bridge_share_attachments: false }, /bridge_share_attachments/],
    ];
    for (const [verb, settings, pattern] of cases) {
        const { read, calls } = reads_under_test({ folders: [INBOX], headers: [header(1)] }, settings);
        const answer = await read(verb, { id: 1, folder: INBOX.id });
        assert.equal(answer.ok, false, verb);
        assert.match((answer as { message: string }).message, pattern, verb);
        assert.deepEqual(calls, [], verb);
    }
});

test("every share setting is inert while bridge is off", async () => {
    for (const verb of ["folders", "messages", "message", "attachments"] as const) {
        const { read, calls } = reads_under_test({ folders: [INBOX], headers: [header(1)] }, { bridge: false });
        assert.deepEqual(await read(verb, { id: 1, folder: INBOX.id }), { ok: false, message: "the bridge is off, set bridge to true" });
        assert.deepEqual(calls, []);
    }
});

test("the settings are read at each request, so a setting turned off refuses the next read", async () => {
    const { read, settings } = reads_under_test({ folders: [INBOX] });
    assert.equal((await read("folders")).ok, true);
    settings.bridge_share_folders = false;
    assert.equal((await read("folders")).ok, false);
});

test("folders lists id, name, path, account and counts, and skips account roots", async () => {
    const { read } = reads_under_test({ folders: [{ id: "a1://", path: "/", accountId: "a1", isRoot: true }, { ...INBOX, name: "In​box\u0007" }] });
    assert.deepEqual(await read("folders"), { ok: true, folders: [{ id: "a1://INBOX", name: "Inbox", path: "/INBOX", account: "Work", unread: 2, total: 9 }], truncated: false });
});

test("messages gives the newest rows first with the opaque folder id, never its name", async () => {
    const { read } = reads_under_test({ folders: [INBOX], headers: [header(1), header(3, { flagged: true }), header(2, { read: true })], page_size: 1 });
    const answer = (await read("messages", { folder: INBOX.id, limit: 2 })) as { ok: true; messages: { id: number; folder: string }[]; truncated: boolean };
    assert.deepEqual(answer.messages, [
        { id: 3, from: "Ann <ann@x.invalid>", subject: "Subject 3", date: "2026-01-03T00:00:00.000Z", folder: "a1://INBOX", read: false, flagged: true },
        { id: 2, from: "Ann <ann@x.invalid>", subject: "Subject 2", date: "2026-01-02T00:00:00.000Z", folder: "a1://INBOX", read: true, flagged: false },
    ]);
    assert.equal(answer.truncated, true);
    assert.doesNotMatch(JSON.stringify(answer), /Inbox/);
});

test("messages with unread_only asks Thunderbird for unread mail only", async () => {
    const { read, calls } = reads_under_test({ folders: [INBOX], headers: [header(1), header(2, { read: true })] });
    const answer = (await read("messages", { folder: INBOX.id, unread_only: true })) as { messages: { id: number }[] };
    assert.deepEqual(answer.messages.map((row) => row.id), [1]);
    assert.ok(calls.includes('messages.query {"folderId":"a1://INBOX","unread":true}'));
});

test("bad fields are refused before any API call, with fixed text", async () => {
    const bad: [ReadVerb, Record<string, unknown>][] = [
        ["messages", {}],
        ["messages", { folder: 7 }],
        ["messages", { folder: "x".repeat(1025) }],
        ["messages", { folder: INBOX.id, limit: 0 }],
        ["messages", { folder: INBOX.id, limit: 201 }],
        ["messages", { folder: INBOX.id, limit: 2.5 }],
        ["messages", { folder: INBOX.id, unread_only: "yes" }],
        ["message", { id: "12" }],
        ["message", { id: 1.5 }],
        ["message", { id: -1 }],
        ["attachments", {}],
    ];
    for (const [verb, request] of bad) {
        const { read, calls } = reads_under_test({ folders: [INBOX], headers: [header(1)] });
        assert.deepEqual(await read(verb, request), { ok: false, message: "the request has a missing or bad field" }, JSON.stringify(request));
        assert.deepEqual(calls, []);
    }
});

test("an unknown id is a fixed refusal that does not echo the caller's text", async () => {
    const { read } = reads_under_test({ folders: [INBOX], headers: [header(1)] });
    assert.deepEqual(await read("messages", { folder: "a1://<script>" }), { ok: false, message: "no such folder" });
    assert.deepEqual(await read("message", { id: 999 }), { ok: false, message: "no such message" });
    assert.deepEqual(await read("attachments", { id: 999 }), { ok: false, message: "no such message" });
});

test("a message comes back as untrusted, cleaned text, with its encryption kept on", async () => {
    const { read, calls } = reads_under_test({ headers: [header(1, { subject: "Hi‮\u0000 there", author: "Ann‍ <ann@x.invalid>", recipients: ["b@x.invalid\u0007"] })], full: { 1: text_part("Line one\r\nLine​ two\u0001\tend") } });
    assert.deepEqual(await read("message", { id: 1 }), {
        ok: true,
        message: { id: 1, from: "Ann <ann@x.invalid>", to: ["b@x.invalid"], subject: "Hi there", date: "2026-01-01T00:00:00.000Z", content_type: "message/rfc822", body: "Line one\nLine two\tend", untrusted: true, html_stripped: false, truncated: false },
    });
    assert.ok(calls.includes('messages.getFull 1 {"decrypt":false}'));
});

test("an HTML-only message is converted to text by Thunderbird and marked html_stripped", async () => {
    const { read, calls } = reads_under_test({ headers: [header(1)], full: { 1: text_part('<p>Hello <a href="https://x.invalid/track">there</a></p>', "text/html") } });
    const answer = (await read("message", { id: 1 })) as { message: { body: string; html_stripped: boolean } };
    assert.equal(answer.message.body, "Hello there");
    assert.equal(answer.message.html_stripped, true);
    assert.ok(calls.includes("convertToPlainText"));
});

test("a body over 64 KiB of UTF-8 is cut at a code point and marked truncated", async () => {
    // Each emoji is a surrogate pair of four UTF-8 bytes. One leading byte puts the cut inside a pair.
    const { read } = reads_under_test({ headers: [header(1)], full: { 1: text_part(`a${"\u{1F600}".repeat(MAX_BODY_BYTES / 4 + 10)}`) } });
    const answer = (await read("message", { id: 1 })) as { message: { body: string; truncated: boolean } };
    assert.equal(answer.message.truncated, true);
    assert.ok(new TextEncoder().encode(answer.message.body).length <= MAX_BODY_BYTES);
    assert.doesNotMatch(answer.message.body, /[\ud800-\udbff]$/, "no lone high surrogate at the end");
    assert.deepEqual(cut_to_bytes("a\u{1F600}", 3), { text: "a", cut: true });
});

test("an encrypted message is refused, never returned, for each kind of encryption", async () => {
    const encrypted: Record<string, object> = {
        "multipart/encrypted": { contentType: "message/rfc822", parts: [{ contentType: "multipart/encrypted; protocol=\"application/pgp-encrypted\"", parts: [] }] },
        "application/pkcs7-mime": { contentType: "message/rfc822", parts: [{ contentType: "application/pkcs7-mime; smime-type=enveloped-data" }] },
        "application/pgp-encrypted": { contentType: "message/rfc822", parts: [{ contentType: "multipart/mixed", parts: [{ contentType: "application/pgp-encrypted", body: "Version: 1" }] }] },
        "inline PGP": text_part("Hi\n-----BEGIN PGP MESSAGE-----\nhQEMA...\n-----END PGP MESSAGE-----"),
        "decrypted by Thunderbird": { contentType: "message/rfc822", decryptionStatus: "success", parts: [{ contentType: "text/plain", body: "secret" }] },
    };
    for (const [kind, full] of Object.entries(encrypted)) {
        const { read } = reads_under_test({ headers: [header(1)], full: { 1: full } });
        assert.deepEqual(await read("message", { id: 1 }), { ok: false, message: "the message is encrypted, so its body never leaves Thunderbird" }, kind);
    }
});

test("attachments give cleaned names and sizes, never bytes", async () => {
    const { read, calls } = reads_under_test({ headers: [header(1)], attachments: { 1: [{ name: "inv‮oice.exe/../x", partName: "1.2", size: 1200, contentType: "application/pdf" }] } });
    assert.deepEqual(await read("attachments", { id: 1 }), { ok: true, attachments: [{ part: "1.2", name: "inv_oice.exe_.._x", size: 1200, content_type: "application/pdf" }], truncated: false });
    assert.equal(calls.some((call) => call.startsWith("messages.getAttachmentFile")), false);
});

test("200 rows of the longest fields stay under the reply cap", async () => {
    const long = "\u{1F600}".repeat(5000);
    const rows = Array.from({ length: 250 }, (_, index) => header(index + 1, { subject: long, author: long }));
    const folder_id = `a1://${"é".repeat(1000)}`;
    const { read } = reads_under_test({ folders: [{ ...INBOX, id: folder_id }], headers: rows.map((row) => ({ ...row, folder: folder_id })) });
    const answer = await read("messages", { folder: folder_id, limit: 200 });
    assert.ok(new TextEncoder().encode(JSON.stringify(answer)).length <= MAX_REPLY_BYTES);
    assert.equal((answer as { truncated: boolean }).truncated, true);
});
