import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BODY_BYTES, MAX_REPLY_BYTES, create_bridge_reads, cut_to_bytes } from "../src/background/bridge/reads.ts";
import type { ReadVerb, ReadsApi, ShareSettings } from "../src/background/bridge/reads.ts";
import { SETTING_DEFAULTS } from "../src/background/config/settings.ts";
import { fake_reads_api } from "./fake_api.ts";

const ALL_ON: ShareSettings = { bridge: true, bridge_share_headers: true, bridge_share_bodies: true, bridge_share_attachments: true, bridge_share_folders: true, bridge_share_contacts: true };

function reads_under_test(options: Parameters<typeof fake_reads_api>[0] = {}, settings: Partial<ShareSettings> = {}, address_books = true) {
    const { api, calls } = fake_reads_api(options);
    const current = { ...ALL_ON, ...settings };
    const reads = create_bridge_reads({ api: api as unknown as ReadsApi, read_settings: async () => current, address_books_granted: async () => (calls.push("permission"), address_books) });
    return { read: (verb: ReadVerb, request: Record<string, unknown> = {}) => reads.read(verb, request), calls, settings: current };
}

const INBOX = { id: "a1://INBOX", name: "Inbox", path: "/INBOX", accountId: "a1", unread: 2, total: 9 };
const header = (id: number, extra: object = {}) => ({ id, folder: INBOX.id, author: "Ann <ann@x.invalid>", subject: `Subject ${id}`, date: new Date(Date.UTC(2026, 0, id)), recipients: ["me@x.invalid"], ...extra });
const text_part = (body: string, type = "text/plain") => ({ contentType: "message/rfc822", parts: [{ contentType: type, body }] });

test("the five share settings default to off", () => {
    assert.deepEqual([SETTING_DEFAULTS.bridge, SETTING_DEFAULTS.bridge_share_headers, SETTING_DEFAULTS.bridge_share_bodies, SETTING_DEFAULTS.bridge_share_attachments, SETTING_DEFAULTS.bridge_share_folders, SETTING_DEFAULTS.bridge_share_contacts], [false, false, false, false, false, false]);
});

test("each read refuses while its setting is off and makes no API call", async () => {
    const cases: [ReadVerb, Partial<ShareSettings>, RegExp][] = [
        ["folders", { bridge_share_folders: false }, /bridge_share_folders/],
        ["messages", { bridge_share_headers: false }, /bridge_share_headers/],
        ["messages", { bridge_share_folders: false }, /bridge_share_folders/],
        ["message", { bridge_share_bodies: false }, /bridge_share_bodies/],
        ["message", { bridge_share_headers: false }, /bridge_share_headers/],
        ["attachments", { bridge_share_attachments: false }, /bridge_share_attachments/],
        ["contacts", { bridge_share_contacts: false }, /bridge_share_contacts/],
    ];
    for (const [verb, settings, pattern] of cases) {
        const { read, calls } = reads_under_test({ folders: [INBOX], headers: [header(1)] }, settings);
        const answer = await read(verb, { id: 1, folder: INBOX.id, query: "ann" });
        assert.equal(answer.ok, false, verb);
        assert.match((answer as { message: string }).message, pattern, verb);
        assert.deepEqual(calls, [], verb);
    }
});

