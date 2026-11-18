// The y or n prompt a bridge write waits on. It borrows the command line surface of the last focused main window, because only that surface takes the keyboard and gives the focus back. The page learns from `cmdline.hello` that it shows a prompt, so nothing the page hears later can turn a command line into a prompt.

import { CONFIRM_KEY_GRACE_MS } from "../../shared/protocol.ts";
import type { ConfirmAction, ConfirmAnswerRequest, ConfirmAnswerResult, ConfirmPrompt, OverlayApi } from "../../shared/protocol.ts";
import type { Timers } from "../hud/toasts.ts";
import { clean_line, cut_to_chars } from "./reads.ts";

export type ConfirmResult = "yes" | "no" | "timeout" | "busy";

export interface ConfirmRequest {
    action: ConfirmAction;
    count: number;
    items: { subject: string; from: string }[];
    target_folder_name?: string;
}

export const CONFIRM_TIMEOUT_MS = 30_000;
export const MAX_CONFIRM_ITEMS = 10;
export const MAX_CONFIRM_LINE_CHARS = 80;

const ACTIONS: readonly ConfirmAction[] = ["archive", "trash", "move"];

export interface ConfirmSender {
    url?: string;
}

export interface ConfirmDeps {
    /** Absent when the Experiment failed to load. Every request is then a no. */
    overlay: OverlayApi | undefined;
    /** The last focused main window, or undefined when none is open. */
    target_window(): Promise<number | undefined>;
    /** Drops the command line session of the window, because the prompt replaces its page. */
    end_command_line(window_id: number): void;
    /** The address of the command line page without its query, the only page whose answer counts. */
    page_url(): string;
    make_token(): string;
    timers: Timers;
    now_ms(): number;
}

export interface ConfirmService {
    /** Shows the prompt and resolves with the answer. A second call while one is pending resolves `busy` at once and leaves the first alone. */
    request_confirm(request: ConfirmRequest): Promise<ConfirmResult>;
    /** Answers the prompt page's `cmdline.hello` and `confirm.answer`, or returns undefined for any other message. */
    handle(message: unknown, sender: ConfirmSender): Promise<unknown> | undefined;
    /** The command line surface left the window by itself (Escape in the chrome, a tab change, the window closed), or the window is gone. A prompt there ends as a no. */
    surface_gone(window_id: number): void;
    /** The overlay API for everything else that mounts the command line. A mount or unmount of it in the prompt's window ends the prompt as a no first. */
    yielding_overlay(overlay: OverlayApi): OverlayApi;
}

interface Pending {
    token: string;
    /** Undefined until the target window is known. */
    window_id: number | undefined;
    prompt: ConfirmPrompt;
    /** When the mount finished. Answers before this plus the grace are ignored. */
    mounted_at_ms: number | undefined;
    timer: unknown;
    resolve(result: ConfirmResult): void;
}

const fit_line = (text: string | undefined): string => cut_to_chars(clean_line(text), MAX_CONFIRM_LINE_CHARS).text;

// Only the subject and the sender of each item are copied, so whatever else a caller passes never reaches the prompt or the page.
function prompt_of(token: string, request: ConfirmRequest): ConfirmPrompt {
    const items = request.items.slice(0, MAX_CONFIRM_ITEMS).map((item) => ({ subject: fit_line(item.subject), from: fit_line(item.from) }));
    const folder = request.target_folder_name === undefined ? {} : { target_folder_name: fit_line(request.target_folder_name) };
    return { token, action: request.action, count: request.count, items, more: Math.max(0, request.count - items.length), ...folder };
}

const is_valid_request = (request: ConfirmRequest): boolean => ACTIONS.includes(request.action) && Number.isInteger(request.count) && request.count > 0 && Array.isArray(request.items);

function read_answer(message: Partial<Record<string, unknown>>): ConfirmAnswerRequest | undefined {
    const { windowId: window_id, token, answer } = message;
    return typeof window_id === "number" && typeof token === "string" && (answer === "yes" || answer === "no") ? { type: "confirm.answer", windowId: window_id, token, answer } : undefined;
}

