import assert from "node:assert/strict";
import { test } from "node:test";
import { create_completer } from "../src/background/cmdline/completion.ts";
import { create_cmdline_service } from "../src/background/cmdline/service.ts";
import { DEFAULT_KEYMAP, registry } from "../src/background/commands/index.ts";
import { compile_tab_keymap } from "../src/background/commands/tab_keymaps.ts";
import { compile_effective_keymap } from "../src/background/config/keymap.ts";
import type { TreeBranch } from "../vendor/desertfox/prefix_tree.ts";
import { create_router } from "../src/background/router.ts";
import type { CmdlineCompletion, CmdlineHello, CmdlineRunResult, CmdlineWidgets, KeysInvocation, StatusWidget } from "../src/shared/protocol.ts";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { parse_command_line, tokenize } from "../vendor/desertfox/registry/command_line.ts";
import { print_command } from "../vendor/desertfox/registry/print_command.ts";
import { usage_line } from "../vendor/desertfox/registry/usage.ts";
import { fake_api } from "./fake_api.ts";

const parse = (text: string) => parse_command_line(registry, text);

test("options.open parses by its short name and by its id", () => {
    const opens = { kind: "invocation", invocation: { id: "options.open" } };
    assert.deepEqual(parse("options"), opens);
    assert.deepEqual(parse("options.open"), opens);
});

test("the text of tm and tM parses once the offset is typed", () => {
    assert.deepEqual(parse("tab.move --offset=-1"), { kind: "invocation", invocation: { id: "tab.move", args: { offset: "-1" } } });
    assert.deepEqual(parse("tab.move 2"), { kind: "invocation", invocation: { id: "tab.move", args: { tab: "2" } } });
});

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
    assert.equal(check_args(move, { folder: " Archive" }).ok, false);
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

const choice = (path: string, account_name = "Work", account_id = "a1") => ({ path, account_name, account_id });
const default_key_trees = async () => ({ mail: compile_effective_keymap({}).compiled.modes.normal as TreeBranch, message: compile_tab_keymap("message").compiled.modes.normal as TreeBranch });
const sources = { key_trees: default_key_trees, folders: async () => ["/Archive", "/Archive/2026", "/Inbox"].map((path) => choice(path)), tags: async () => ["Important", "Work stuff"], tabs: async () => [] };
const no_selection = { window_id: 3, message_ids: [] };
const complete = create_completer(registry, sources);

test("completion lists background commands by name and leaves out hidden and chrome commands", async () => {
    const { rows } = await complete("", 0, no_selection);
    const names = rows.map((row) => row.name);
    // The empty line shows the first 50 rows by name, so a name late in the alphabet (`tag`) shows once typed.
    assert.ok(names.includes("edit") && names.includes("move") && names.includes("msg.archive"));
    assert.ok((await complete("tag", 3, no_selection)).rows.some((row) => row.name === "tag"));
    assert.ok((await complete("tab", 3, no_selection)).rows.some((row) => row.name === "tab.next"));
    assert.ok(!names.includes("cmdline.open"));
    assert.ok(!names.includes("motion.down"));
});

test("a command row carries its usage for the note and no keys yet", async () => {
    const row = (await complete("tag", 3, no_selection)).rows.find((entry) => entry.name === "tag");
    assert.equal(row?.usage, usage_line(registry.get("msg.tag")!));
    assert.equal(row?.keys, undefined);
    assert.equal((await complete("tag ", 4, no_selection)).rows.every((entry) => entry.usage === undefined), true);
});

test("completion ranks a typed word and marks the matched letters", async () => {
    const answer = await complete("mo", 2, no_selection);
    assert.equal(answer.rows[0]?.name, "move");
    assert.deepEqual(answer.rows[0]?.positions, [0, 1]);
    assert.deepEqual([answer.start, answer.end], [0, 2]);
});