test("every share setting is inert while bridge is off", async () => {
    for (const verb of ["folders", "messages", "message", "attachments", "contacts"] as const) {
        const { read, calls } = reads_under_test({ folders: [INBOX], headers: [header(1)] }, { bridge: false });
        assert.deepEqual(await read(verb, { id: 1, folder: INBOX.id, query: "ann" }), { ok: false, message: "the bridge is off, set bridge to true" });
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
    const answer = (await read("messages", { folder: INBOX.id, limit: 2 })) as unknown as { ok: true; messages: { id: number; folder: string }[]; truncated: boolean };
    assert.deepEqual(answer.messages, [
        { id: 3, from: "Ann <ann@x.invalid>", subject: "Subject 3", date: "2026-01-03T00:00:00.000Z", folder: "a1://INBOX", read: false, flagged: true },
        { id: 2, from: "Ann <ann@x.invalid>", subject: "Subject 2", date: "2026-01-02T00:00:00.000Z", folder: "a1://INBOX", read: true, flagged: false },
    ]);
    assert.equal(answer.truncated, true);
    assert.doesNotMatch(JSON.stringify(answer), /Inbox/);
});

test("messages with unread_only asks Thunderbird for unread mail only", async () => {
    const { read, calls } = reads_under_test({ folders: [INBOX], headers: [header(1), header(2, { read: true })] });
    const answer = (await read("messages", { folder: INBOX.id, unread_only: true })) as unknown as { messages: { id: number }[] };
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
        message: { id: 1, from: "Ann <ann@x.invalid>", to: ["b@x.invalid"], subject: "Hi there", date: "2026-01-01T00:00:00.000Z", content_type: "text/plain", body: "Line one\nLine two\tend", untrusted: true, html_stripped: false, truncated: false },
    });
    assert.ok(calls.includes('messages.getFull 1 {"decrypt":false}'));
});

test("an HTML-only message is converted to text by Thunderbird and marked html_stripped", async () => {
    const { read, calls } = reads_under_test({ headers: [header(1)], full: { 1: text_part('<p>Hello <a href="https://x.invalid/track">there</a></p>', "text/html") } });
    const answer = (await read("message", { id: 1 })) as unknown as { message: { body: string; html_stripped: boolean } };
    assert.equal(answer.message.body, "Hello there");
    assert.equal(answer.message.html_stripped, true);
    assert.ok(calls.includes("convertToPlainText"));
});

test("a body over 64 KiB of UTF-8 is cut at a code point and marked truncated", async () => {
    // Each emoji is a surrogate pair of four UTF-8 bytes. One leading byte puts the cut inside a pair.
    const { read } = reads_under_test({ headers: [header(1)], full: { 1: text_part(`a${"\u{1F600}".repeat(MAX_BODY_BYTES / 4 + 10)}`) } });
    const answer = (await read("message", { id: 1 })) as unknown as { message: { body: string; truncated: boolean } };
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
        "signed, then encrypted": { contentType: "message/rfc822", parts: [{ contentType: "multipart/signed", parts: [{ contentType: "application/pkcs7-mime; smime-type=enveloped-data" }, { contentType: "application/pkcs7-signature" }] }] },
        "inline PGP in an HTML part": text_part("<p>-----BEGIN PGP MESSAGE-----<br>hQEMA</p>", "text/html"),
        "skipped by Thunderbird": { contentType: "message/rfc822", decryptionStatus: "skipped", parts: [{ contentType: "text/plain", body: "x" }] },
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
    const rows = Array.from({ length: 200 }, (_, index) => header(index + 1, { subject: long, author: long }));
    const folder_id = `a1://${"é".repeat(1000)}`;
    const { read } = reads_under_test({ folders: [{ ...INBOX, id: folder_id }], headers: rows.map((row) => ({ ...row, folder: folder_id })) });
    const answer = await read("messages", { folder: folder_id, limit: 200 });
    assert.ok(new TextEncoder().encode(JSON.stringify(answer)).length <= MAX_REPLY_BYTES);
    assert.equal((answer as unknown as { truncated: boolean }).truncated, true);
});

test("a plain message under decrypt: false reports none and is returned", async () => {
    // Thunderbird marks the original tree "skipped" when it holds encrypted parts and "none" when it does not.
    const { read } = reads_under_test({ headers: [header(1)], full: { 1: { contentType: "message/rfc822", decryptionStatus: "none", parts: [{ contentType: "text/plain", body: "hello" }] } } });
    assert.equal(((await read("message", { id: 1 })) as unknown as { message: { body: string } }).message.body, "hello");
});

