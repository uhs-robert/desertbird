import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import { choose_target, parse_list_unsubscribe } from "../list_unsubscribe.ts";
import type { UnsubscribeTarget } from "../list_unsubscribe.ts";
import { notify_result } from "../notify.ts";
import type { NotificationsApi } from "../notify.ts";
import { require_messages } from "./each_message.ts";
import { resolve_identity } from "./identity.ts";
import type { HandlerScope, MessageApi, MessageHeader } from "./message.ts";

/** How long the first press stays armed for the second. */
export const CONFIRM_WINDOW_MS = 15_000;

export const PENDING_KEY = "desertbird_unsubscribe_pending";
export const PENDING_VERSION = 1;

interface PendingRecord {
    record_version: number;
    /** The message and the target the preview named. A second press on another message or another target starts over. */
    message_key: string;
    target_key: string;
    armed_at_ms: number;
}

export interface UnsubscribeApi extends MessageApi, NotificationsApi {
    messages: MessageApi["messages"] & { getFull(id: number): Promise<{ headers?: Record<string, string[]> }> };
    windows: { openDefaultBrowser(url: string): Promise<void> };
    storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
}

type UnsubscribeScope = HandlerScope<UnsubscribeApi>;

const target_key = (target: UnsubscribeTarget): string => (target.kind === "https" ? target.url : `mailto:${target.to.join(",")}?${target.subject}`);

const preview_text = (target: UnsubscribeTarget): string =>
    target.kind === "https"
        ? `Unsubscribe: press g u again to open ${target.host} in your browser.`
        : `Unsubscribe: press g u again to write a draft to ${target.to.join(", ")}. You send it yourself.`;

async function read_pending(api: UnsubscribeApi): Promise<PendingRecord | undefined> {
    const stored = (await api.storage.local.get(PENDING_KEY))[PENDING_KEY] as Partial<PendingRecord> | undefined;
    return stored?.record_version === PENDING_VERSION && typeof stored.message_key === "string" && typeof stored.target_key === "string" && Number.isFinite(stored.armed_at_ms) ? (stored as PendingRecord) : undefined;
}

// The draft is only opened. Nothing here sends mail, fetches a URL or posts to one.
async function act(scope: UnsubscribeScope, target: UnsubscribeTarget, message: MessageHeader): Promise<void> {
    if (target.kind === "https") return scope.api.windows.openDefaultBrowser(target.url);
    const identity = await resolve_identity(scope.api, message);
    // `body` would be taken as HTML, so the list text could load remote content. `plainTextBody` makes a plain text draft.
    await scope.api.compose.beginNew(undefined, { to: target.to, subject: target.subject, plainTextBody: target.body, isPlainText: true, identityId: identity.id });
}

// A press that arrives while another is running is dropped. The router does not queue commands, and two presses that both read the armed record would both act.
let press_running = false;

export async function unsubscribe(scope: UnsubscribeScope, args: unknown, now: () => number = Date.now): Promise<void> {
    if (press_running) return;
    press_running = true;
    try {
        await handle_press(scope, args, now);
    } finally {
        press_running = false;
    }
}

async function handle_press(scope: UnsubscribeScope, _args: unknown, now: () => number): Promise<void> {
    const ids = require_messages(scope.message_ids);
    if (ids.length > 1) throw new RuntimeRefusal("Select one message to unsubscribe from.");
    const message = await scope.api.messages.get(ids[0]!);
    const headers = (await scope.api.messages.getFull(ids[0]!)).headers ?? {};
    const header = Object.entries(headers).find(([name]) => name.toLowerCase() === "list-unsubscribe")?.[1]?.join(", ");
    if (header === undefined) throw new RuntimeRefusal("This message has no List-Unsubscribe header.");
    const target = choose_target(parse_list_unsubscribe(header));
    if (target === undefined) throw new RuntimeRefusal("This message has no safe unsubscribe link. Only https links and mailto addresses are accepted.");

    const message_key = message.headerMessageId ?? `id:${message.id}`;
    const pending = await read_pending(scope.api);
    const armed = pending !== undefined && pending.message_key === message_key && pending.target_key === target_key(target) && now() - pending.armed_at_ms >= 0 && now() - pending.armed_at_ms <= CONFIRM_WINDOW_MS;
    if (armed) {
        // Cleared before the action, so a slow action cannot be repeated by a third press.
        await scope.api.storage.local.set({ [PENDING_KEY]: null });
        await act(scope, target, message);
        return;
    }
    await scope.api.storage.local.set({ [PENDING_KEY]: { record_version: PENDING_VERSION, message_key, target_key: target_key(target), armed_at_ms: now() } satisfies PendingRecord });
    await notify_result(scope.api, preview_text(target));
}
