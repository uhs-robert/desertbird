// The external editor of a compose window. The host opens the user's editor on the plain-text body, or on the Markdown of the user's text in an HTML body (`compose_markdown.ts`), and this module collects the result and writes it back when the body is still the one the editor started from.
// The jobs live in `storage.session`, one per compose tab, and the collect loops are derived from them, so a restarted background resumes the loops with `resume`.
// The add-on writes no file. The host owns the scratch file and removes it only on the collect that ends the job. So a job whose compose window is gone is orphaned, not dropped: its loop keeps collecting until the editor ends, then discards the text.
// A dropped job (the setting turned off, failed collects) leaves its file until a later `editor_start` sweeps job files a day old.

import { ignore_refusal, keep_chain } from "../shared/swallow.ts";
import { RuntimeRefusal } from "../../vendor/desertfox/command.ts";
import type { ComposeEditRequest } from "../shared/protocol.ts";
import type { ComposeMarkdown } from "./compose_markdown.ts";
import { NativePermissionMissing } from "./native_permission.ts";

export const EDITOR_HOST_NAME = "desertbird_host";
export const EDITOR_JOBS_STORAGE_KEY = "desertbird_editor_jobs";

// The host also takes `insert` (start the editor in its insert mode) and `private` (refuse unless the scratch folder is memory-backed). Thunderbird has no private windows, so `private` is always false.
export type EditorStartRequest = { text: string; ext: string; insert: boolean; private: false };
// `pending` while the editor runs. `done` with `changed` and, only when changed, the edited `text`.
export type EditorCollectReply = { pending: true } | { done: true; changed: false } | { done: true; changed: true; text: string };

export interface EditorClient {
    editor_start(request: EditorStartRequest): Promise<string>;
    editor_collect(job: string): Promise<EditorCollectReply>;
}

const INSTALL_HINT = "Install the DesertFox native host with its host/install.sh, which writes the desertbird_host manifest.";

/** The one-shot client of `desertbird_host`. Every failure throws an Error whose message can be shown as it is. */
export function create_editor_client(send: (message: object) => Promise<unknown>): EditorClient {
    async function call(request: { cmd: string } & Record<string, unknown>): Promise<Record<string, unknown>> {
        let reply: unknown;
        try {
            reply = await send(request);
        } catch (error) {
            if (error instanceof NativePermissionMissing) throw error;
            const text = error instanceof Error ? error.message : String(error);
            // Thunderbird words this failure differently across versions, so only the stable part is matched.
            if (/no such native application/i.test(text)) throw new Error(`The native host desertbird_host is not installed (Thunderbird: ${text}). ${INSTALL_HINT}`);
            throw new Error(`The native host desertbird_host failed to run (Thunderbird: ${text}).`);
        }
        if (typeof reply !== "object" || reply === null || typeof (reply as { ok?: unknown }).ok !== "boolean") throw new Error(`The native host sent a reply that is not understood. ${INSTALL_HINT}`);
        const checked = reply as Record<string, unknown>;
        if (checked.ok !== true) throw new Error(`The native host refused: ${String(checked.error ?? "no reason given")}`);
        return checked;
    }

    return {
        async editor_start(request) {
            const reply = await call({ cmd: "editor_start", ...request });
            if (typeof reply.job !== "string" || reply.job === "") throw new Error("The native host started the editor but named no job. Update the DesertFox native host.");
            return reply.job;
        },
        async editor_collect(job) {
            const reply = await call({ cmd: "editor_collect", job });
            if (reply.pending === true) return { pending: true };
            if (reply.done === true && reply.changed === false) return { done: true, changed: false };
            if (reply.done === true && reply.changed === true && typeof reply.text === "string") return { done: true, changed: true, text: reply.text };
            throw new Error("The native host answered the editor in a way that is not understood. Update the DesertFox native host.");
        },
    };
}