export function create_confirm_service(deps: ConfirmDeps): ConfirmService {
    let pending: Pending | undefined;

    // The one way out of a prompt. It runs once per prompt: the slot is freed first, so every later path finds nothing. A surface that is already gone or being replaced is not unmounted, so a command line that takes its place stays.
    function finish(entry: Pending, result: ConfirmResult, unmount: boolean): void {
        if (pending !== entry) return;
        pending = undefined;
        deps.timers.clear(entry.timer);
        entry.resolve(result);
        if (unmount && entry.window_id !== undefined) deps.overlay?.unmount({ windowId: entry.window_id, surface: "cmdline" }).catch((error: unknown) => console.error("desertbird:", error));
    }

    // A body script's sender carries the message's address, and another extension page has another path, so only the prompt page of the prompt's window passes.
    function from_prompt_page(sender: ConfirmSender, window_id: number): boolean {
        if (typeof sender.url !== "string") return false;
        // The page address is compared as text: a URL parser gives a moz-extension address no origin outside Firefox.
        const [address, query = ""] = sender.url.split("#")[0]!.split("?", 2);
        return address === deps.page_url() && new URLSearchParams(query).get("window") === String(window_id);
    }

    function answer(request: ConfirmAnswerRequest, sender: ConfirmSender): ConfirmAnswerResult {
        const entry = pending;
        if (entry === undefined || entry.token !== request.token) return { outcome: "stale" };
        if (entry.window_id !== request.windowId || !from_prompt_page(sender, entry.window_id)) return { outcome: "ignored" };
        if (entry.mounted_at_ms === undefined || deps.now_ms() < entry.mounted_at_ms + CONFIRM_KEY_GRACE_MS) return { outcome: "ignored" };
        finish(entry, request.answer, true);
        return { outcome: "settled" };
    }

    function end_in_window(window_id: number, unmount: boolean): void {
        if (pending?.window_id === window_id) finish(pending, "no", unmount);
    }

    return {
        async request_confirm(request) {
            if (pending !== undefined) return "busy";
            if (deps.overlay === undefined || !is_valid_request(request)) return "no";
            const overlay = deps.overlay;
            // The slot is taken before the first await, so a second request in the meantime is busy.
            let resolve: (result: ConfirmResult) => void = () => {};
            const result = new Promise<ConfirmResult>((done) => (resolve = done));
            const token = deps.make_token();
            const entry: Pending = { token, window_id: undefined, prompt: prompt_of(token, request), mounted_at_ms: undefined, timer: undefined, resolve };
            pending = entry;
            entry.timer = deps.timers.set(() => finish(entry, "timeout", true), CONFIRM_TIMEOUT_MS);
            const window_id = await deps.target_window().catch(() => undefined);
            if (pending !== entry) return result;
            if (window_id === undefined) {
                finish(entry, "no", false);
                return result;
            }
            entry.window_id = window_id;
            deps.end_command_line(window_id);
            try {
                await overlay.mount({ windowId: window_id, surface: "cmdline" });
                entry.mounted_at_ms = deps.now_ms();
            } catch (error) {
                console.error("desertbird:", error);
                finish(entry, "no", false);
            }
            return result;
        },
        handle(message, sender) {
            if (typeof message !== "object" || message === null) return undefined;
            const fields = message as Partial<Record<string, unknown>>;
            // The hello can arrive before the mount call returns, so the prompt's window is enough here.
            if (fields["type"] === "cmdline.hello") {
                const entry = pending;
                if (entry?.window_id === undefined || entry.window_id !== fields["windowId"] || !from_prompt_page(sender, entry.window_id)) return undefined;
                return Promise.resolve({ open: false, confirm: entry.prompt });
            }
            if (fields["type"] !== "confirm.answer") return undefined;
            const request = read_answer(fields);
            return Promise.resolve(request === undefined ? { outcome: "ignored" } : answer(request, sender));
        },
        surface_gone: (window_id) => end_in_window(window_id, false),
        yielding_overlay(overlay) {
            return {
                ...overlay,
                async mount(args) {
                    if (args.surface === "cmdline") end_in_window(args.windowId, false);
                    await overlay.mount(args);
                },
                async unmount(args) {
                    if (args.surface === "cmdline") end_in_window(args.windowId, false);
                    await overlay.unmount(args);
                },
            };
        },
    };
}