test("completion offers the folders for move and the tags for tag, and quotes a name with a space", async () => {
    const folders = await complete("move ", 5, no_selection);
    assert.deepEqual(folders.rows.map((row) => row.name), ["/Archive", "/Archive/2026", "/Inbox"]);
    assert.equal(folders.usage, "move [-A=<account>|--account=<account>] folder");
    const tags = await complete("tag ", 4, no_selection);
    assert.deepEqual(tags.rows.map((row) => row.insert), ["Important ", '"Work stuff" ']);
    const narrowed = await complete("move arch", 9, no_selection);
    assert.deepEqual(narrowed.rows.map((row) => row.name), ["/Archive", "/Archive/2026"]);
});

test("a typed folder or tag word highlights the first row, except a whole value, an empty word or a command word", async () => {
    assert.equal((await complete("move arch", 9, no_selection)).highlight_first, true);
    assert.equal((await complete("open arch", 9, no_selection)).highlight_first, true);
    assert.equal((await complete("tag imp", 7, no_selection)).highlight_first, true);
    assert.equal((await complete("move /Archive", 13, no_selection)).highlight_first, undefined);
    assert.equal((await complete("move ", 5, no_selection)).highlight_first, undefined);
    assert.equal((await complete("mo", 2, no_selection)).highlight_first, undefined);
});

test("tab rows show the tabs of the window, insert the number and highlight the first row for a word", async () => {
    const tabs = [{ number: 1, title: "Inbox", is_active: true }, { number: 2, title: "Inbox - Work", is_active: false }, { number: 3, title: "Report", is_active: false }];
    const ask = create_completer(registry, { ...sources, tabs: async () => tabs });
    const all = await ask("tab ", 4, no_selection);
    assert.deepEqual(all.rows.map((row) => [row.name, row.insert, row.description]), [["Inbox", "1 ", "Tab 1, this tab"], ["Inbox - Work", "2 ", "Tab 2"], ["Report", "3 ", "Tab 3"]]);
    assert.equal(all.highlight_first, undefined);
    const word = await ask("tab rep", 7, no_selection);
    assert.deepEqual(word.rows.map((row) => row.insert), ["3 "]);
    assert.equal(word.highlight_first, true);
    assert.equal((await ask("tab 2", 5, no_selection)).highlight_first, undefined);
    assert.equal((await ask("tab 20", 6, no_selection)).highlight_first, undefined);
    const twins = create_completer(registry, { ...sources, tabs: async () => [{ number: 1, title: "Re: Budget", is_active: false }, { number: 2, title: "Budget", is_active: false }] });
    const budget = await twins("tab Budget", 10, no_selection);
    assert.equal(budget.highlight_first, true);
    assert.equal(budget.rows[0]!.insert, "2 ");
});

test("open takes a fuzzy word and move takes any word, and the validator passes both", () => {
    for (const [text, id] of [["open proj", "folder.open"], ["move proj", "msg.move"]] as const) {
        const parsed = parse_command_line(registry, text);
        assert.equal(parsed.kind, "invocation", text);
        if (parsed.kind === "invocation") assert.deepEqual(parsed.invocation, { id, args: { folder: "proj" } }, text);
    }
});

test("completion offers the flags of a command and the value of an enum flag", async () => {
    const flags = await complete("sort --", 7, no_selection);
    assert.ok(flags.rows.some((row) => row.name.startsWith("--date")));
    assert.ok(flags.rows.some((row) => row.name.startsWith("--descending")));
});

test("hint is a typed command: it parses with its action flags and completion lists it", async () => {
    assert.deepEqual(parse("hint"), { kind: "invocation", invocation: { id: "hint.window" } });
    assert.deepEqual(parse("hint --yank"), { kind: "invocation", invocation: { id: "hint.window", args: { action: "yank" } } });
    const flags = await complete("hint --", 7, no_selection);
    assert.ok(flags.rows.some((row) => row.name.startsWith("--focus")));
    assert.ok(flags.rows.some((row) => row.name.startsWith("--yank")));
    assert.ok((await complete("hin", 3, no_selection)).rows.some((row) => row.name.startsWith("hint")));
});

test("completion gives nothing inside a quote or for an unknown command", async () => {
    assert.deepEqual((await complete('tag "Wo', 7, no_selection)).rows, []);
    assert.deepEqual((await complete("bogus x", 7, no_selection)).rows, []);
});

