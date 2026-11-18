import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIRM_TIMEOUT_MS, create_confirm_service } from "../src/background/bridge/confirm.ts";
import type { ConfirmRequest, ConfirmResult } from "../src/background/bridge/confirm.ts";
import { create_bridge_run } from "../src/background/bridge/run.ts";
import { registry } from "../src/background/commands/index.ts";
import { answer_of_key, confirm_lines, show_confirm } from "../src/overlay/confirm.ts";
import type { ConfirmKey, PromptNode } from "../src/overlay/confirm.ts";
import { CONFIRM_KEY_GRACE_MS } from "../src/shared/protocol.ts";
import type { ConfirmAnswerResult, ConfirmPrompt, OverlayApi, OverlayMountArgs, OverlayUnmountArgs } from "../src/shared/protocol.ts";
import { fake_timers, settle } from "./hud_fakes.ts";

const PAGE = "moz-extension://uuid/overlay/cmdline.html";
const WINDOW = 3;
const page_of = (window_id: number) => ({ url: `${PAGE}?window=${window_id}` });

function fake_overlay(options: { mount_fails?: boolean } = {}) {
    const calls: string[] = [];
    const overlay = {
        mount: async (args: OverlayMountArgs) => {
            calls.push(`mount ${args.windowId} ${args.surface}`);
            if (options.mount_fails) throw new Error("no window");
        },
        unmount: async (args: OverlayUnmountArgs) => void calls.push(`unmount ${args.windowId} ${args.surface}`),
    } as unknown as OverlayApi;
    return { overlay, calls };
}

function confirm_under_test(options: { window_id?: number | undefined; mount_fails?: boolean; overlay?: boolean } = {}) {
    const timers = fake_timers();
    const { overlay, calls } = fake_overlay(options);
    let now = 1000;
    let tokens = 0;
    const ended: number[] = [];
    const service = create_confirm_service({
        overlay: options.overlay === false ? undefined : overlay,
        target_window: async () => ("window_id" in options ? options.window_id : WINDOW),
        end_command_line: (window_id) => void ended.push(window_id),
        page_url: () => PAGE,
        make_token: () => `token-${++tokens}`,
        timers,
        now_ms: () => now,
    });
    return { service, timers, calls, ended, overlay, advance_clock: (ms: number) => (now += ms) };
}

const request: ConfirmRequest = { action: "archive", count: 2, items: [{ subject: "Invoice", from: "Ann <ann@example.com>" }, { subject: "Lunch", from: "Bob <bob@example.com>" }] };

/** Starts a prompt and returns the prompt the page gets in its hello, with results counted so a second settle shows up. */
async function start(setup: ReturnType<typeof confirm_under_test>, input: ConfirmRequest = request) {
    const results: ConfirmResult[] = [];
    const done = setup.service.request_confirm(input).then((result) => {
        results.push(result);
        return result;
    });
    await settle();
    const hello = (await setup.service.handle({ type: "cmdline.hello", windowId: WINDOW }, page_of(WINDOW))) as { confirm: ConfirmPrompt } | undefined;
    return { done, results, prompt: hello?.confirm };
}

const answer = (setup: ReturnType<typeof confirm_under_test>, token: string, value: "yes" | "no", sender: { url?: string } = page_of(WINDOW), window_id = WINDOW) => setup.service.handle({ type: "confirm.answer", windowId: window_id, token, answer: value }, sender) as Promise<ConfirmAnswerResult>;

test("y from the prompt page answers yes once, clears the timer, unmounts the page and frees the slot", async () => {
    const setup = confirm_under_test();
    const { done, results, prompt } = await start(setup);
    assert.ok(prompt);
    assert.deepEqual(setup.calls, [`mount ${WINDOW} cmdline`]);
    assert.deepEqual(setup.ended, [WINDOW], "an open command line in the window is ended first");
    setup.advance_clock(CONFIRM_KEY_GRACE_MS);
    assert.deepEqual(await answer(setup, prompt.token, "yes"), { outcome: "settled" });
    assert.equal(await done, "yes");
    assert.equal(setup.timers.pending(), 0);
    assert.deepEqual(setup.calls, [`mount ${WINDOW} cmdline`, `unmount ${WINDOW} cmdline`]);
    // Later exits find nothing.
    assert.deepEqual(await answer(setup, prompt.token, "no"), { outcome: "stale" });
    setup.service.surface_gone(WINDOW);
    setup.timers.advance(CONFIRM_TIMEOUT_MS);
    await settle();
    assert.deepEqual(results, ["yes"]);
    assert.equal(setup.calls.length, 2);
    const next = await start(setup);
    assert.ok(next.prompt, "the slot is free for the next request");
});

