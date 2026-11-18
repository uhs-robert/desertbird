import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DRAFT_REFUSALS, SAVE_TIMEOUT_MS, create_bridge_drafts } from "../src/background/bridge/drafts.ts";
import type { DraftSettings, DraftsApi } from "../src/background/bridge/drafts.ts";
import { SETTING_DEFAULTS } from "../src/background/config/settings.ts";
import { fake_timers } from "./hud_fakes.ts";

const WORK = { id: "id1", email: "me@work.example" };
const HOME = { id: "id2", email: "me@home.example" };
const ORIGINAL = { id: 42, recipients: ["me@home.example"], folder: { accountId: "a2" } };

type Call = [string, ...unknown[]];

function drafts_under_test(options: { settings?: Partial<DraftSettings>; save_fails?: boolean; begin_fails?: boolean; tab?: { id?: number; windowId?: number }; remove_fails?: boolean; identities_fail?: boolean; hung_saves?: number; focused?: { id?: number; focused?: boolean } } = {}) {
    const calls: Call[] = [];
    const timers = fake_timers();
    let hung_saves = options.hung_saves ?? 0;
    const settings: DraftSettings = { bridge: true, bridge_allow_drafts: true, ...options.settings };
    const api = {
        accounts: { getDefault: async () => (calls.push(["accounts.getDefault"]), { id: "a1" }) },
        identities: { list: async (account_id?: string) => (calls.push(["identities.list", account_id]), options.identities_fail ? Promise.reject(new Error("me@work.example")) : account_id === "a1" ? [WORK] : account_id === "a2" ? [HOME] : [WORK, HOME]) },
        messages: { get: async (id: number) => (calls.push(["messages.get", id]), id === ORIGINAL.id ? ORIGINAL : null) },
        compose: {
            beginNew: async (...args: unknown[]) => {
                calls.push(["compose.beginNew", ...args]);
                if (options.begin_fails) throw new Error("beginNew failed: me@work.example");
                return options.tab ?? { id: 70, windowId: 9 };
            },
            beginReply: async (...args: unknown[]) => (calls.push(["compose.beginReply", ...args]), { id: 71, windowId: 10 }),
            saveMessage: async (...args: unknown[]) => {
                calls.push(["compose.saveMessage", ...args]);
                if (options.save_fails) throw new Error("compose.saveMessage failed: me@work.example");
                if (hung_saves > 0) {
                    hung_saves--;
                    return new Promise(() => {});
                }
                return { mode: "draft", messages: [{ id: 99, subject: "secret" }] };
            },
            // Present on the stub so a call to it would be seen. The drafts must never reach it.
            sendMessage: async (...args: unknown[]) => (calls.push(["compose.sendMessage", ...args]), {}),
        },
        windows: {
            getLastFocused: async () => (calls.push(["windows.getLastFocused"]), options.focused ?? { id: 1, focused: true }),
            remove: async (window_id: number) => {
                calls.push(["windows.remove", window_id]);
                if (options.remove_fails) throw new Error("Invalid window ID: 9");
            },
            update: async (window_id: number, properties: object) => void calls.push(["windows.update", window_id, properties]),
        },
    };
    const drafts = create_bridge_drafts({ api: api as unknown as DraftsApi, read_settings: async () => settings, timers });
    const compose_calls = () => calls.filter(([name]) => name.startsWith("compose."));
    return { draft: (request: Record<string, unknown>) => drafts.draft({ verb: "draft", request_id: 1, ...request }), calls, compose_calls, settings, timers };
}

const GOOD = { to: ["ann@example.org"], subject: "Bug report", body: "Steps\n1. open" };

test("bridge_allow_drafts defaults to off", () => {
    assert.equal(SETTING_DEFAULTS.bridge_allow_drafts, false);
});

test("with bridge or bridge_allow_drafts off the draft answers off and calls no API", async () => {
    for (const settings of [{ bridge: false }, { bridge_allow_drafts: false }]) {
        const { draft, calls } = drafts_under_test({ settings });
        assert.deepEqual(await draft(GOOD), { ok: false, message: "off" });
        assert.deepEqual(calls, []);
    }
});

test("the settings are read at each request, so a setting turned off refuses the next draft", async () => {
    const { draft, settings } = drafts_under_test();
    assert.deepEqual(await draft(GOOD), { ok: true });
    settings.bridge_allow_drafts = false;
    assert.deepEqual(await draft(GOOD), DRAFT_REFUSALS.off);
});

