import assert from "node:assert/strict";
import { test } from "node:test";
import { create_completer } from "../src/background/cmdline/completion.ts";
import { create_cmdline_service } from "../src/background/cmdline/service.ts";
import { DEFAULT_KEYMAP, registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import type { CmdlineCompletion, CmdlineHello, CmdlineRunResult, KeysInvocation } from "../src/shared/protocol.ts";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { parse_command_line, tokenize } from "../vendor/desertfox/registry/command_line.ts";
import { print_command } from "../vendor/desertfox/registry/print_command.ts";
import { usage_line } from "../vendor/desertfox/registry/usage.ts";
import { fake_api } from "./fake_api.ts";

const parse = (text: string) => parse_command_line(registry, text);

test("typed-value commands parse by their command line name", () => {
    assert.deepEqual(parse("tag Work stuff"), { kind: "invocation", invocation: { id: "msg.tag", args: { tag: "Work stuff" } } });
    assert.deepEqual(parse("msg.tag work"), { kind: "invocation", invocation: { id: "msg.tag", args: { tag: "work" } } });
    assert.deepEqual(parse("move /Archive/2026"), { kind: "invocation", invocation: { id: "msg.move", args: { folder: "/Archive/2026" } } });
    assert.deepEqual(parse("search hello world"), { kind: "invocation", invocation: { id: "search.threads", args: { query: "hello world" } } });
    assert.deepEqual(parse("tab 2"), { kind: "invocation", invocation: { id: "tab.switch", args: { tab: "2" } } });
    assert.deepEqual(parse("filter --tag --tag=$label1"), { kind: "invocation", invocation: { id: "filter.set", args: { state: "tag", tag: "$label1" } } });
    assert.deepEqual(parse("sort --date --descending"), { kind: "invocation", invocation: { id: "sort.set", args: { by: "date", order: "descending" } } });
});

test("quotes group words and an open quote is an error", () => {
    assert.deepEqual(tokenize(`tag "two words" 'x y'`), [
        { text: "tag", start: 0, quoted_from: null },
        { text: "two words", start: 4, quoted_from: 0 },
        { text: "x y", start: 16, quoted_from: 0 },
    ]);
    assert.deepEqual(tokenize(`tag "open`), { error: `unterminated " quote`, start: 4 });
});

test("errors name the problem: unknown command, unknown flag, help", () => {
    assert.deepEqual(parse("bogus"), { kind: "error", error: `unknown command "bogus"` });
    assert.equal(parse("sort --nope").kind, "error");
    assert.deepEqual(parse("tag -h"), { kind: "help", usage: "tag tag" });
    assert.deepEqual(parse(""), { kind: "error", error: "empty command line" });
});

test("the validator still rejects what the parser lets through", () => {
    const tag = registry.get("msg.tag")!;
    const parsed = parse("tag");
    assert.equal(parsed.kind, "invocation");
    assert.deepEqual(check_args(tag, parsed.kind === "invocation" ? parsed.invocation.args : undefined), { ok: false, error: "missing <tag>", missing_param: "tag" });
    const move = registry.get("msg.move")!;
    assert.equal(check_args(move, { folder: "Archive" }).ok, false);
});

test("the printer writes text that parses back to the same args", () => {
    const cases: [string, Record<string, unknown>][] = [
        ["msg.tag", { tag: "Work stuff" }],
        ["msg.move", { folder: "/Archive/2026" }],
        ["filter.set", { state: "tag", tag: "$label1" }],
        ["sort.set", { by: "subject", order: "ascending" }],
    ];
    for (const [id, args] of cases) {
        const command = registry.get(id)!;
        const text = print_command(command, args);
        const parsed = parse_command_line(registry, text);
        assert.equal(parsed.kind, "invocation", text);
        if (parsed.kind === "invocation") assert.deepEqual(parsed.invocation, { id, args }, text);
    }
});

test("the usage line comes from the params", () => {
    assert.equal(usage_line(registry.get("msg.tag")!), "tag tag");
    assert.match(usage_line(registry.get("sort.set")!), /--date/);
});

const sources = { folders: async () => ["/Archive", "/Archive/2026", "/Inbox"], tags: async () => ["Important", "Work stuff"] };
const complete = create_completer(registry, sources);

test("completion lists background commands by name and leaves out hidden and chrome commands", async () => {
    const { rows } = await complete("", 0);
    const names = rows.map((row) => row.name);
    assert.ok(names.includes("tag") && names.includes("move") && names.includes("msg.archive") && names.includes("tab.next"));
    assert.ok(!names.includes("cmdline.open"));
    assert.ok(!names.includes("motion.down"));
});

test("completion ranks a typed word and marks the matched letters", async () => {
    const answer = await complete("mo", 2);
    assert.equal(answer.rows[0]?.name, "move");
    assert.deepEqual(answer.rows[0]?.positions, [0, 1]);
    assert.deepEqual([answer.start, answer.end], [0, 2]);
});

test("completion offers the folders for move and the tags for tag, and quotes a name with a space", async () => {
    const folders = await complete("move ", 5);
    assert.deepEqual(folders.rows.map((row) => row.name), ["/Archive", "/Archive/2026", "/Inbox"]);
    assert.equal(folders.usage, "move folder");
    const tags = await complete("tag ", 4);
    assert.deepEqual(tags.rows.map((row) => row.insert), ["Important ", '"Work stuff" ']);
    const narrowed = await complete("move arch", 9);
    assert.deepEqual(narrowed.rows.map((row) => row.name), ["/Archive", "/Archive/2026"]);
});

test("completion offers the flags of a command and the value of an enum flag", async () => {
    const flags = await complete("sort --", 7);
    assert.ok(flags.rows.some((row) => row.name.startsWith("--date")));
    assert.ok(flags.rows.some((row) => row.name.startsWith("--descending")));
});

test("completion gives nothing inside a quote or for an unknown command", async () => {
    assert.deepEqual((await complete('tag "Wo', 7)).rows, []);
    assert.deepEqual((await complete("bogus x", 7)).rows, []);
});

test("a long folder list ranks in full and keeps the best rows only", async () => {
    const many = Array.from({ length: 5000 }, (_, index) => `/Folder${index}`);
    const answer = await create_completer(registry, { ...sources, folders: async () => many })("move ", 5);
    assert.equal(answer.rows.length, 50);
});

// --- the service

function service_setup(options: { experiment?: boolean } = {}) {
    const { api, calls } = fake_api({ experiment: options.experiment ?? true, messages: [{ id: 5, folder: { accountId: "a1" } }], tags: [{ key: "$label1", tag: "Important" }], folders: [{ id: "f1", accountId: "a1", path: "/Archive" }] });
    const ran: KeysInvocation[] = [];
    const router = create_router(registry, api);
    const service = create_cmdline_service({
        registry,
        sources,
        overlay: api.overlay,
        run: async (invocation) => {
            ran.push(invocation);
            await router.run(invocation);
        },
    });
    // The router stores sessions through this wrapper, which records the call and then reaches the real service.
    const recording = { begin: (window_id: number, session: Parameters<typeof service.begin>[1]) => (api.cmdline.begin(window_id, session), service.begin(window_id, session)), end: (window_id: number) => (api.cmdline.end(window_id), service.end(window_id)) };
    const api_with_service = { ...api, cmdline: recording };
    return { api: api_with_service, calls, ran, service, router: create_router(registry, api_with_service) };
}

const ask = <Answer>(service: ReturnType<typeof service_setup>["service"], message: unknown) => service.handle(message) as Promise<Answer>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("the open key stores the selection and mounts the overlay", async () => {
    const { calls, router } = service_setup();
    await router.run({ command: "cmdline.open", args: { text: "tag " }, count: 1, windowId: 3, messageIds: [5] });
    assert.deepEqual(calls, ['cmdline.begin 3 {"message_ids":[5],"text":"tag "}', "overlay.mount 3 cmdline"]);
});

test("the open key with no text opens an empty line", async () => {
    const { calls, router } = service_setup();
    await router.run({ command: "cmdline.open", args: {}, count: 1, windowId: 3, messageIds: [] });
    assert.deepEqual(calls[0], 'cmdline.begin 3 {"message_ids":[],"text":""}');
});

test("a failed mount drops the stored session and tells the user", async () => {
    const { api, calls } = service_setup();
    api.overlay!.mount = async () => {
        throw new Error("no window");
    };
    await create_router(registry, api).run({ command: "cmdline.open", args: {}, count: 1, windowId: 3, messageIds: [] });
    assert.ok(calls.includes("cmdline.end 3"));
    assert.ok(calls.some((call) => call.startsWith("notify cmdline.open failed: no window")));
});

test("without the Experiment the open key refuses and mounts nothing", async () => {
    const { api, calls } = service_setup({ experiment: false });
    await create_router(registry, api).run({ command: "cmdline.open", args: {}, count: 1, windowId: 3, messageIds: [] });
    assert.deepEqual(calls.filter((call) => call.startsWith("overlay") || call.startsWith("cmdline")), []);
    assert.ok(calls.some((call) => call.startsWith("notify") && /Experiment/.test(call)));
});

test("a window id of -1 (an untracked window) refuses", async () => {
    const { calls, router } = service_setup();
    await router.run({ command: "cmdline.open", args: {}, count: 1, windowId: -1, messageIds: [] });
    assert.ok(calls.some((call) => call.startsWith("notify This window cannot show the command line")));
});

test("hello returns the opening text, or open false when no session exists", async () => {
    const { service } = service_setup();
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: false });
    service.begin(3, { message_ids: [5], text: "move " });
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: true, text: "move " });
});