test("attachments of an encrypted message are refused before Thunderbird lists, and so decrypts, them", async () => {
    const { read, calls } = reads_under_test({ headers: [header(1)], full: { 1: { contentType: "message/rfc822", decryptionStatus: "skipped", parts: [{ contentType: "multipart/encrypted" }] } }, attachments: { 1: [{ name: "secret.pdf", partName: "1.2" }] } });
    assert.deepEqual(await read("attachments", { id: 1 }), { ok: false, message: "the message is encrypted, so its body never leaves Thunderbird" });
    assert.ok(calls.includes('messages.getFull 1 {"decrypt":false}'));
    assert.equal(calls.some((call) => call.startsWith("messages.listAttachments")), false);
});

test("messages finds the newest rows of the whole folder, however large", async () => {
    const rows = Array.from({ length: 25_000 }, (_, index) => ({ id: index + 1, folder: INBOX.id, date: new Date(Date.UTC(2020, 0, 1) + index * 60_000) }));
    const { read } = reads_under_test({ folders: [INBOX], headers: rows, page_size: 1000 });
    const answer = (await read("messages", { folder: INBOX.id, limit: 3 })) as unknown as { messages: { id: number }[]; truncated: boolean };
    assert.deepEqual(answer.messages.map((row) => row.id), [25_000, 24_999, 24_998]);
    assert.equal(answer.truncated, true);
});

const card = (extra: object = {}, properties: object = {}) => ({ id: "c1", parentId: "b1", type: "contact", readOnly: false, remote: false, vCard: "BEGIN:VCARD\nTEL:555\nEND:VCARD", properties: { DisplayName: "Ann Lee", PrimaryEmail: "ann@x.invalid", CellularNumber: "555", Notes: "secret", ...properties }, ...extra });

test("contacts leaves out remote (LDAP) books and searches the rest, with every flag spelled out", async () => {
    const { read, calls } = reads_under_test({ contacts: [card()] });
    await read("contacts", { query: "  ann   lee " });
    assert.deepEqual(calls.filter((call) => call !== "permission"), ['contacts.quickSearch {"searchString":"ann lee","includeLocal":true,"includeRemote":false,"includeReadOnly":true,"includeReadWrite":true}']);
});

test("contacts returns the name and bare addresses only, marked untrusted", async () => {
    const { read } = reads_under_test({ contacts: [card({}, { SecondEmail: "ann2@x.invalid" })] });
    assert.deepEqual(await read("contacts", { query: "ann" }), { ok: true, contacts: [{ name: "Ann Lee", emails: ["ann@x.invalid", "ann2@x.invalid"] }], untrusted: true, truncated: false });
});

test("contacts leaks no vCard, phone or note, and no photo or id", async () => {
    const { read } = reads_under_test({ contacts: [card()] });
    assert.doesNotMatch(JSON.stringify(await read("contacts", { query: "ann" })), /555|secret|VCARD|b1|c1/);
});

test("contacts drops a remote node, a mailing list and a card without a usable address", async () => {
    const { read } = reads_under_test({ contacts: [card({ remote: true }), card({ type: "mailingList" }), card({}, { PrimaryEmail: "" }), card({}, { PrimaryEmail: "Ann <ann@x.invalid>" }), card({}, { DisplayName: "Bo", PrimaryEmail: "bo@x.invalid" })] });
    assert.deepEqual(((await read("contacts", { query: "bo" })) as unknown as { contacts: unknown[] }).contacts, [{ name: "Bo", emails: ["bo@x.invalid"] }]);
});

test("contacts cleans control and bidi characters and falls back to first and last name", async () => {
    const { read } = reads_under_test({ contacts: [card({}, { DisplayName: "", FirstName: "A\u202Enn\u0007", LastName: "Lee", PrimaryEmail: "an\u200Bn@x.invalid" })] });
    assert.deepEqual(((await read("contacts", { query: "ann" })) as unknown as { contacts: unknown[] }).contacts, [{ name: "Ann Lee", emails: ["ann@x.invalid"] }]);
});