test("a good draft opens a plain-text compose, saves it as a draft, closes that window, gives the focus back and answers only ok", async () => {
    const { draft, calls } = drafts_under_test();
    assert.deepEqual(await draft({ ...GOOD, cc: ["bob@example.org"] }), { ok: true });
    const opened = calls.find(([name]) => name === "compose.beginNew")!;
    assert.deepEqual(opened, ["compose.beginNew", undefined, { to: ["ann@example.org"], cc: ["bob@example.org"], subject: "Bug report", plainTextBody: "Steps\n1. open", isPlainText: true, identityId: "id1" }]);
    assert.ok(!("body" in (opened[2] as object)), "the text never goes in as HTML");
    const tail = calls.slice(calls.indexOf(opened) + 1);
    assert.deepEqual(tail, [
        ["compose.saveMessage", 70, { mode: "draft" }],
        ["windows.remove", 9],
        ["windows.update", 1, { focused: true }],
    ]);
});

test("a failed save still closes the compose window it opened and answers fixed text", async () => {
    const { draft, calls } = drafts_under_test({ save_fails: true });
    const answer = await draft(GOOD);
    assert.deepEqual(answer, { ok: false, message: "the draft could not be saved" });
    assert.deepEqual(
        calls.filter(([name]) => name.startsWith("windows.remove")),
        [["windows.remove", 9]],
    );
});

test("the focus is not raised when no Thunderbird window had it", async () => {
    const { draft, calls } = drafts_under_test({ focused: { id: 1, focused: false } });
    await draft(GOOD);
    assert.ok(!calls.some(([name]) => name === "windows.update"));
});

test("nothing is ever sent: the stub send stays uncalled, the module never names it, and the add-on holds no send permission", async () => {
    const { draft, calls } = drafts_under_test();
    await draft(GOOD);
    await draft({ ...GOOD, to: [], reply_to_id: 42 });
    assert.ok(!calls.some(([name]) => name === "compose.sendMessage"));
    const source = readFileSync(new URL("../src/background/bridge/drafts.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /sendMessage|sendLater|sendNow/);
    const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8")) as { permissions: string[] };
    assert.ok(manifest.permissions.includes("compose.save"));
    assert.ok(!manifest.permissions.includes("compose.send"), "compose.send would let the add-on send mail");
});

test("bad fields are refused with fixed text before any compose call, and the text never echoes the request", async () => {
    const eleven = Array.from({ length: 11 }, (_, index) => `p${index}@example.org`);
    const cases: [Record<string, unknown>, object][] = [
        [{ ...GOOD, to: [] }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, to: eleven }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, cc: eleven }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, to: "ann@example.org" }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, bcc: ["eve@example.org"] }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, attachments: ["/etc/passwd"] }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, account: "a2" }, DRAFT_REFUSALS.bad_request],
        [{ to: GOOD.to, body: GOOD.body }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, reply_to_id: 1.5 }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, reply_to_id: "42" }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, from: 7 }, DRAFT_REFUSALS.bad_request],
        [{ ...GOOD, to: ["Eve <eve@example.org>"] }, DRAFT_REFUSALS.bad_address],
        [{ ...GOOD, to: ["ann@example.org, eve@example.org"] }, DRAFT_REFUSALS.bad_address],
        [{ ...GOOD, to: ["ann@localhost"] }, DRAFT_REFUSALS.bad_address],
        [{ ...GOOD, cc: ["eve@example.org\r\nBcc: x@example.org"] }, DRAFT_REFUSALS.bad_address],
        [{ ...GOOD, subject: "x".repeat(999) }, DRAFT_REFUSALS.bad_subject],
        [{ ...GOOD, subject: "Hi\r\nBcc: eve@example.org" }, DRAFT_REFUSALS.bad_subject],
        [{ ...GOOD, body: "x".repeat(64 * 1024 + 1) }, DRAFT_REFUSALS.body_too_long],
        [{ ...GOOD, body: "é".repeat(32 * 1024 + 1) }, DRAFT_REFUSALS.body_too_long],
    ];
    for (const [request, refusal] of cases) {
        const { draft, compose_calls } = drafts_under_test();
        const answer = await draft(request);
        assert.deepEqual(answer, refusal, JSON.stringify(request).slice(0, 80));
        assert.deepEqual(compose_calls(), []);
        for (const value of Object.values(request).flat()) if (typeof value === "string" && value.length > 3) assert.ok(!(answer as { message: string }).message.includes(value));
    }
});

test("the limits themselves pass: 10 recipients, 998 characters of subject and 64 KiB of body", async () => {
    const ten = Array.from({ length: 10 }, (_, index) => `p${index}@example.org`);
    const { draft } = drafts_under_test();
    assert.deepEqual(await draft({ to: ten, cc: ten, subject: "x".repeat(998), body: "x".repeat(64 * 1024) }), { ok: true });
});

test("format characters leave the subject and controls leave the body, but line breaks and tabs stay", async () => {
    const { draft, calls } = drafts_under_test();
    await draft({ ...GOOD, subject: "Re\u202eport", body: "a\r\nb\tc\u0007\u200b" });
    const details = calls.find(([name]) => name === "compose.beginNew")![2] as { subject: string; plainTextBody: string };
    assert.equal(details.subject, "Report");
    assert.equal(details.plainTextBody, "a\nb\tc");
});

