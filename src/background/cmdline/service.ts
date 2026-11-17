// The command line's side in the background: it holds what the line was opened with, answers the page's messages and runs the typed command through the router. The page itself draws and reads keys only.

import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import { check_args } from "../../../vendor/desertfox/registry/check_args.ts";
import { parse_command_line } from "../../../vendor/desertfox/registry/command_line.ts";
import type { Registry } from "../../../vendor/desertfox/registry/define.ts";
import type { CmdlineCompletion, CmdlineHello, CmdlineRequest, CmdlineRunResult, CmdlineSearchNote, JsonValue, KeysInvocation, OverlayApi, SearchDirection } from "../../shared/protocol.ts";
import type { SearchService } from "../search/service.ts";
import { create_completer } from "./completion.ts";
import type { CmdlineHistory } from "./history.ts";
import type { ValueSources } from "./completion.ts";

/** What the line acts on. The messages are the ones selected when it opened: nothing can change the selection while the overlay has the keys. */
export interface CmdlineSession {
    message_ids: number[];
    /** Text the line starts with, such as `tag ` for the key that types a command. */
    text: string;
    /** Set when the line is a search line. The page then shows the `/` or `?` prompt and sends keystrokes as `cmdline.search_type`. */
    search?: SearchDirection;
}

/** The part of the service a command handler uses. */
export interface CmdlineSessions {
    begin(window_id: number, session: CmdlineSession): void;
    end(window_id: number): void;
}

export interface CmdlineDeps {
    registry: Registry;
    sources: ValueSources;
    /** Absent when the Experiment failed to load. */
    overlay: OverlayApi | undefined;
    /** Keeps the lines that were run. A failed write is logged and never stops the command. */
    history: CmdlineHistory;
    /** The lines typed after `/` and `?`, kept apart from the command lines. */
    search_history: CmdlineHistory;
    /** The live search behind a search line. */
    search: Pick<SearchService, "type" | "commit" | "cancel">;
    /** Runs one invocation through the router. It reports its own failures. */
    run(invocation: KeysInvocation): Promise<void>;
}

export interface CmdlineService extends CmdlineSessions {
    /** Answers a message of the command line page, or returns undefined for a message that is not one. */
    handle(message: unknown): Promise<CmdlineHello | CmdlineCompletion | CmdlineRunResult | CmdlineSearchNote | Record<string, never>> | undefined;
}

const is_integer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

function read_request(message: unknown): CmdlineRequest | undefined {
    const request = message as Partial<Record<string, unknown>> | null;
    if (typeof request !== "object" || request === null || typeof request["type"] !== "string" || !request["type"].startsWith("cmdline.")) return undefined;
    const window_id = request["windowId"];
    if (!is_integer(window_id)) return undefined;
    switch (request["type"]) {
        case "cmdline.hello":
        case "cmdline.close":
            return { type: request["type"], windowId: window_id };
        case "cmdline.complete":
            return typeof request["text"] === "string" && is_integer(request["caret"]) ? { type: request["type"], windowId: window_id, text: request["text"], caret: request["caret"] } : undefined;
        case "cmdline.run":
        case "cmdline.search_type":
        case "cmdline.search_commit":
            return typeof request["text"] === "string" ? { type: request["type"], windowId: window_id, text: request["text"] } : undefined;
        default:
            return undefined;
    }
}

// An `@source` parses to an object. DesertBird has no context sources, so a command line with one is refused before it reaches a handler.
const has_source = (args: Record<string, unknown> | undefined): boolean => Object.values(args ?? {}).some((value) => typeof value === "object" && value !== null);