export interface ComposeEditJob {
    job: string;
    tab_id: number;
    window_id: number;
    /** The body the editor started from, plain text or HTML. The result is written only while the body still equals it. */
    original: string;
    /** Set for an HTML message: the Markdown of the user's text that went to the editor. */
    markdown?: string;
    /** The compose window closed or sent its message. The loop still collects, so the host removes its file, and the text is discarded. */
    orphaned?: true;
}

// Keyed by the compose tab id, so a tab holds one job at most.
type Jobs = Record<string, ComposeEditJob>;

export interface ExternalEditorDeps {
    session: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
    client: EditorClient;
    compose: {
        getComposeDetails(tab_id: number): Promise<{ isPlainText?: boolean; plainTextBody?: string; body?: string }>;
        setComposeDetails(tab_id: number, details: { plainTextBody: string } | { body: string }): Promise<unknown>;
    };
    markdown: ComposeMarkdown;
    /** The compose tab of the window, or undefined when the window is not a compose window. */
    compose_tab_in(window_id: number): Promise<number | undefined>;
    tab_exists(tab_id: number): Promise<boolean>;
    /** Reads the stored `external_editor` setting afresh. */
    is_enabled(): Promise<boolean>;
    say(window_id: number, text: string, is_error: boolean): Promise<void>;
    now(): number;
    pause(ms: number): Promise<void>;
}

// A host long-polls about 20 s. A pending answer sooner than this means it did not wait, so the loop waits instead of spinning.
const MIN_POLL_MS = 1000;
// Failed collects in a row before the loop gives up. One failed host call (a host update in flight) is no reason to lose the text.
const MAX_COLLECT_FAILURES = 3;
// The host's refusal for a job it does not hold. Retrying cannot help.
const UNKNOWN_JOB = /unknown editor job/;
// The scratch file is named for nvim and other editors that set the file type from the extension.
const MAIL_EXT = "eml";
const MARKDOWN_EXT = "md";

export const EDITOR_OFF_TEXT = "The external editor is off. Turn on the external_editor setting in the DesertBird options to edit a message in your editor.";
const GATE_OFF_DROP_TEXT = "The external_editor setting is off, so DesertBird stopped waiting for the editor and will not read its text. Save the text elsewhere from the editor to keep it.";
const NOT_COMPOSE_TEXT = "The external editor works only in a compose window. Press Ctrl+E in the message body.";
const ALREADY_ACTIVE_TEXT = "An external editor session is already active for this message.";
export const WINDOW_CLOSED_TEXT = "The compose window closed while the external editor was open. DesertBird will discard the edited text, so save it elsewhere from the editor to keep it.";
const RESTART_GONE_TEXT = "The compose window was gone when DesertBird restarted, so it will discard the text of its external editor. Save it elsewhere from the editor to keep it.";
const UNCHANGED_TEXT = "The editor closed with no change, so the message was left as it was.";
const GONE_AT_END_TEXT = "The compose window was gone when the editor ended, so the edited text was dropped.";
const TURNED_HTML_TEXT = "The message turned to HTML while the editor was open, so the edited text was not written.";
const TURNED_PLAIN_TEXT = "The message turned to plain text while the editor was open, so the edited text was not written.";
const BODY_CHANGED_TEXT = "The message body changed in the compose window while the editor was open, so the edited text was not written.";
const dropped_images_text = (count: number): string =>
    `${count === 1 ? "One image" : `${count} images`} of the edited text had a source DesertBird does not write back (only web addresses and embedded PNG, JPEG, GIF or WebP data), so the message lost ${count === 1 ? "it" : "them"}. Insert ${count === 1 ? "it" : "them"} again in the compose window.`;
const SCRATCH_FOLDER_HINT = " The edited text stays in the host's scratch folder (desertfox/editor under $XDG_RUNTIME_DIR, else under the cache folder) until a later editor start, a day or more on, sweeps it.";