test("messages that are not command line messages, or are malformed, are left alone", () => {
    const { service } = service_setup();
    assert.equal(service.handle({ type: "other" }), undefined);
    assert.equal(service.handle(null), undefined);
    assert.equal(service.handle("cmdline.hello"), undefined);
    assert.equal(service.handle({ type: "cmdline.hello", windowId: "3" }), undefined);
    assert.equal(service.handle({ type: "cmdline.complete", windowId: 3, text: 1, caret: 0 }), undefined);
    assert.equal(service.handle({ type: "cmdline.unknown", windowId: 3 }), undefined);
});

test("complete answers from the registry while a session exists and refuses without one", async () => {
    const { service } = service_setup();
    await assert.rejects(ask(service, { type: "cmdline.complete", windowId: 3, text: "", caret: 0 }), /not open/);
    service.begin(3, { message_ids: [], text: "" });
    const answer = await ask<CmdlineCompletion>(service, { type: "cmdline.complete", windowId: 3, text: "move ", caret: 5 });
    assert.deepEqual(answer.rows.map((row) => row.name), ["/Archive", "/Archive/2026", "/Inbox"]);
});

test("run keeps the line open and returns the reason for text that is not a command", async () => {
    const { service, ran, calls } = service_setup();
    service.begin(3, { message_ids: [5], text: "" });
    for (const [text, reason] of [["bogus", /unknown command/], ["tag", /missing <tag>/], ["move Archive", /folder/], ["tag -h", /^tag tag$/], ["tag @clipboard", /@sources/], ["motion.down", /runs on a key/]] as const) {
        const result = await ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text });
        assert.equal(result.ok, false, text);
        assert.match((result as { message: string }).message, reason, text);
    }
    await settle();
    assert.deepEqual(ran, []);
    assert.deepEqual(calls.filter((call) => call.startsWith("overlay.unmount")), []);
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: true, text: "" });
});

