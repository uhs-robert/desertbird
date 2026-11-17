import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { choose_target, parse_list_unsubscribe } from "../src/background/list_unsubscribe.ts";
import type { MailtoTarget } from "../src/background/list_unsubscribe.ts";
import { CONFIRM_WINDOW_MS, unsubscribe } from "../src/background/handlers/unsubscribe.ts";
import { create_router } from "../src/background/router.ts";
import { fake_api } from "./fake_api.ts";

test("the parser reads angle brackets, several URIs, comments and folding", () => {
    const parsed = parse_list_unsubscribe("(comment <http://evil.invalid/>) <mailto:leave@list.invalid?subject=unsub>,\r\n <https://list.invalid/u?id=1>");
    assert.deepEqual(parsed.map((target) => target.kind), ["mailto", "https"]);
    assert.equal(parsed[1]!.host, "list.invalid");
});

test("the parser drops every scheme but https and mailto", () => {
    for (const uri of ["http://list.invalid/u", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://list.invalid/", "HTTP://list.invalid/", "//list.invalid/u", "list.invalid/u"]) {
        assert.deepEqual(parse_list_unsubscribe(`<${uri}>`), [], uri);
    }
});

test("the parser keeps a mixed-case scheme and a punycode host shows its real form", () => {
    const [target] = parse_list_unsubscribe("<HTTPS://bücher.invalid/u>");
    assert.equal(target?.host, "xn--bcher-kva.invalid");
});

test("the parser rejects malformed headers and unsafe URIs", () => {
    for (const header of ["", "https://list.invalid/u", "<https://list.invalid/u", "<https://list.invalid/u> junk", "(unclosed <https://list.invalid/u>", "<https://user:pw@list.invalid/u>", "<https://>", "<https://list.invalid/a b>", "<https://list.invalid/\u0001>", `<https://list.invalid/${"a".repeat(3000)}>`, "<mailto:>", "<mailto:not-an-address>", "<mailto:a@b.invalid,%0Abcc:x@y.invalid>", "<mailto:%ZZ@b.invalid>"]) {
        assert.deepEqual(parse_list_unsubscribe(header), [], header);
    }
});

test("a mailto reads recipient, subject and body only", () => {
    const [target] = parse_list_unsubscribe("<mailto:leave@list.invalid?subject=Unsub%0D%0Ame&body=Please+remove&cc=spy@x.invalid&bcc=spy@x.invalid&x-header=1>") as MailtoTarget[];
    assert.deepEqual({ ...target }, { kind: "mailto", to: ["leave@list.invalid"], subject: "Unsub me", body: "Please+remove", host: "list.invalid" });
});

test("choice prefers a mailto draft and falls back to https", () => {
    assert.equal(choose_target(parse_list_unsubscribe("<https://a.invalid/u>, <mailto:x@a.invalid>"))?.kind, "mailto");
    assert.equal(choose_target(parse_list_unsubscribe("<https://a.invalid/u>, <https://b.invalid/u>"))?.host, "a.invalid");
    assert.equal(choose_target([]), undefined);
});

const HTTPS_MAIL = { 5: { "list-unsubscribe": ["<https://list.invalid/u?id=1>"], "list-unsubscribe-post": ["List-Unsubscribe=One-Click"] } };
const MAILTO_MAIL = { 5: { "List-Unsubscribe": ["<mailto:leave@list.invalid?subject=unsub&body=bye>"] } };
const invoke = (ids: number[]) => ({ command: "msg.unsubscribe", args: {}, windowId: 1, messageIds: ids, count: 1 });
const effects = (calls: string[]) => calls.filter((call) => /^(windows\.|compose\.|notify )/.test(call));

test("the first press previews the host and opens nothing", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 5, headerMessageId: "m5" }], headers: HTTPS_MAIL });
    await create_router(registry, api).run(invoke([5]));
    assert.deepEqual(effects(calls), ["notify Unsubscribe: press g u again to open list.invalid in your browser."]);
});

test("the second press opens the https page in the default browser and nothing else", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 5, headerMessageId: "m5" }], headers: HTTPS_MAIL });
    const router = create_router(registry, api);
    await router.run(invoke([5]));
    await router.run(invoke([5]));
    assert.deepEqual(effects(calls).slice(1), ["windows.openDefaultBrowser https://list.invalid/u?id=1"]);
    assert.equal(calls.some((call) => /^messages\.(archive|move|delete|update)/.test(call)), false);
    await router.run(invoke([5]));
    assert.equal(effects(calls).filter((call) => call.startsWith("windows.")).length, 1, "a third press previews again");
});

test("the second press of a mailto opens a prefilled draft with the identity that received the mail", async () => {
    const identities = [{ id: "first", email: "first@x.invalid", account_id: "a1" }, { id: "mine", email: "mine@x.invalid", account_id: "a1" }];
    const { api, calls } = fake_api({ identities, messages: [{ id: 5, headerMessageId: "m5", recipients: ["Me <mine@x.invalid>"], folder: { accountId: "a1" } }], headers: MAILTO_MAIL });
    const router = create_router(registry, api);
    await router.run(invoke([5]));
    assert.match(effects(calls)[0]!, /write a draft to leave@list\.invalid\. You send it yourself/);
    await router.run(invoke([5]));
    assert.deepEqual(effects(calls).slice(1), [`compose.beginNew ${JSON.stringify({ to: ["leave@list.invalid"], subject: "unsub", plainTextBody: "bye", isPlainText: true, identityId: "mine" })}`]);
    assert.equal(calls.some((call) => /^(messages|compose)\.send/.test(call)), false);
});