test("a long folder list ranks in full and keeps the best rows only", async () => {
    const many = Array.from({ length: 5000 }, (_, index) => choice(`/Folder${index}`));
    const answer = await create_completer(registry, { ...sources, folders: async () => many })("move ", 5, no_selection);
    assert.equal(answer.rows.length, 50);
});

// --- the service

function service_setup(options: { experiment?: boolean; read_widgets?: (window_id: number) => Promise<StatusWidget[]>; window_types?: Record<number, string> } = {}) {
    const { api, calls } = fake_api({ experiment: options.experiment ?? true, ...(options.window_types && { window_types: options.window_types }), messages: [{ id: 5, folder: { accountId: "a1" } }], tags: [{ key: "$label1", tag: "Important" }], folders: [{ id: "f1", accountId: "a1", path: "/Archive" }] });
    const ran: KeysInvocation[] = [];
    const recorded: string[] = [];
    const router = create_router(registry, api);
    const service = create_cmdline_service({
        registry,
        read_prompt: async () => "caret",
        read_widgets: options.read_widgets ?? (async () => []),
        sources,
        overlay: api.overlay,
        history: { record: async (line) => void recorded.push(line) },
        search_history: { record: async () => {} },
        search: { type: async () => ({ stale: true }), commit: async () => {}, cancel: async () => {} },
        run: async (invocation) => {
            ran.push(invocation);
            await router.run(invocation);
        },
    });
    // The router stores sessions through this wrapper, which records the call and then reaches the real service.
    const recording = { begin: (window_id: number, session: Parameters<typeof service.begin>[1]) => (api.cmdline.begin(window_id, session), service.begin(window_id, session)), end: (window_id: number) => (api.cmdline.end(window_id), service.end(window_id)) };
    const api_with_service = { ...api, cmdline: recording };
    return { api: api_with_service, calls, ran, recorded, service, router: create_router(registry, api_with_service) };
}

const ask = <Answer>(service: ReturnType<typeof service_setup>["service"], message: unknown) => service.handle(message) as Promise<Answer>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("the open key stores the selection and mounts the overlay", async () => {
    const { calls, router } = service_setup();
    await router.run({ command: "cmdline.open", args: { text: "tag " }, count: 1, windowId: 3, messageIds: [5] });
    assert.deepEqual(calls, ['cmdline.begin 3 {"message_ids":[5],"text":"tag "}', "overlay.mount 3 cmdline"]);
});

test("the open key in a message window stores the window kind, and in a main window stores none", async () => {
    const { calls, router } = service_setup({ window_types: { 7: "messageDisplay" } });
    await router.run({ command: "cmdline.open", args: { text: "move " }, count: 1, windowId: 7, messageIds: [5] });
    await router.run({ command: "cmdline.open", args: { text: "move " }, count: 1, windowId: 3, messageIds: [5] });
    assert.deepEqual(calls.filter((call) => call.startsWith("cmdline.begin")), ['cmdline.begin 7 {"message_ids":[5],"text":"move ","kind":"window"}', 'cmdline.begin 3 {"message_ids":[5],"text":"move "}']);
});

test("the open key refuses when the window cannot be read, and stores no session", async () => {
    const { api, calls } = service_setup();
    api.windows.get = async () => Promise.reject(new Error("no window"));
    await create_router(registry, api).run({ command: "cmdline.open", args: {}, count: 1, windowId: 3, messageIds: [] });
    assert.equal(calls.some((call) => call.startsWith("cmdline.begin") || call.startsWith("overlay.mount")), false);
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
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: true, text: "move ", prompt: "caret" });
});