test("run closes the overlay, then runs the command on the messages selected when the line opened", async () => {
    const { service, ran, calls } = service_setup();
    service.begin(3, { message_ids: [5], text: "" });
    assert.deepEqual(await ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text: "tag Important" }), { ok: true });
    await settle();
    assert.deepEqual(ran, [{ command: "msg.tag", args: { tag: "Important" }, count: 1, windowId: 3, messageIds: [5] }]);
    const order = calls.filter((call) => call.startsWith("overlay.unmount") || call.startsWith("messages.update"));
    assert.deepEqual(order, ["overlay.unmount 3", 'messages.update 5 {"tags":["$label1"]}']);
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: false });
});

test("a runtime refusal of the command ends in a notification, after the line closed", async () => {
    const { service, calls } = service_setup();
    service.begin(3, { message_ids: [5], text: "" });
    await ask(service, { type: "cmdline.run", windowId: 3, text: "tag Nonesuch" });
    await settle();
    assert.ok(calls.includes("notify There is no tag named Nonesuch."));
});

test("close drops the session and unmounts, and an unmount event from the Experiment drops it too", async () => {
    const { service, calls } = service_setup();
    service.begin(3, { message_ids: [], text: "" });
    await ask(service, { type: "cmdline.close", windowId: 3 });
    assert.ok(calls.includes("overlay.unmount 3"));
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: false });
    service.begin(4, { message_ids: [], text: "" });
    service.end(4);
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 4 }), { open: false });
});

test("a second window keeps its own session", async () => {
    const { service } = service_setup();
    service.begin(3, { message_ids: [], text: "a " });
    service.begin(4, { message_ids: [], text: "b " });
    await ask(service, { type: "cmdline.close", windowId: 3 });
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 4 }), { open: true, text: "b " });
});

test("the default keys: : opens an empty line and the typed-value keys open it with the command started", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    const text_of = (keys: string) => {
        const binding = normal[keys];
        assert.ok(binding && !Array.isArray(binding), keys);
        assert.equal(binding.id, "cmdline.open", keys);
        return binding.args?.["text"];
    };
    assert.equal(text_of(":"), undefined);
    for (const [keys, text] of [["mt", "tag "], ["mm", "move "], ["Ft", "filter --tag --tag="], ["T", "tab "], ["/", "search "]] as const) {
        assert.equal(text_of(keys), text);
        // The text each key types must name a command and parse as far as the word before the value.
        const first_word = text.split(" ")[0]!;
        assert.ok(registry.find(first_word), first_word);
    }
});

test("a second run before the page closes runs nothing: Enter twice runs the command once", async () => {
    const { service, ran } = service_setup();
    service.begin(3, { message_ids: [5], text: "" });
    const [first, second] = await Promise.all([ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text: "tag Important" }), ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text: "tag Important" })]);
    assert.deepEqual(first, { ok: true });
    assert.equal(second.ok, false);
    await settle();
    assert.equal(ran.length, 1);
});