const failure_text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function create_external_editor(deps: ExternalEditorDeps) {
    // Reads and writes of the job record run one at a time, so two quick presses see each other's job.
    let turn: Promise<unknown> = Promise.resolve();
    const in_turn = <R>(step: () => Promise<R>): Promise<R> => {
        const result = turn.then(step);
        turn = keep_chain(result);
        return result;
    };
    // The loops of this background's life. A loop outlives a turn, so the set stops `resume` from starting a second one.
    const collecting = new Set<string>();

    const read_jobs = async (): Promise<Jobs> => ((await deps.session.get(EDITOR_JOBS_STORAGE_KEY))[EDITOR_JOBS_STORAGE_KEY] as Jobs | undefined) ?? {};
    const write_jobs = (jobs: Jobs) => deps.session.set({ [EDITOR_JOBS_STORAGE_KEY]: jobs });

    /** Removes the job when the tab still holds it and returns it as stored, so the caller speaks only for a job it ended and sees an orphaning that came while it waited. Must run inside a turn. */
    async function end_if_held(held: ComposeEditJob): Promise<ComposeEditJob | undefined> {
        const jobs = await read_jobs();
        const current = jobs[held.tab_id];
        if (current?.job !== held.job) return undefined;
        delete jobs[held.tab_id];
        await write_jobs(jobs);
        return current;
    }

    const drop = (held: ComposeEditJob, text: string): Promise<void> =>
        in_turn(async () => {
            if (await end_if_held(held)) await deps.say(held.window_id, text, true);
        });

    /** Marks the live job of the tab orphaned and says once that its text will be discarded. */
    const orphan = (tab_id: number, text: string): Promise<void> =>
        in_turn(async () => {
            const jobs = await read_jobs();
            const held = jobs[tab_id];
            if (held === undefined || held.orphaned) return;
            held.orphaned = true;
            await write_jobs(jobs);
            await deps.say(held.window_id, text, true);
        });

    async function apply(held: ComposeEditJob, text: string): Promise<void> {
        const details = await ignore_refusal(deps.compose.getComposeDetails(held.tab_id));
        if (details === undefined) return deps.say(held.window_id, GONE_AT_END_TEXT, true);
        const is_html = held.markdown !== undefined;
        if (details.isPlainText === is_html) return deps.say(held.window_id, is_html ? TURNED_PLAIN_TEXT : TURNED_HTML_TEXT, true);
        if ((is_html ? details.body : details.plainTextBody) !== held.original) return deps.say(held.window_id, BODY_CHANGED_TEXT, true);
        // An editor that only adds or drops the closing newline changed no Markdown, and a rewrite would still reformat the HTML.
        if (is_html && text.trimEnd() === held.markdown!.trimEnd()) return deps.say(held.window_id, UNCHANGED_TEXT, false);
        try {
            await deps.compose.setComposeDetails(held.tab_id, is_html ? { body: deps.markdown.body_with(held.original, text) } : { plainTextBody: text });
            const dropped = is_html ? deps.markdown.dropped_images(held.original, text) : 0;
            if (dropped > 0) await deps.say(held.window_id, dropped_images_text(dropped), true);
        } catch (error) {
            await deps.say(held.window_id, `The edited text could not be written: ${failure_text(error)}`, true);
        }
    }

    const finish = (held: ComposeEditJob, reply: Exclude<EditorCollectReply, { pending: true }>): Promise<void> =>
        in_turn(async () => {
            const current = await end_if_held(held);
            // A job dropped while its collect was in flight has spoken already. An orphaned one said at its orphaning that the text is discarded.
            if (current === undefined || current.orphaned) return;
            if (!reply.changed) return deps.say(held.window_id, UNCHANGED_TEXT, false);
            await apply(held, reply.text);
        });

    const still_held = async (held: ComposeEditJob): Promise<boolean> => (await in_turn(read_jobs))[held.tab_id]?.job === held.job;

    async function collect_loop(held: ComposeEditJob): Promise<void> {
        if (collecting.has(held.job)) return;
        collecting.add(held.job);
        try {
            let failures = 0;
            // Each pass checks the job and the setting before it calls the host, so a dropped job or a setting turned off sends nothing more.
            while (await still_held(held)) {
                if (!(await deps.is_enabled())) return await drop(held, GATE_OFF_DROP_TEXT);
                const asked_at = deps.now();
                let reply: EditorCollectReply;
                try {
                    reply = await deps.client.editor_collect(held.job);
                    failures = 0;
                } catch (error) {
                    const unknown_job = UNKNOWN_JOB.test(failure_text(error));
                    if (!unknown_job && ++failures < MAX_COLLECT_FAILURES) {
                        await deps.pause(MIN_POLL_MS);
                        continue;
                    }
                    return await drop(held, failure_text(error) + (unknown_job ? "" : SCRATCH_FOLDER_HINT));
                }
                if ("pending" in reply) {
                    const waited = deps.now() - asked_at;
                    if (waited < MIN_POLL_MS) await deps.pause(MIN_POLL_MS - waited);
                    continue;
                }
                return await finish(held, reply);
            }
        } finally {
            collecting.delete(held.job);
        }
    }

    return {
        /** Starts the editor on the body of the compose window. Throws a RuntimeRefusal the router shows as a toast. The setting is read first, so nothing reaches the host while it is off. */
        async open(window_id: number): Promise<void> {
            if (!(await deps.is_enabled())) throw new RuntimeRefusal(EDITOR_OFF_TEXT);
            const tab_id = await deps.compose_tab_in(window_id);
            if (tab_id === undefined) throw new RuntimeRefusal(NOT_COMPOSE_TEXT);
            const held = await in_turn(async (): Promise<ComposeEditJob> => {
                const jobs = await read_jobs();
                if (jobs[tab_id] !== undefined) throw new RuntimeRefusal(ALREADY_ACTIVE_TEXT);
                const details = await deps.compose.getComposeDetails(tab_id);
                const is_html = details.isPlainText !== true;
                const original = (is_html ? details.body : details.plainTextBody) ?? "";
                const markdown = is_html ? deps.markdown.markdown_of(original) : undefined;
                let job: string;
                try {
                    job = await deps.client.editor_start({ text: markdown ?? original, ext: is_html ? MARKDOWN_EXT : MAIL_EXT, insert: false, private: false });
                } catch (error) {
                    throw new RuntimeRefusal(failure_text(error));
                }
                const started: ComposeEditJob = markdown === undefined ? { job, tab_id, window_id, original } : { job, tab_id, window_id, original, markdown };
                await write_jobs({ ...jobs, [tab_id]: started });
                return started;
            });
            void collect_loop(held);
        },
        /** The compose tab closed, or its message was sent: the job is orphaned and its loop collects on, so the host removes its file. */
        compose_gone: (tab_id: number): Promise<void> => orphan(tab_id, WINDOW_CLOSED_TEXT),
        /** At every start of the background: every job collects again, and the job of a gone tab is orphaned first. While the setting is off, every job is dropped with no host call. */
        async resume(): Promise<void> {
            const enabled = await deps.is_enabled();
            for (const held of Object.values(await in_turn(read_jobs))) {
                if (!enabled) {
                    await drop(held, GATE_OFF_DROP_TEXT);
                    continue;
                }
                if (!held.orphaned && !(await deps.tab_exists(held.tab_id))) await orphan(held.tab_id, RESTART_GONE_TEXT);
                void collect_loop(held);
            }
        },
    };
}

export type ExternalEditor = ReturnType<typeof create_external_editor>;

/** Answers the `compose.edit` request of the compose script, or returns undefined for any other message. The window comes from the sender, which the compose body cannot write. */
export function create_compose_requests(run: (window_id: number) => Promise<void>): (message: unknown, sender: { tab?: { windowId?: number } }) => Promise<unknown> | undefined {
    return (message, sender) => {
        if ((message as Partial<ComposeEditRequest> | null)?.type !== "compose.edit") return undefined;
        const window_id = sender.tab?.windowId;
        return window_id === undefined ? Promise.resolve({}) : run(window_id).then(() => ({}));
    };
}