test("n and Escape answer no, sent by the page as no", async () => {
    const setup = confirm_under_test();
    const { done, prompt } = await start(setup);
    setup.advance_clock(CONFIRM_KEY_GRACE_MS);
    await answer(setup, prompt!.token, "no");
    assert.equal(await done, "no");
    assert.equal(setup.timers.pending(), 0);
});

test("a second request is busy at once and never replaces the first", async () => {
    const setup = confirm_under_test();
    const first = await start(setup);
    assert.equal(await setup.service.request_confirm({ action: "trash", count: 1, items: [{ subject: "Other", from: "x" }] }), "busy");
    const hello = (await setup.service.handle({ type: "cmdline.hello", windowId: WINDOW }, page_of(WINDOW))) as { confirm: ConfirmPrompt };
    assert.equal(hello.confirm.token, first.prompt!.token);
    assert.equal(hello.confirm.action, "archive");
    assert.equal(setup.calls.length, 1, "the busy request mounted nothing");
    setup.advance_clock(CONFIRM_KEY_GRACE_MS);
    await answer(setup, first.prompt!.token, "yes");
    assert.equal(await first.done, "yes");
});

test("a request made while the first looks up its window is busy too", async () => {
    const setup = confirm_under_test();
    const first = setup.service.request_confirm(request);
    assert.equal(await setup.service.request_confirm(request), "busy");
    setup.timers.advance(CONFIRM_TIMEOUT_MS);
    assert.equal(await first, "timeout");
});

test("30 s without an answer is a timeout, and a late key after it changes nothing", async () => {
    const setup = confirm_under_test();
    const { done, results, prompt } = await start(setup);
    setup.timers.advance(CONFIRM_TIMEOUT_MS - 1);
    await settle();
    assert.deepEqual(results, []);
    setup.timers.advance(1);
    assert.equal(await done, "timeout");
    assert.deepEqual(setup.calls, [`mount ${WINDOW} cmdline`, `unmount ${WINDOW} cmdline`]);
    setup.advance_clock(CONFIRM_TIMEOUT_MS);
    assert.deepEqual(await answer(setup, prompt!.token, "yes"), { outcome: "stale" });
    await settle();
    assert.deepEqual(results, ["timeout"]);
    assert.equal(setup.calls.length, 2);
});

test("answers inside the first 300 ms after the mount are ignored", async () => {
    const setup = confirm_under_test();
    const { done, results, prompt } = await start(setup);
    setup.advance_clock(CONFIRM_KEY_GRACE_MS - 1);
    assert.deepEqual(await answer(setup, prompt!.token, "yes"), { outcome: "ignored" });
    await settle();
    assert.deepEqual(results, []);
    setup.advance_clock(1);
    await answer(setup, prompt!.token, "no");
    assert.equal(await done, "no");
});