test("widgets answers apart from the hello, and a search line or a closed line has none", async () => {
    const widgets = [{ kind: "folder" as const, text: "Inbox" }, { kind: "position" as const, text: "[2/9]" }];
    const asked: number[] = [];
    const { service } = service_setup({ read_widgets: async (window_id) => (asked.push(window_id), widgets) });
    assert.deepEqual(await ask<CmdlineWidgets>(service, { type: "cmdline.widgets", windowId: 3 }), { widgets: [] });
    service.begin(3, { message_ids: [], text: "" });
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: true, text: "", prompt: "caret" });
    assert.deepEqual(asked, []);
    assert.deepEqual(await ask<CmdlineWidgets>(service, { type: "cmdline.widgets", windowId: 3 }), { widgets });
    service.begin(4, { message_ids: [], text: "", search: "forward" });
    assert.deepEqual(await ask<CmdlineWidgets>(service, { type: "cmdline.widgets", windowId: 4 }), { widgets: [] });
    assert.deepEqual(asked, [3]);
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
    for (const [text, reason] of [["bogus", /unknown command/], ["tag", /missing <tag>/], ["tag -h", /^tag tag$/], ["tag @clipboard", /@sources/], ["motion.down", /runs on a key/]] as const) {
        const result = await ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text });
        assert.equal(result.ok, false, text);
        assert.match((result as { message: string }).message, reason, text);
    }
    await settle();
    assert.deepEqual(ran, []);
    assert.deepEqual(calls.filter((call) => call.startsWith("overlay.unmount")), []);
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: true, text: "", prompt: "caret" });
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

test("the line of a message window runs only the commands that window offers, and says so for the rest", async () => {
    const { service, ran } = service_setup();
    service.begin(3, { message_ids: [5], text: "", kind: "window" });
    for (const text of ["sort --date", "open /Archive", "tab 2", "find hello", "filter --tag --tag=x"]) {
        const result = await ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text });
        assert.equal(result.ok, false, text);
        assert.match((result as { message: string }).message, /is not available in a message window/, text);
    }
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 3 }), { open: true, text: "", prompt: "caret" }, "a refused line stays open");
    assert.deepEqual(await ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text: "tag Important" }), { ok: true });
    await settle();
    assert.deepEqual(ran.map((invocation) => invocation.command), ["msg.tag"]);
});

test("the same typed commands run in a main window, which has no kind", async () => {
    const { service } = service_setup();
    for (const text of ["sort --date --ascending", "find hello"]) {
        service.begin(3, { message_ids: [5], text: "" });
        assert.deepEqual(await ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text }), { ok: true }, text);
    }
});

test("the list of a message window holds only the commands it offers, and a refused command lists no flags or values", async () => {
    const { service } = service_setup();
    service.begin(3, { message_ids: [5], text: "", kind: "window" });
    const names = async (text: string) => (await ask<CmdlineCompletion>(service, { type: "cmdline.complete", windowId: 3, text, caret: text.length })).rows.map((row) => row.name);
    const all = await names("");
    for (const name of ["tag", "move", "copy", "msg.flag", "msg.archive"]) assert.ok(all.includes(name), name);
    for (const name of ["sort", "open", "tab", "find", "filter", "search"]) assert.equal(all.includes(name), false, name);
    assert.deepEqual(await names("sort "), []);
    assert.deepEqual(await names("sort --"), []);
    assert.ok((await names("move ")).includes("/Archive"));
    service.begin(4, { message_ids: [5], text: "" });
    const in_main = (await ask<CmdlineCompletion>(service, { type: "cmdline.complete", windowId: 4, text: "", caret: 0 })).rows.map((row) => row.name);
    for (const name of ["sort", "open", "find"]) assert.ok(in_main.includes(name), name);
});

test("a runtime refusal of the command ends in a notification, after the line closed", async () => {
    const { service, calls } = service_setup();
    service.begin(3, { message_ids: [5], text: "" });
    await ask(service, { type: "cmdline.run", windowId: 3, text: "tag Nonesuch" });
    await settle();
    assert.ok(calls.includes("notify There is no tag named Nonesuch."));
});

