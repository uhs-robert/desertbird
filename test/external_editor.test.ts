import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeRefusal } from "../vendor/desertfox/command.ts";
import { EDITOR_JOBS_STORAGE_KEY, EDITOR_OFF_TEXT, WINDOW_CLOSED_TEXT, create_compose_requests, create_editor_client, create_external_editor } from "../src/background/external_editor.ts";
import type { EditorCollectReply, EditorStartRequest, ExternalEditorDeps } from "../src/background/external_editor.ts";
import { registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import { NativePermissionMissing } from "../src/background/native_permission.ts";
import { SETTING_DEFAULTS } from "../src/background/config/settings.ts";

const COMPOSE_WINDOW = 7;
const COMPOSE_TAB = 70;
const MAIN_WINDOW = 1;

/** A collect the test answers by hand, so it can act while the host waits. */
interface HeldCollect {
    job: string;
    answer(reply: EditorCollectReply): void;
    fail(error: Error): void;
}

function setup(options: { enabled?: boolean; body?: string; plain?: boolean; session?: Record<string, unknown>; live_tabs?: number[] } = {}) {
    const session = options.session ?? {};
    const state = { enabled: options.enabled ?? true, body: options.body ?? "Hello\n", plain: options.plain ?? true, compose_open: true };
    const host: string[] = [];
    const starts: EditorStartRequest[] = [];
    const writes: string[] = [];
    const said: { window_id: number; text: string; is_error: boolean }[] = [];
    const collects: HeldCollect[] = [];
    let start_error: Error | undefined;
    let job_count = 0;
    const live_tabs = new Set(options.live_tabs ?? [COMPOSE_TAB]);
    const deps: ExternalEditorDeps = {
        session: {
            get: async (key) => (key in session ? { [key]: structuredClone(session[key]) } : {}),
            set: async (items) => void Object.assign(session, structuredClone(items)),
        },
        client: {
            async editor_start(request) {
                host.push("editor_start");
                starts.push(request);
                if (start_error) throw start_error;
                return `job${++job_count}`;
            },
            editor_collect: (job) =>
                new Promise<EditorCollectReply>((resolve, reject) => {
                    host.push(`editor_collect ${job}`);
                    collects.push({ job, answer: resolve, fail: reject });
                }),
        },
        compose: {
            async getComposeDetails(tab_id) {
                if (tab_id !== COMPOSE_TAB || !state.compose_open) throw new Error("Invalid tab");
                return state.plain ? { isPlainText: true, plainTextBody: state.body } : { isPlainText: false, body: state.body };
            },
            async setComposeDetails(_tab_id, details) {
                state.body = "body" in details ? details.body : details.plainTextBody;
                writes.push(state.body);
            },
        },
        // The conversion has its own tests. This stand-in marks its output so a write shows which path ran.
        markdown: {
            markdown_of(html) {
                if (html.includes("both sides")) throw new RuntimeRefusal("The message has text on both sides of the quote.");
                return `md(${html})\n`;
            },
            body_with: (html, markdown) => `html(${html} + ${markdown.trimEnd()})`,
            dropped_images: (_html, markdown) => (markdown.match(/!\[file\]/g) ?? []).length,
        },
        compose_tab_in: async (window_id) => (window_id === COMPOSE_WINDOW && state.compose_open ? COMPOSE_TAB : undefined),
        tab_exists: async (tab_id) => live_tabs.has(tab_id),
        is_enabled: async () => state.enabled,
        say: async (window_id, text, is_error) => void said.push({ window_id, text, is_error }),
        now: () => 0,
        pause: async () => {},
    };
    const editor = create_external_editor(deps);
    return {
        editor,
        state,
        session,
        host,
        starts,
        writes,
        said,
        collects,
        live_tabs,
        fail_start: (error: Error) => void (start_error = error),
        jobs: () => (session[EDITOR_JOBS_STORAGE_KEY] ?? {}) as Record<string, { job: string; orphaned?: true }>,
    };
}

/** Lets queued promise steps run, so a loop reaches its next collect or its end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function refusal_of(run: Promise<void>): Promise<string> {
    try {
        await run;
    } catch (error) {
        assert.ok(error instanceof RuntimeRefusal, String(error));
        return error.message;
    }
    assert.fail("expected a refusal");
}

async function opened(options: Parameters<typeof setup>[0] = {}) {
    const harness = setup(options);
    await harness.editor.open(COMPOSE_WINDOW);
    await settle();
    return harness;
}

// --- the setting gate

test("external_editor defaults to off and stands apart from bridge", () => {
    assert.equal(SETTING_DEFAULTS.external_editor, false);
    assert.equal(SETTING_DEFAULTS.bridge, false);
});

test("with the setting off, a press sends nothing to the host and names the setting", async () => {
    const harness = setup({ enabled: false });
    const text = await refusal_of(harness.editor.open(COMPOSE_WINDOW));
    assert.match(text, /external_editor setting/);
    assert.deepEqual(harness.host, []);
    assert.deepEqual(harness.jobs(), {});
});

test("with the setting off, a resumed job is dropped and never collected", async () => {
    const session = { [EDITOR_JOBS_STORAGE_KEY]: { [COMPOSE_TAB]: { job: "old", tab_id: COMPOSE_TAB, window_id: COMPOSE_WINDOW, original: "Hello\n" } } };
    const harness = setup({ enabled: false, session });
    await harness.editor.resume();
    await settle();
    assert.deepEqual(harness.host, []);
    assert.deepEqual(harness.jobs(), {});
    assert.equal(harness.said.length, 1);
    assert.match(harness.said[0]!.text, /external_editor setting is off/);
});

test("turning the setting off mid-edit drops the job before the next collect", async () => {
    const harness = await opened();
    harness.state.enabled = false;
    harness.collects[0]!.answer({ pending: true });
    await settle();
    assert.equal(harness.collects.length, 1);
    assert.deepEqual(harness.jobs(), {});
    assert.match(harness.said[0]!.text, /external_editor setting is off/);
});

// --- refusals before the host

test("a window that is not a compose window refuses and sends nothing", async () => {
    const harness = setup();
    assert.match(await refusal_of(harness.editor.open(MAIN_WINDOW)), /only in a compose window/);
    assert.deepEqual(harness.host, []);
});

test("an HTML message with text on both sides of the quote refuses and sends nothing", async () => {
    const harness = setup({ plain: false, body: "<p>text on both sides</p>" });
    assert.match(await refusal_of(harness.editor.open(COMPOSE_WINDOW)), /both sides of the quote/);
    assert.deepEqual(harness.host, []);
    assert.deepEqual(harness.jobs(), {});
});

test("a host refusal shows its text and keeps no job", async () => {
    const harness = setup();
    harness.fail_start(new Error("The native host refused: no editor.toml in /home/u/.config/desertfox"));
    assert.match(await refusal_of(harness.editor.open(COMPOSE_WINDOW)), /no editor\.toml/);
    assert.deepEqual(harness.jobs(), {});
    assert.equal(harness.collects.length, 0);
});

test("a second press while the editor runs says a session is active and starts nothing", async () => {
    const harness = await opened();
    assert.match(await refusal_of(harness.editor.open(COMPOSE_WINDOW)), /already active/);
    assert.equal(harness.starts.length, 1);
});

test("two presses at once start one editor", async () => {
    const harness = setup();
    const results = await Promise.allSettled([harness.editor.open(COMPOSE_WINDOW), harness.editor.open(COMPOSE_WINDOW)]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(harness.starts.length, 1);
});

test("the start asks for the plain body, a mail extension and no private folder", async () => {
    const harness = await opened({ body: "Draft text\n" });
    assert.deepEqual(harness.starts, [{ text: "Draft text\n", ext: "eml", insert: false, private: false }]);
    assert.deepEqual(Object.keys(harness.jobs()), [String(COMPOSE_TAB)]);
});

// --- the end of an edit

test("a changed text is written when the body is still the original", async () => {
    const harness = await opened();
    harness.collects[0]!.answer({ pending: true });
    await settle();
    harness.collects[1]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, ["Edited\n"]);
    assert.deepEqual(harness.jobs(), {});
    assert.deepEqual(harness.said, []);
});

test("an unchanged editor writes nothing and says so", async () => {
    const harness = await opened();
    harness.collects[0]!.answer({ done: true, changed: false });
    await settle();
    assert.deepEqual(harness.writes, []);
    assert.deepEqual(harness.jobs(), {});
    assert.match(harness.said[0]!.text, /no change/);
});

test("a body changed in the window meanwhile is not overwritten", async () => {
    const harness = await opened();
    harness.state.body = "Hello\nTyped in the window\n";
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, []);
    assert.match(harness.said[0]!.text, /body changed in the compose window/);
});

test("a message turned to HTML meanwhile is not overwritten", async () => {
    const harness = await opened();
    harness.state.plain = false;
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, []);
    assert.match(harness.said[0]!.text, /turned to HTML/);
});

test("a window that closed without its event when the editor ends drops the text and says so", async () => {
    const harness = await opened();
    harness.state.compose_open = false;
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, []);
    assert.match(harness.said[0]!.text, /gone when the editor ended/);
});

// --- HTML messages

const HTML_BODY = "<p>Hi</p>";

test("an HTML message goes to the editor as Markdown with the md extension", async () => {
    const harness = await opened({ plain: false, body: HTML_BODY });
    assert.deepEqual(harness.starts, [{ text: "md(<p>Hi</p>)\n", ext: "md", insert: false, private: false }]);
});

test("changed Markdown is written back as HTML when the body is still the original", async () => {
    const harness = await opened({ plain: false, body: HTML_BODY });
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, ["html(<p>Hi</p> + Edited)"]);
    assert.deepEqual(harness.said, []);
});

test("an image the edit drops is named in a toast after the write", async () => {
    const harness = await opened({ plain: false, body: HTML_BODY });
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited ![file](file:///a.png) ![file](cid:b)\n" });
    await settle();
    assert.equal(harness.writes.length, 1);
    assert.match(harness.said[0]!.text, /^2 images of the edited text/);
});

test("Markdown that differs only in the closing newline writes nothing", async () => {
    const harness = await opened({ plain: false, body: HTML_BODY });
    harness.collects[0]!.answer({ done: true, changed: true, text: "md(<p>Hi</p>)" });
    await settle();
    assert.deepEqual(harness.writes, []);
    assert.match(harness.said[0]!.text, /no change/);
});

test("an HTML body changed in the window meanwhile is not overwritten", async () => {
    const harness = await opened({ plain: false, body: HTML_BODY });
    harness.state.body = "<p>Hi there</p>";
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, []);
    assert.match(harness.said[0]!.text, /body changed in the compose window/);
});

test("an HTML message turned to plain text meanwhile is not overwritten", async () => {
    const harness = await opened({ plain: false, body: HTML_BODY });
    harness.state.plain = true;
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, []);
    assert.match(harness.said[0]!.text, /turned to plain text/);
});

test("an HTML job whose window closed collects to the end and writes nothing", async () => {
    const harness = await opened({ plain: false, body: HTML_BODY });
    await harness.editor.compose_gone(COMPOSE_TAB);
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, []);
    assert.deepEqual(harness.jobs(), {});
});

test("an HTML job resumed after a restart still writes HTML", async () => {
    const first = await opened({ plain: false, body: HTML_BODY });
    const harness = setup({ plain: false, body: HTML_BODY, session: first.session });
    await harness.editor.resume();
    await settle();
    harness.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(harness.writes, ["html(<p>Hi</p> + Edited)"]);
});

// --- the compose window going away

test("a compose window closed mid-edit orphans the job with one toast naming the loss, collects to done and writes nothing", async () => {
    const harness = await opened();
    await harness.editor.compose_gone(COMPOSE_TAB);
    assert.equal(harness.jobs()[COMPOSE_TAB]?.orphaned, true);
    assert.deepEqual(harness.said, [{ window_id: COMPOSE_WINDOW, text: WINDOW_CLOSED_TEXT, is_error: true }]);
    // The loop collects on, so the host can remove its scratch file when the editor ends.
    harness.collects[0]!.answer({ pending: true });
    await settle();
    assert.equal(harness.collects.length, 2);
    harness.collects[1]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.equal(harness.collects.length, 2);
    assert.deepEqual(harness.writes, []);
    assert.deepEqual(harness.jobs(), {});
    assert.equal(harness.said.length, 1);
});

test("an orphaned job whose editor ends unchanged ends with no second toast", async () => {
    const harness = await opened();
    await harness.editor.compose_gone(COMPOSE_TAB);
    harness.collects[0]!.answer({ done: true, changed: false });
    await settle();
    assert.deepEqual(harness.jobs(), {});
    assert.equal(harness.said.length, 1);
});

test("the setting turned off while a job is orphaned drops it before the next collect", async () => {
    const harness = await opened();
    await harness.editor.compose_gone(COMPOSE_TAB);
    harness.state.enabled = false;
    harness.collects[0]!.answer({ pending: true });
    await settle();
    assert.equal(harness.collects.length, 1);
    assert.deepEqual(harness.jobs(), {});
    assert.match(harness.said[1]!.text, /external_editor setting is off/);
});

test("a press after the setting went off sends nothing while an orphaned job waits", async () => {
    const harness = await opened();
    await harness.editor.compose_gone(COMPOSE_TAB);
    harness.state.enabled = false;
    await refusal_of(harness.editor.open(COMPOSE_WINDOW));
    assert.equal(harness.starts.length, 1);
});

test("the close and the send event of one window toast once", async () => {
    const harness = await opened();
    await harness.editor.compose_gone(COMPOSE_TAB);
    await harness.editor.compose_gone(COMPOSE_TAB);
    assert.equal(harness.said.length, 1);
});

test("a tab with no job closing says nothing", async () => {
    const harness = setup();
    await harness.editor.compose_gone(99);
    assert.deepEqual(harness.said, []);
});

// --- failed collects

test("three failed collects in a row stop the loop with a toast and drop the job", async () => {
    const harness = await opened();
    for (let attempt = 0; attempt < 3; attempt++) {
        harness.collects[attempt]!.fail(new Error("The native host desertbird_host failed to run"));
        await settle();
    }
    assert.equal(harness.collects.length, 3);
    assert.deepEqual(harness.jobs(), {});
    assert.match(harness.said[0]!.text, /failed to run.*scratch folder/);
});

test("a missing grant stops the loop at once with the permission message and no scratch folder hint", async () => {
    const harness = await opened();
    harness.collects[0]!.fail(new NativePermissionMissing("The external editor needs the nativeMessaging permission, which is not granted."));
    await settle();
    assert.equal(harness.collects.length, 1);
    assert.deepEqual(harness.jobs(), {});
    assert.match(harness.said[0]!.text, /nativeMessaging permission/);
    assert.doesNotMatch(harness.said[0]!.text, /scratch folder/);
});

test("a collect that works again resets the failure count", async () => {
    const harness = await opened();
    harness.collects[0]!.fail(new Error("flaky"));
    await settle();
    harness.collects[1]!.fail(new Error("flaky"));
    await settle();
    harness.collects[2]!.answer({ pending: true });
    await settle();
    harness.collects[3]!.fail(new Error("flaky"));
    await settle();
    assert.equal(harness.collects.length, 5);
    assert.equal(Object.keys(harness.jobs()).length, 1);
});

test("an unknown job stops at once", async () => {
    const harness = await opened();
    harness.collects[0]!.fail(new Error("The native host refused: unknown editor job job1"));
    await settle();
    assert.equal(harness.collects.length, 1);
    assert.deepEqual(harness.jobs(), {});
    assert.doesNotMatch(harness.said[0]!.text, /scratch folder/);
});

// --- a restart of the background

test("a restart resumes the loop of a live tab and writes the result", async () => {
    const first = await opened();
    const second = setup({ session: first.session });
    await second.editor.resume();
    await settle();
    assert.deepEqual(second.collects.map((collect) => collect.job), ["job1"]);
    second.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(second.writes, ["Edited\n"]);
});

test("a restart orphans the job of a gone tab, says so once and collects it to done without writing", async () => {
    const first = await opened();
    const second = setup({ session: first.session, live_tabs: [] });
    await second.editor.resume();
    await settle();
    assert.equal(second.jobs()[COMPOSE_TAB]?.orphaned, true);
    assert.match(second.said[0]!.text, /gone when DesertBird restarted/);
    assert.deepEqual(second.collects.map((collect) => collect.job), ["job1"]);
    second.collects[0]!.answer({ done: true, changed: true, text: "Edited\n" });
    await settle();
    assert.deepEqual(second.writes, []);
    assert.deepEqual(second.jobs(), {});
    assert.equal(second.said.length, 1);
});

test("a restart keeps collecting a job orphaned before it, with no new toast", async () => {
    const first = await opened();
    await first.editor.compose_gone(COMPOSE_TAB);
    const second = setup({ session: first.session, live_tabs: [] });
    await second.editor.resume();
    await settle();
    assert.deepEqual(second.collects.map((collect) => collect.job), ["job1"]);
    assert.deepEqual(second.said, []);
});

test("with the setting off, a restart drops an orphaned job with no host call", async () => {
    const first = await opened();
    await first.editor.compose_gone(COMPOSE_TAB);
    const second = setup({ session: first.session, enabled: false, live_tabs: [] });
    await second.editor.resume();
    await settle();
    assert.deepEqual(second.host, []);
    assert.deepEqual(second.jobs(), {});
});

test("resume twice runs one loop per job", async () => {
    const first = await opened();
    const second = setup({ session: first.session });
    await second.editor.resume();
    await second.editor.resume();
    await settle();
    assert.equal(second.collects.length, 1);
});

// --- the native client

test("the client sends the verbs and reads the answers", async () => {
    const sent: object[] = [];
    const replies: unknown[] = [{ ok: true, job: "abc" }, { ok: true, pending: true }, { ok: true, done: true, changed: true, text: "x" }];
    const client = create_editor_client(async (message) => (sent.push(message), replies.shift()));
    assert.equal(await client.editor_start({ text: "t", ext: "eml", insert: false, private: false }), "abc");
    assert.deepEqual(await client.editor_collect("abc"), { pending: true });
    assert.deepEqual(await client.editor_collect("abc"), { done: true, changed: true, text: "x" });
    assert.deepEqual(sent, [{ cmd: "editor_start", text: "t", ext: "eml", insert: false, private: false }, { cmd: "editor_collect", job: "abc" }, { cmd: "editor_collect", job: "abc" }]);
});

test("the client names a missing host and passes a refusal on", async () => {
    const missing = create_editor_client(async () => {
        throw new Error("No such native application desertbird_host");
    });
    await assert.rejects(missing.editor_collect("j"), /desertbird_host is not installed.*install\.sh/);
    const refusing = create_editor_client(async () => ({ ok: false, error: "no editor.toml" }));
    await assert.rejects(refusing.editor_collect("j"), /refused: no editor\.toml/);
    const odd = create_editor_client(async () => ({ ok: true, done: true }));
    await assert.rejects(odd.editor_collect("j"), /not understood/);
});

// --- the command and its paths

test("compose.edit_external is :edit, runs in the background and never on the bridge", () => {
    const command = registry.get("compose.edit_external");
    assert.equal(registry.find("edit"), command);
    assert.equal(command?.runs_in, "background");
    assert.equal((command as { bridge?: boolean } | undefined)?.bridge, false);
});

function router_with(open: (window_id: number) => Promise<void>) {
    const notices: string[] = [];
    const api = { external_editor: { open }, notifications: { create: async (_id: unknown, options: { message: string }) => (notices.push(options.message), "") } } as unknown as RouterApi;
    return { router: create_router(registry, api), notices };
}

test(":edit from a main window and Ctrl+E with the setting off each toast and reach no host", async () => {
    for (const [window_id, enabled, expected] of [[MAIN_WINDOW, true, /only in a compose window/], [COMPOSE_WINDOW, false, /external_editor setting/]] as const) {
        const harness = setup({ enabled });
        const { router, notices } = router_with((id) => harness.editor.open(id));
        await router.run({ command: "compose.edit_external", args: {}, count: 1, windowId: window_id, messageIds: [] });
        assert.equal(notices.length, 1);
        assert.match(notices[0]!, expected);
        assert.deepEqual(harness.host, []);
    }
    assert.match(EDITOR_OFF_TEXT, /external_editor/);
});

test("the compose request runs the command in the sender's window and ignores other messages", async () => {
    const ran: number[] = [];
    const handle = create_compose_requests(async (window_id) => void ran.push(window_id));
    assert.equal(handle({ type: "body.invoke" }, { tab: { windowId: 3 } }), undefined);
    assert.deepEqual(await handle({ type: "compose.edit", windowId: 99 }, { tab: { windowId: COMPOSE_WINDOW } }), {});
    assert.deepEqual(await handle({ type: "compose.edit" }, {}), {});
    assert.deepEqual(ran, [COMPOSE_WINDOW]);
});