test("only the prompt page of the prompt's window with the token can answer", async () => {
    const setup = confirm_under_test();
    const { done, results, prompt } = await start(setup);
    setup.advance_clock(CONFIRM_KEY_GRACE_MS);
    const token = prompt!.token;
    const refused: [string, Promise<ConfirmAnswerResult>][] = [
        ["wrong token", answer(setup, "token-guess", "yes")],
        ["a message document", answer(setup, token, "yes", { url: "imap://mail/INBOX?number=4" })],
        ["the body script of a message tab", setup.service.handle({ type: "confirm.answer", windowId: WINDOW, token, answer: "yes" }, { tab: { id: 2, windowId: WINDOW } } as never) as Promise<ConfirmAnswerResult>],
        ["the hud page", answer(setup, token, "yes", { url: `moz-extension://uuid/overlay/hud.html?window=${WINDOW}` })],
        ["the options page", answer(setup, token, "yes", { url: "moz-extension://uuid/options/options.html" })],
        ["the prompt page of another window", answer(setup, token, "yes", page_of(WINDOW + 1))],
        ["another window id", answer(setup, token, "yes", page_of(WINDOW), WINDOW + 1)],
        ["an unparsable address", answer(setup, token, "yes", { url: "not a url" })],
        ["no sender address", answer(setup, token, "yes", {})],
        ["a malformed answer", setup.service.handle({ type: "confirm.answer", windowId: WINDOW, token, answer: "y" }, page_of(WINDOW)) as Promise<ConfirmAnswerResult>],
    ];
    for (const [name, outcome] of refused) assert.notEqual((await outcome).outcome, "settled", name);
    await settle();
    assert.deepEqual(results, []);
    // The hello hands the prompt only to its own page.
    assert.equal(setup.service.handle({ type: "cmdline.hello", windowId: WINDOW }, { url: "imap://mail/INBOX" }), undefined);
    assert.equal(setup.service.handle({ type: "cmdline.hello", windowId: WINDOW + 1 }, page_of(WINDOW + 1)), undefined);
    await answer(setup, token, "yes");
    assert.equal(await done, "yes");
});

test("no bridge frame or registry command can answer the prompt", async () => {
    assert.deepEqual(
        registry.list().filter((command) => command.id.startsWith("confirm")),
        [],
    );
    const routed: unknown[] = [];
    const bridge = create_bridge_run({ target_window: async () => WINDOW, route: async (invocation) => void routed.push(invocation) });
    for (const text of ["confirm.answer yes", "confirm yes", "y"]) assert.equal((await bridge.run(text)).ok, false, text);
    assert.deepEqual(routed, []);
});

test("Escape in the chrome, a tab change or a closed window ends the prompt as no without a second unmount", async () => {
    const setup = confirm_under_test();
    const { done, results } = await start(setup);
    setup.service.surface_gone(WINDOW + 1);
    await settle();
    assert.deepEqual(results, [], "another window's surface leaving changes nothing");
    setup.service.surface_gone(WINDOW);
    assert.equal(await done, "no");
    assert.equal(setup.timers.pending(), 0);
    assert.deepEqual(setup.calls, [`mount ${WINDOW} cmdline`]);
    setup.service.surface_gone(WINDOW);
    await settle();
    assert.deepEqual(results, ["no"]);
});

test("a command line that opens or closes in the prompt's window ends the prompt as no, and keeps its own mount", async () => {
    for (const call of ["mount", "unmount"] as const) {
        const setup = confirm_under_test();
        const { done } = await start(setup);
        const yielding = setup.service.yielding_overlay(setup.overlay);
        await yielding[call]({ windowId: WINDOW, surface: "cmdline" });
        assert.equal(await done, "no", call);
        assert.deepEqual(setup.calls, [`mount ${WINDOW} cmdline`, `${call} ${WINDOW} cmdline`], call);
        assert.equal(setup.timers.pending(), 0);
    }
    const setup = confirm_under_test();
    const { results } = await start(setup);
    const yielding = setup.service.yielding_overlay(setup.overlay);
    await yielding.mount({ windowId: WINDOW, surface: "hud" });
    await yielding.mount({ windowId: WINDOW + 1, surface: "cmdline" });
    await settle();
    assert.deepEqual(results, [], "the hud and another window's command line leave the prompt alone");
});

test("a restarted background holds no prompt: an answer from the old page is stale and the page closes", async () => {
    const before = confirm_under_test();
    const { prompt } = await start(before);
    const after = confirm_under_test();
    after.advance_clock(CONFIRM_KEY_GRACE_MS);
    assert.deepEqual(await answer(after, prompt!.token, "yes"), { outcome: "stale" });
    assert.equal(after.service.handle({ type: "cmdline.hello", windowId: WINDOW }, page_of(WINDOW)), undefined, "the hello falls through to the command line, which answers not open");
    assert.deepEqual(after.calls, []);
});