test(":open focuses the thread list after the line closed, so the restored focus does not undo it", async () => {
    const { api, calls, service } = service_setup();
    api.app!.paneFocus = async ({ pane }) => (calls.push(`paneFocus ${pane}`), true);
    service.begin(3, { message_ids: [], text: "" });
    await ask(service, { type: "cmdline.run", windowId: 3, text: "open /Archive" });
    await settle();
    const order = calls.filter((call) => call === "overlay.unmount 3" || call.startsWith("mailTabs.update") || call.startsWith("paneFocus"));
    assert.deepEqual(order, ["overlay.unmount 3", "mailTabs.update 1 f1", "paneFocus threads"]);
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
    assert.deepEqual(await ask<CmdlineHello>(service, { type: "cmdline.hello", windowId: 4 }), { open: true, text: "b ", prompt: "caret" });
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
    for (const [keys, text] of [["mt", "tag "], ["mm", "move "], ["mc", "copy "], ["Ft", "filter --tag --tag="], ["T", "tab "], ["o", "open "], [";;", "hint "]] as const) {
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

test("a line that runs is recorded, and a failing history write does not stop the command", async () => {
    const { calls, ran, recorded, service, router } = service_setup();
    await router.run({ command: "cmdline.open", args: {}, count: 1, windowId: 3, messageIds: [5] });
    calls.length = 0;
    assert.deepEqual(await ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text: "tag Important" }), { ok: true });
    await settle();
    assert.deepEqual(recorded, ["tag Important"]);
    assert.equal(ran.length, 1);
});

test("a failing history write still runs the command", async () => {
    const { api } = fake_api({ experiment: true, messages: [{ id: 5, folder: { accountId: "a1" } }], tags: [{ key: "$label1", tag: "Important" }], folders: [] });
    const ran: KeysInvocation[] = [];
    const service = create_cmdline_service({ registry, sources, read_prompt: async () => "caret", read_widgets: async () => [], overlay: api.overlay, history: { record: () => Promise.reject(new Error("disk full")) }, search_history: { record: async () => {} }, search: { type: async () => ({ stale: true }), commit: async () => {}, cancel: async () => {} }, run: async (invocation) => void ran.push(invocation) });
    service.begin(3, { message_ids: [5], text: "" });
    const errors = console.error;
    console.error = () => undefined;
    try {
        assert.deepEqual(await ask<CmdlineRunResult>(service, { type: "cmdline.run", windowId: 3, text: "tag Important" }), { ok: true });
        await settle();
    } finally {
        console.error = errors;
    }
    assert.equal(ran.length, 1);
});

// --- account-aware folder rows

test("a path two accounts hold gets a row per account that names the account, and is never a whole value", async () => {
    const shared = create_completer(registry, { ...sources, folders: async () => [choice("/Inbox", "Work", "a1"), choice("/Inbox", "Home", "a2"), choice("/Plans", "Work", "a1")] });
    const rows = (await shared("open ", 5, no_selection)).rows;
    assert.deepEqual(rows.map((row) => [row.name, row.description, row.insert]), [["/Inbox", "Work", "--account=Work /Inbox "], ["/Inbox", "Home", "--account=Home /Inbox "], ["/Plans", "Work", "/Plans "]]);
    assert.equal((await shared("open /Inbox", 11, no_selection)).highlight_first, true);
    assert.equal((await shared("open /Plans", 11, no_selection)).highlight_first, undefined);
    // The account name narrows the rows, as a keyword.
    assert.deepEqual((await shared("open home", 9, no_selection)).rows.map((row) => row.description), ["Home"]);
    // An account typed already narrows the list and adds no second flag.
    const narrowed = (await shared("open --account=Home ", 20, no_selection)).rows;
    assert.deepEqual(narrowed.map((row) => row.insert), ["/Inbox "]);
});

test("open asks for every account, move and copy for the selection's", async () => {
    const asked: unknown[] = [];
    const spy = create_completer(registry, { ...sources, folders: async (query) => (asked.push(query), []) });
    for (const text of ["open ", "move ", "copy "]) await spy(text, text.length, { window_id: 3, message_ids: [7] });
    assert.deepEqual(asked, [{ window_id: 3, message_ids: [7], all_accounts: true }, { window_id: 3, message_ids: [7], all_accounts: false }, { window_id: 3, message_ids: [7], all_accounts: false }]);
});

test("the folder source lists recent folders first, newest first, then the rest by path, and keeps one account for a selection", async () => {
    const { create_folder_source } = await import("../src/background/cmdline/folder_rows.ts");
    const { FOLDER_STATE_KEY, FOLDER_STATE_VERSION } = await import("../src/background/handlers/folder_state.ts");
    const folders = [{ id: "1", accountId: "a1", path: "/B" }, { id: "2", accountId: "a1", path: "/A" }, { id: "3", accountId: "a2", path: "/A" }, { id: "4", accountId: "a1", path: "/C" }];
    const entries = [{ account_id: "a1", path: "/B" }, { account_id: "a2", path: "/A" }, { account_id: "a1", path: "/Gone" }, { account_id: "a1", path: "/C" }, { account_id: "a2", path: "/A" }];
    const stored = { [FOLDER_STATE_KEY]: { record_version: FOLDER_STATE_VERSION, marks: {}, history: { entries, cursor: 4 } } };
    const api = {
        folders: { query: async () => folders },
        accounts: { list: async () => [{ id: "a1", name: "Work" }, { id: "a2", name: "Home" }] },
        mailTabs: { query: async () => [{ displayedFolder: shown }] },
        messages: { get: async () => ({ folder: { accountId: "a1" } }) },
        storage: { local: { get: async () => stored, set: async () => {} } },
    };
    let shown: { accountId: string } | null = null;
    const source = create_folder_source(api);
    const label = (list: { path: string; account_name: string }[]) => list.map((entry) => `${entry.account_name}${entry.path}`);
    assert.deepEqual(label(await source({ window_id: 3, message_ids: [], all_accounts: true })), ["Home/A", "Work/C", "Work/B", "Work/A"]);
    assert.deepEqual(label(await source({ window_id: 3, message_ids: [1], all_accounts: false })), ["Work/C", "Work/B", "Work/A"]);
    // The shown account's folder leads the other accounts' folder of the same path, though the other is more recent.
    shown = { accountId: "a1" };
    assert.deepEqual(label(await source({ window_id: 3, message_ids: [], all_accounts: true })), ["Work/A", "Home/A", "Work/C", "Work/B"]);
});

test("accounts that share a name insert the id and show it, and a typed --account adds no second flag", async () => {
    const twins = create_completer(registry, { ...sources, folders: async () => [choice("/Inbox", "Mail", "a1"), choice("/Inbox", "Mail", "a2")] });
    const rows = (await twins("open ", 5, no_selection)).rows;
    assert.deepEqual(rows.map((row) => [row.description, row.insert]), [["Mail (a1)", "--account=a1 /Inbox "], ["Mail (a2)", "--account=a2 /Inbox "]]);
    const typed = (await twins("open --account=Mail ", 20, no_selection)).rows;
    assert.deepEqual(typed.map((row) => row.insert), ["/Inbox ", "/Inbox "]);
});

// --- the keys column

test("command rows carry the keys that run the command bare, mail keys and message keys counted once", async () => {
    const { rows } = await complete("", 0, no_selection);
    const keys_of = (name: string) => rows.find((row) => row.name === name)?.keys;
    assert.equal(keys_of("sort"), "sa sd +8");
    assert.equal(keys_of("search"), undefined);
    assert.equal(keys_of("msg.archive"), "a");
    assert.equal(keys_of("msg.delete"), "dd");
    assert.equal(keys_of("msg.reply"), "r R");
});

test("the key labels follow the trees the source hands over", async () => {
    const trees = await default_key_trees();
    let current = trees;
    const follows = create_completer(registry, { ...sources, key_trees: async () => current });
    assert.ok((await follows("", 0, no_selection)).rows.some((row) => row.keys !== undefined));
    const empty = { kind: "branch", children: {} } as unknown as TreeBranch;
    assert.equal((await follows("", 0, no_selection)).rows.find((row) => row.name === "msg.archive")?.keys, "a");
    current = { mail: empty, message: empty };
    assert.equal((await follows("", 0, no_selection)).rows.find((row) => row.name === "msg.archive")?.keys, undefined);
});