export function create_cmdline_service(deps: CmdlineDeps): CmdlineService {
    const sessions = new Map<number, CmdlineSession>();
    const committing = new Set<CmdlineSession>();
    const complete = create_completer(deps.registry, deps.sources);

    async function parse_and_check(text: string): Promise<CmdlineRunResult | { ok: true; id: string; args: Record<string, JsonValue> }> {
        const parsed = parse_command_line(deps.registry, text);
        if (parsed.kind === "error") return { ok: false, message: parsed.error };
        if (parsed.kind === "help") return { ok: false, message: parsed.usage };
        const command = deps.registry.get(parsed.invocation.id);
        if (command === undefined) return { ok: false, message: `unknown command "${parsed.invocation.id}"` };
        if (command.runs_in !== "background") return { ok: false, message: `${command.label} runs on a key in the mail window and cannot run from the command line.` };
        if (has_source(parsed.invocation.args)) return { ok: false, message: "@sources are not supported here, quote text that starts with @" };
        const checked = check_args(command, parsed.invocation.args);
        if (!checked.ok) return { ok: false, message: checked.error };
        return { ok: true, id: command.id, args: (parsed.invocation.args ?? {}) as Record<string, JsonValue> };
    }

    // A search line that closes without a commit puts the filter back first, so the list is as it was when the focus returns to it.
    async function close(window_id: number): Promise<void> {
        sessions.delete(window_id);
        // Cancels whenever the window has a live search, also while an Enter is still committing: the commit has the session out of the map then.
        await deps.search.cancel(window_id);
        await deps.overlay?.unmount({ windowId: window_id, surface: "cmdline" });
    }

    // The search keeps the filter and selects a row before the line closes, so a search that finds nothing leaves the line open with the reason.
    async function run_search(window_id: number, session: CmdlineSession, text: string): Promise<CmdlineRunResult> {
        if (sessions.get(window_id) !== session) return { ok: false, message: "The command line is not open." };
        // The session stays in the map while the commit runs, so Escape finds it. A second Enter is stopped by the flag.
        if (committing.has(session)) return { ok: false, message: "The search is still running." };
        committing.add(session);
        try {
            await deps.search.commit(window_id, text);
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        } finally {
            committing.delete(session);
        }
        // Escape came during the commit: the overlay is closing already and the search is cancelled.
        if (sessions.get(window_id) !== session) return { ok: true };
        sessions.delete(window_id);
        deps.search_history.record(text).catch((error: unknown) => console.error("desertbird:", error));
        setTimeout(() => void close(window_id).catch((error: unknown) => console.error("desertbird:", error)), 0);
        return { ok: true };
    }

    async function run(window_id: number, session: CmdlineSession, text: string): Promise<CmdlineRunResult> {
        // The session is claimed before anything awaits, so a second Enter before the page closes finds none and runs nothing.
        if (sessions.get(window_id) !== session) return { ok: false, message: "The command line is not open." };
        sessions.delete(window_id);
        // Not awaited: the write may be slow or fail, and the line runs either way.
        deps.history.record(text).catch((error: unknown) => console.error("desertbird:", error));
        const checked = await parse_and_check(text);
        if (!checked.ok || !("id" in checked)) {
            // A line that is not a command keeps the line open, so the session comes back.
            if (!sessions.has(window_id)) sessions.set(window_id, session);
            return checked;
        }
        // The reply goes out first. The unmount destroys the page that is waiting for it, and the command runs after the focus is back in the list.
        setTimeout(() => {
            close(window_id)
                .catch((error: unknown) => console.error("desertbird:", error))
                .then(() => deps.run({ command: checked.id, args: checked.args, count: 1, windowId: window_id, messageIds: session.message_ids }))
                .catch(console.error);
        }, 0);
        return { ok: true };
    }

    return {
        begin: (window_id, session) => void sessions.set(window_id, session),
        end(window_id) {
            sessions.delete(window_id);
            deps.search.cancel(window_id).catch((error: unknown) => console.error("desertbird:", error));
        },
        handle(message) {
            const request = read_request(message);
            if (request === undefined) return undefined;
            const session = sessions.get(request.windowId);
            switch (request.type) {
                case "cmdline.hello":
                    return Promise.resolve(session ? { open: true, text: session.text, ...(session.search && { search: session.search }) } : { open: false });
                case "cmdline.close":
                    return close(request.windowId).then(() => ({}));
                case "cmdline.complete":
                    return session ? complete(request.text, request.caret) : Promise.reject(new RuntimeRefusal("The command line is not open."));
                case "cmdline.search_type":
                    return session?.search ? deps.search.type(request.windowId, request.text) : Promise.reject(new RuntimeRefusal("The search line is not open."));
                case "cmdline.search_commit":
                    return session?.search ? run_search(request.windowId, session, request.text) : Promise.resolve({ ok: false, message: "The search line is not open." });
                case "cmdline.run":
                    return session ? run(request.windowId, session, request.text) : Promise.resolve({ ok: false, message: "The command line is not open." });
            }
        },
    };
}