test("contacts returns at most 20 rows and says truncated", async () => {
    const many = Array.from({ length: 30 }, (_, index) => card({}, { DisplayName: `P${index}`, PrimaryEmail: `p${index}@x.invalid` }));
    const { read } = reads_under_test({ contacts: many });
    const answer = (await read("contacts", { query: "pp" })) as unknown as { contacts: unknown[]; truncated: boolean };
    assert.equal(answer.contacts.length, 20);
    assert.equal(answer.truncated, true);
    const fewer = (await read("contacts", { query: "pp", limit: 5 })) as unknown as { contacts: unknown[] };
    assert.equal(fewer.contacts.length, 5);
});

test("contacts refuses a short query with a fixed text and no search", async () => {
    for (const query of ["", " ", "a", " a ", "ann b", "a bc", "\u00e9"]) {
        const { read, calls } = reads_under_test({ contacts: [card()] });
        const answer = (await read("contacts", { query })) as { ok: boolean; message: string };
        assert.equal(answer.ok, false, JSON.stringify(query));
        assert.match(answer.message, /too short/, JSON.stringify(query));
        assert.ok(!calls.some((call) => call.startsWith("contacts.")), JSON.stringify(query));
        assert.doesNotMatch(answer.message, new RegExp(`"${query.trim()}"`));
    }
});

test("contacts counts characters, so two code points pass", async () => {
    const { read } = reads_under_test({ contacts: [card()] });
    assert.equal(((await read("contacts", { query: "\u{1F600}\u{1F600}" })) as { ok: boolean }).ok, true);
});

test("contacts refuses bad fields without a search", async () => {
    for (const request of [{}, { query: 5 }, { query: "x".repeat(101) }, { query: "an\nn" }, { query: "an\u202Eer" }, { query: "ab cd ef gh ij kl" }, { query: "ann", limit: 0 }, { query: "ann", limit: 21 }, { query: "ann", limit: 1.5 }, { query: "ann", limit: "2" }]) {
        const { read, calls } = reads_under_test({ contacts: [card()] });
        assert.deepEqual(await read("contacts", request), { ok: false, message: "the request has a missing or bad field" }, JSON.stringify(request));
        assert.ok(!calls.some((call) => call.startsWith("contacts.")));
    }
});

test("contacts refuses while the addressBooks permission is missing, and makes no search", async () => {
    const { read, calls } = reads_under_test({ contacts: [card()] }, {}, false);
    const answer = (await read("contacts", { query: "ann" })) as { ok: boolean; message: string };
    assert.equal(answer.ok, false);
    assert.match(answer.message, /addressBooks permission is not granted.*bridge_share_contacts/);
    assert.deepEqual(calls, ["permission"]);
});

test("contacts checks the permission at each request", async () => {
    const { api } = fake_reads_api({ contacts: [card()] });
    let granted = true;
    const reads = create_bridge_reads({ api: api as unknown as ReadsApi, read_settings: async () => ALL_ON, address_books_granted: async () => granted });
    assert.equal((await reads.read("contacts", { query: "ann" })).ok, true);
    granted = false;
    assert.equal((await reads.read("contacts", { query: "ann" })).ok, false);
});

test("contacts answers a fixed refusal when the search throws", async () => {
    const { api } = fake_reads_api();
    api.contacts.quickSearch = async () => {
        throw new Error("secret detail ann");
    };
    const reads = create_bridge_reads({ api: api as unknown as ReadsApi, read_settings: async () => ALL_ON, address_books_granted: async () => true });
    assert.deepEqual(await reads.read("contacts", { query: "ann" }), { ok: false, message: "the address book could not be searched" });
});