test("a press on another message starts a new preview", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 5, headerMessageId: "m5" }, { id: 6, headerMessageId: "m6" }], headers: { ...HTTPS_MAIL, 6: HTTPS_MAIL[5] } });
    const router = create_router(registry, api);
    await router.run(invoke([5]));
    await router.run(invoke([6]));
    assert.equal(effects(calls).some((call) => call.startsWith("windows.")), false);
});

test("a second press after the window has passed previews again", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 5, headerMessageId: "m5" }], headers: HTTPS_MAIL });
    const scope = { api, window_id: 1, message_ids: [5], count: 1 };
    let clock = 1000;
    await unsubscribe(scope, {}, () => clock);
    clock += CONFIRM_WINDOW_MS + 1;
    await unsubscribe(scope, {}, () => clock);
    assert.equal(effects(calls).some((call) => call.startsWith("windows.")), false);
    clock += CONFIRM_WINDOW_MS;
    await unsubscribe(scope, {}, () => clock);
    assert.equal(effects(calls).filter((call) => call.startsWith("windows.")).length, 1);
});

test("refusals call nothing: no header, only unsafe links, no selection, several messages", async () => {
    const cases: [string, Record<number, Record<string, string[]>>, number[]][] = [
        ["no header", { 5: { subject: ["x"] } }, [5]],
        ["unsafe link only", { 5: { "list-unsubscribe": ["<http://list.invalid/u>, <javascript:alert(1)>"] } }, [5]],
        ["no selection", HTTPS_MAIL, []],
        ["several", HTTPS_MAIL, [5, 6]],
    ];
    for (const [name, headers, ids] of cases) {
        const { api, calls } = fake_api({ messages: [{ id: 5 }, { id: 6 }], headers });
        const router = create_router(registry, api);
        await router.run(invoke(ids));
        await router.run(invoke(ids));
        assert.equal(effects(calls).filter((call) => !call.startsWith("notify ")).length, 0, name);
        assert.equal(effects(calls).length, 2, name);
        assert.equal(calls.some((call) => call.startsWith("storage.set")), false, name);
    }
});

test("msg.unsubscribe takes no argument and is not replayed by dot", () => {
    const command = registry.get("msg.unsubscribe");
    assert.equal(command?.bridge, false);
    assert.equal(command?.params, undefined);
});

test("a plus is a literal plus, and a to field adds a recipient", () => {
    const [target] = parse_list_unsubscribe("<mailto:a@list.invalid?to=leave+tok@list.invalid&subject=unsub+AbC>") as MailtoTarget[];
    assert.deepEqual(target?.to, ["a@list.invalid", "leave+tok@list.invalid"]);
    assert.equal(target?.subject, "unsub+AbC");
});

test("a mailto with a format character is dropped and a look-alike domain shows as punycode", () => {
    for (const uri of ["mailto:x%E2%80%AE@list.invalid", "mailto:x@list%E2%80%8B.invalid", "mailto:x@list.invalid?to=y%C2%85@list.invalid"]) assert.deepEqual(parse_list_unsubscribe(`<${uri}>`), [], uri);
    const [target] = parse_list_unsubscribe("<mailto:leave@\u0430pple.invalid>") as MailtoTarget[];
    assert.deepEqual({ to: target?.to, host: target?.host }, { to: ["leave@xn--pple-43d.invalid"], host: "xn--pple-43d.invalid" });
});

test("the mailto draft is plain text, so list markup is never HTML", async () => {
    const markup = { 5: { "list-unsubscribe": ["<mailto:leave@list.invalid?body=%3Cimg%20src%3Dhttps%3A%2F%2Ft.invalid%2Fp%3E>"] } };
    const { api, calls } = fake_api({ messages: [{ id: 5, headerMessageId: "m5" }], headers: markup });
    const router = create_router(registry, api);
    await router.run(invoke([5]));
    await router.run(invoke([5]));
    const draft = JSON.parse(calls.find((call) => call.startsWith("compose.beginNew "))!.slice("compose.beginNew ".length));
    assert.equal(draft.isPlainText, true);
    assert.equal(draft.plainTextBody, "<img src=https://t.invalid/p>");
    assert.equal("body" in draft, false);
});

test("presses that overlap act once", async () => {
    const { api, calls } = fake_api({ messages: [{ id: 5, headerMessageId: "m5" }], headers: HTTPS_MAIL });
    const router = create_router(registry, api);
    await router.run(invoke([5]));
    await Promise.all([router.run(invoke([5])), router.run(invoke([5])), router.run(invoke([5]))]);
    assert.equal(calls.filter((call) => call.startsWith("windows.openDefaultBrowser")).length, 1);
});
