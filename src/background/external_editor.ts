// The external editor of a compose window. The host opens the user's editor on the plain-text body, and this module collects the result and writes it back when the body is still the one the editor started from.
// The jobs live in `storage.session`, one per compose tab, and the collect loops are derived from them, so a restarted background resumes the loops with `resume`.
// The add-on writes no file. The host owns the scratch file and removes it on a collect that ends the job. A dropped job leaves its file to the host's sweep of stale jobs.

import { RuntimeRefusal } from "../../vendor/desertfox/command.ts";
import type { ComposeEditRequest } from "../shared/protocol.ts";

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
    /** The plain-text body the editor started from. The result is written only while the body still equals it. */
    original: string;
}

// Keyed by the compose tab id, so a tab holds one job at most.
type Jobs = Record<string, ComposeEditJob>;

export interface ExternalEditorDeps {
    session: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
    client: EditorClient;
    compose: {
        getComposeDetails(tab_id: number): Promise<{ isPlainText?: boolean; plainTextBody?: string }>;
        setComposeDetails(tab_id: number, details: { plainTextBody: string }): Promise<unknown>;
    };
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
// The scratch file is named for nvim and other editors that set the mail file type from the extension.
const MAIL_EXT = "eml";

export const EDITOR_OFF_TEXT = "The external editor is off. Turn on the external_editor setting in the DesertBird options to edit a message in your editor.";
const GATE_OFF_DROP_TEXT = "The external_editor setting is off, so DesertBird stopped waiting for the editor and will not read its text. Save the text elsewhere from the editor to keep it.";
const NOT_COMPOSE_TEXT = "The external editor works only in a compose window. Press Ctrl+E in the message body.";
const ALREADY_ACTIVE_TEXT = "An external editor session is already active for this message.";
const HTML_LATER_TEXT = "The external editor edits plain-text messages only for now. HTML messages come in a later version.";
export const WINDOW_CLOSED_TEXT = "The compose window closed while the external editor was open. DesertBird will not read the edited text, so save it elsewhere from the editor to keep it.";
const RESTART_GONE_TEXT = "The compose window was gone when DesertBird restarted, so it will not read the text of its external editor. Save it elsewhere from the editor to keep it.";
const UNCHANGED_TEXT = "The editor closed with no change, so the message was left as it was.";
const GONE_AT_END_TEXT = "The compose window was gone when the editor ended, so the edited text was dropped.";
const TURNED_HTML_TEXT = "The message turned to HTML while the editor was open, so the edited text was not written.";
const BODY_CHANGED_TEXT = "The message body changed in the compose window while the editor was open, so the edited text was not written.";
const SCRATCH_FOLDER_HINT = " The edited text stays in the host's scratch folder (desertfox/editor under $XDG_RUNTIME_DIR, else under the cache folder) until the host clears it after a day.";

const failure_text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function create_external_editor(deps: ExternalEditorDeps) {
    // Reads and writes of the job record run one at a time, so two quick presses see each other's job.
    let turn: Promise<unknown> = Promise.resolve();
    const in_turn = <R>(step: () => Promise<R>): Promise<R> => {
        const result = turn.then(step);
        turn = result.catch(() => {});
        return result;
    };
    // The loops of this background's life. A loop outlives a turn, so the set stops `resume` from starting a second one.
    const collecting = new Set<string>();

    const read_jobs = async (): Promise<Jobs> => ((await deps.session.get(EDITOR_JOBS_STORAGE_KEY))[EDITOR_JOBS_STORAGE_KEY] as Jobs | undefined) ?? {};
    const write_jobs = (jobs: Jobs) => deps.session.set({ [EDITOR_JOBS_STORAGE_KEY]: jobs });

    /** Removes the job when the tab still holds it and returns true, so the caller speaks only for a job it ended. Must run inside a turn. */
    async function end_if_held(held: ComposeEditJob): Promise<boolean> {
        const jobs = await read_jobs();
        if (jobs[held.tab_id]?.job !== held.job) return false;
        delete jobs[held.tab_id];
        await write_jobs(jobs);
        return true;
    }

    const drop = (held: ComposeEditJob, text: string): Promise<void> =>
        in_turn(async () => {
            if (await end_if_held(held)) await deps.say(held.window_id, text, true);
        });

    async function apply(held: ComposeEditJob, text: string): Promise<void> {
        const details = await deps.compose.getComposeDetails(held.tab_id).catch(() => undefined);
        if (details === undefined) return deps.say(held.window_id, GONE_AT_END_TEXT, true);
        if (details.isPlainText !== true) return deps.say(held.window_id, TURNED_HTML_TEXT, true);
        if (details.plainTextBody !== held.original) return deps.say(held.window_id, BODY_CHANGED_TEXT, true);
        try {
            await deps.compose.setComposeDetails(held.tab_id, { plainTextBody: text });
        } catch (error) {
            await deps.say(held.window_id, `The edited text could not be written: ${failure_text(error)}`, true);
        }
    }

    const finish = (held: ComposeEditJob, reply: Exclude<EditorCollectReply, { pending: true }>): Promise<void> =>
        in_turn(async () => {
            // A job dropped while its collect was in flight has spoken already.
            if (!(await end_if_held(held))) return;
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
                if (details.isPlainText !== true) throw new RuntimeRefusal(HTML_LATER_TEXT);
                const original = details.plainTextBody ?? "";
                let job: string;
                try {
                    job = await deps.client.editor_start({ text: original, ext: MAIL_EXT, insert: false, private: false });
                } catch (error) {
                    throw new RuntimeRefusal(failure_text(error));
                }
                const started: ComposeEditJob = { job, tab_id, window_id, original };
                await write_jobs({ ...jobs, [tab_id]: started });
                return started;
            });
            void collect_loop(held);
        },
        /** The compose tab closed, or its message was sent: the job ends now and its loop stops before its next collect. */
        async compose_gone(tab_id: number): Promise<void> {
            const held = (await in_turn(read_jobs))[tab_id];
            if (held !== undefined) await drop(held, WINDOW_CLOSED_TEXT);
        },
        /** At every start of the background: the jobs of live tabs collect again, and the jobs of gone tabs, or every job while the setting is off, are dropped. */
        async resume(): Promise<void> {
            const enabled = await deps.is_enabled();
            for (const held of Object.values(await in_turn(read_jobs))) {
                if (!enabled) await drop(held, GATE_OFF_DROP_TEXT);
                else if (!(await deps.tab_exists(held.tab_id))) await drop(held, RESTART_GONE_TEXT);
                else void collect_loop(held);
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