test("no main window, no Experiment, a failed mount or a bad request is no at once, and the slot is free after", async () => {
    for (const options of [{ window_id: undefined }, { overlay: false }, { mount_fails: true }]) {
        const setup = confirm_under_test(options);
        assert.equal(await setup.service.request_confirm(request), "no", JSON.stringify(options));
        assert.equal(setup.timers.pending(), 0);
        assert.ok(!setup.calls.includes(`unmount ${WINDOW} cmdline`));
    }
});

test("a malformed request resolves no without a mount and never rejects", async () => {
    const setup = confirm_under_test();
    const bad_requests: unknown[] = [
        null,
        { ...request, action: "delete" },
        { ...request, count: 0 },
        { ...request, count: 1.5 },
        { ...request, count: "2" },
        { ...request, items: "x" },
        { ...request, items: [null] },
        { ...request, items: [{ subject: "s" }] },
        { ...request, items: [{ subject: 1, from: "f" }] },
        { ...request, count: 1 },
    ];
    for (const bad of bad_requests) assert.equal(await setup.service.request_confirm(bad as ConfirmRequest), "no", JSON.stringify(bad));
    assert.deepEqual(setup.calls, []);
    assert.equal(setup.timers.pending(), 0);
    assert.ok((await start(setup)).prompt, "the slot stays free");
});

test("a window that closes while the mount is pending ends the prompt as no, and the late mount result changes nothing", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
        const setup = confirm_under_test();
        let finish_mount: () => void = () => {};
        const calls: string[] = [];
        setup.overlay.mount = (args) => {
            calls.push(`mount ${args.windowId}`);
            return new Promise<void>((resolve, reject) => (finish_mount = outcome === "resolve" ? resolve : () => reject(new Error("window gone"))));
        };
        setup.overlay.unmount = async (args) => void calls.push(`unmount ${args.windowId}`);
        const results: ConfirmResult[] = [];
        const done = setup.service.request_confirm(request).then((result) => void results.push(result));
        await settle();
        assert.deepEqual(calls, [`mount ${WINDOW}`]);
        setup.service.surface_gone(WINDOW);
        finish_mount();
        await done;
        await settle();
        assert.deepEqual(results, ["no"], outcome);
        assert.deepEqual(calls, [`mount ${WINDOW}`], `${outcome}: no unmount`);
        assert.equal(setup.timers.pending(), 0);
    }
});

test("the prompt holds the cleaned subjects and senders cut to 80 characters, at most 10, and never a body", async () => {
    const setup = confirm_under_test();
    const items = Array.from({ length: 14 }, (_, index) => ({ subject: `Subject ${index}`, from: `sender${index}@example.com`, body: "SECRET BODY" }));
    items[0] = { subject: `Pay‮now\u0000 ${"x".repeat(200)}`, from: "Eve​ <eve@example.com>", body: "SECRET BODY" };
    const { prompt } = await start(setup, { action: "move", count: 14, items, target_folder_name: "Archive‮/2026" });
    assert.ok(prompt);
    assert.equal(prompt.items.length, 10);
    assert.equal(prompt.more, 4);
    assert.equal(prompt.items[0]!.subject, `Paynow ${"x".repeat(73)}`);
    assert.equal(Array.from(prompt.items[0]!.subject).length, 80);
    assert.equal(prompt.items[0]!.from, "Eve <eve@example.com>");
    assert.equal(prompt.target_folder_name, "Archive/2026");
    assert.ok(!JSON.stringify(prompt).includes("SECRET"));
    assert.deepEqual(Object.keys(prompt.items[1]!).sort(), ["from", "subject"]);
});

const key = (name: string, extra: Partial<ConfirmKey> = {}): ConfirmKey => ({ key: name, repeat: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });

test("only y answers yes, n and Escape answer no, and every other key, a repeat or an early key gives nothing", () => {
    const late = CONFIRM_KEY_GRACE_MS;
    assert.equal(answer_of_key(key("y"), late), "yes");
    assert.equal(answer_of_key(key("n"), late), "no");
    assert.equal(answer_of_key(key("Escape"), late), "no");
    for (const other of ["Y", "N", "Enter", " ", "j", "Tab", "1"]) assert.equal(answer_of_key(key(other), late), undefined, other);
    assert.equal(answer_of_key(key("y", { repeat: true }), late), undefined);
    assert.equal(answer_of_key(key("y", { ctrlKey: true }), late), undefined);
    assert.equal(answer_of_key(key("y", { altKey: true }), late), undefined);
    assert.equal(answer_of_key(key("y", { metaKey: true }), late), undefined);
    assert.equal(answer_of_key(key("y"), late - 1), undefined);
    assert.equal(answer_of_key(key("Escape"), late - 1), undefined);
});

test("the page lines carry the action, the count, the folder, the rest and the outside request line", () => {
    const lines = confirm_lines({ token: "t", action: "move", count: 12, items: [{ subject: "Hi", from: "Ann" }], more: 11, target_folder_name: "Old" });
    assert.equal(lines.source, "Requested by a program outside Thunderbird");
    assert.equal(lines.headline, "Move 12 messages to Old?");
    assert.deepEqual(lines.items, ["Ann: Hi"]);
    assert.equal(lines.more, "and 11 more");
    assert.equal(confirm_lines({ token: "t", action: "trash", count: 1, items: [], more: 0 }).headline, "Move to Trash 1 message?");
    assert.equal(confirm_lines({ token: "t", action: "archive", count: 1, items: [], more: 0 }).more, undefined);
});

interface FakeNode extends PromptNode<FakeNode> {
    children: FakeNode[];
}

function fake_page(outcomes: ConfirmAnswerResult["outcome"][]) {
    let now = 0;
    const sent: string[] = [];
    let closed = 0;
    let listener: ((event: ConfirmKey & { preventDefault(): void }) => void) | undefined;
    let shown: FakeNode | undefined;
    const create = (): FakeNode => {
        const node: FakeNode = { className: "", textContent: null, children: [], append: (...children) => void node.children.push(...children) };
        // A markup write would parse sender text as HTML.
        Object.defineProperty(node, "innerHTML", {
            set: () => {
                throw new Error("innerHTML is never set");
            },
        });
        return node;
    };
    show_confirm<FakeNode>(
        { token: "t", action: "archive", count: 1, items: [{ subject: "<img src=x onerror=alert(1)>", from: "a" }], more: 0 },
        {
            create,
            show: (node) => (shown = node),
            on_key: (handler) => (listener = handler),
            now_ms: () => now,
            send_answer: async (value) => {
                sent.push(value);
                return { outcome: outcomes.shift() ?? "settled" };
            },
            close: () => void closed++,
        },
    );
    let prevented = 0;
    const press = async (name: string, extra: Partial<ConfirmKey> = {}) => {
        listener!({ ...key(name, extra), preventDefault: () => void prevented++ });
        await settle();
    };
    return { press, sent, closed: () => closed, prevented: () => prevented, shown: () => shown!, move: (ms: number) => (now += ms) };
}

test("the page draws text only and sends one answer per prompt", async () => {
    const page = fake_page([]);
    assert.deepEqual(page.shown().children.map((node) => node.className), ["source", "headline", "keys", "item"], "the keys line sits above the list");
    assert.equal(page.shown().children[3]!.textContent, "a: <img src=x onerror=alert(1)>");
    await page.press("y");
    assert.deepEqual(page.sent, [], "the grace holds back the first key");
    page.move(CONFIRM_KEY_GRACE_MS);
    await page.press("y", { repeat: true });
    await page.press("x");
    assert.deepEqual(page.sent, []);
    await page.press("y");
    await page.press("n");
    assert.deepEqual(page.sent, ["yes"]);
    assert.equal(page.prevented(), 5, "no key reaches Thunderbird");
});

test("an ignored answer lets the next key try again, and a stale one closes the page", async () => {
    const page = fake_page(["ignored", "stale"]);
    page.move(CONFIRM_KEY_GRACE_MS);
    await page.press("n");
    await page.press("y");
    assert.deepEqual(page.sent, ["no", "yes"]);
    assert.equal(page.closed(), 1);
});