test("from picks the identity with exactly that address, and an unknown one is refused before any compose call", async () => {
    const chosen = drafts_under_test();
    await chosen.draft({ ...GOOD, from: "me@home.example" });
    assert.equal((chosen.calls.find(([name]) => name === "compose.beginNew")![2] as { identityId: string }).identityId, "id2");
    const unknown = drafts_under_test();
    assert.deepEqual(await unknown.draft({ ...GOOD, from: "boss@work.example" }), { ok: false, message: "no such identity" });
    assert.deepEqual(unknown.compose_calls(), []);
    const near = drafts_under_test();
    assert.deepEqual(await near.draft({ ...GOOD, from: "ME@home.example" }), DRAFT_REFUSALS.no_such_identity);
});

test("a reply draft resolves the original, takes the identity it was addressed to, and keeps Thunderbird's recipients when to is empty", async () => {
    const { draft, calls } = drafts_under_test();
    assert.deepEqual(await draft({ ...GOOD, to: [], reply_to_id: 42 }), { ok: true });
    assert.deepEqual(calls.find(([name]) => name === "compose.beginReply"), ["compose.beginReply", 42, "replyToSender", { subject: "Bug report", plainTextBody: "Steps\n1. open", isPlainText: true, identityId: "id2" }]);
    assert.ok(calls.some(([name, id]) => name === "windows.remove" && id === 10));
});

test("a reply to a message that does not resolve is refused before any compose call", async () => {
    const { draft, compose_calls } = drafts_under_test();
    assert.deepEqual(await draft({ ...GOOD, reply_to_id: 7 }), { ok: false, message: "no such message" });
    assert.deepEqual(compose_calls(), []);
});

test("two drafts at once run one after the other, so each closes its own window before the next opens", async () => {
    const { draft, calls } = drafts_under_test();
    await Promise.all([draft(GOOD), draft(GOOD)]);
    const order = calls.filter(([name]) => name === "compose.beginNew" || name === "windows.remove").map(([name]) => name);
    assert.deepEqual(order, ["compose.beginNew", "windows.remove", "compose.beginNew", "windows.remove"]);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a save that never ends answers timed out after 30 s, leaves its window open and frees the next draft", async () => {
    const { draft, calls, timers } = drafts_under_test({ hung_saves: 1 });
    const first = draft(GOOD);
    const second = draft(GOOD);
    await settle();
    timers.advance(SAVE_TIMEOUT_MS - 1);
    await settle();
    assert.equal(calls.filter(([name]) => name === "compose.beginNew").length, 1, "the second waits for the first");
    timers.advance(1);
    assert.deepEqual(await first, { ok: false, message: "timed out" });
    assert.deepEqual(await second, { ok: true });
    assert.deepEqual(
        calls.filter(([name]) => name === "windows.remove"),
        [["windows.remove", 9]],
        "only the second draft's window closes",
    );
    assert.equal(calls.filter(([name]) => name === "windows.update").length, 1);
    assert.equal(timers.pending(), 0);
});

test("a beginNew that throws answers fixed text, closes nothing and frees the next draft", async () => {
    const { draft, calls } = drafts_under_test({ begin_fails: true });
    assert.deepEqual(await draft(GOOD), DRAFT_REFUSALS.not_saved);
    assert.ok(!calls.some(([name]) => name === "windows.remove" || name === "compose.saveMessage"));
    assert.deepEqual(await draft(GOOD), DRAFT_REFUSALS.not_saved, "the queue still runs the next draft");
    assert.equal(calls.filter(([name]) => name === "compose.beginNew").length, 2);
});

test("a window the user closed first still answers ok and gives the focus back", async () => {
    const { draft, calls } = drafts_under_test({ remove_fails: true });
    assert.deepEqual(await draft(GOOD), { ok: true });
    assert.ok(calls.some(([name]) => name === "windows.update"));
});

test("a compose tab with no id is not saved, and its window still closes", async () => {
    const { draft, calls } = drafts_under_test({ tab: { windowId: 12 } });
    assert.deepEqual(await draft(GOOD), DRAFT_REFUSALS.not_saved);
    assert.ok(!calls.some(([name]) => name === "compose.saveMessage"));
    assert.ok(calls.some(([name, id]) => name === "windows.remove" && id === 12));
});

test("an identity lookup that fails answers fixed text, not a missing identity", async () => {
    for (const from of [undefined, "me@work.example"]) {
        const { draft, compose_calls } = drafts_under_test({ identities_fail: true });
        assert.deepEqual(await draft({ ...GOOD, ...(from && { from }) }), { ok: false, message: "the identities could not be read" });
        assert.deepEqual(compose_calls(), []);
    }
});
