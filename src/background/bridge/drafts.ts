// The `draft` frame of the bridge: a program outside Thunderbird asks for a plain-text draft, and the add-on saves it to the Drafts folder of the chosen identity. It never sends. Every field is checked before the first compose call, and every refusal is a fixed text that never echoes the request.

import { best_effort, ignore_refusal, keep_chain, refused_as } from "../../shared/swallow.ts";
import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { Timers } from "../hud/toasts.ts";
import { resolve_identity } from "../handlers/identity.ts";
import type { Identity, IdentityApi, IdentityContext } from "../handlers/identity.ts";
import { MAX_BODY_BYTES, clean_body, cut_to_bytes, is_message_id } from "./reads.ts";

export interface DraftSettings {
    bridge: boolean;
    bridge_allow_drafts: boolean;
}

/** What a compose call takes. The body is always plain text, never HTML. */
interface DraftDetails {
    to?: string[];
    cc?: string[];
    subject: string;
    plainTextBody: string;
    isPlainText: true;
    identityId: string;
}

interface ComposeTab {
    id?: number;
    windowId?: number;
}

export interface DraftsApi extends IdentityApi {
    messages: { get(id: number): Promise<IdentityContext | null> };
    // Only the calls a draft needs. The add-on holds no `compose.send` permission, so Thunderbird refuses a send even if one were added here.
    compose: {
        beginNew(message_id: undefined, details: DraftDetails): Promise<ComposeTab>;
        beginReply(message_id: number, reply_type: "replyToSender", details: DraftDetails): Promise<ComposeTab>;
        saveMessage(tab_id: number, options: { mode: "draft" }): Promise<unknown>;
    };
    windows: {
        getLastFocused(): Promise<{ id?: number; focused?: boolean }>;
        remove(window_id: number): Promise<void>;
        update(window_id: number, properties: { focused: true }): Promise<unknown>;
    };
}

export interface BridgeDraftsDeps {
    api: DraftsApi;
    read_settings(): Promise<DraftSettings>;
    timers: Timers;
}

type Reply = { ok: true } | { ok: false; message: string };

const refuse = (message: string): Reply => ({ ok: false, message });

export const DRAFT_REFUSALS = {
    off: refuse("off"),
    bad_request: refuse("the request has a missing or bad field"),
    bad_address: refuse("bad address"),
    bad_subject: refuse("the subject is over 998 characters or holds a control character"),
    body_too_long: refuse("the body is over 64 KiB"),
    no_such_identity: refuse("no such identity"),
    no_identity: refuse("no account has an identity"),
    identities_unread: refuse("the identities could not be read"),
    no_such_message: refuse("no such message"),
    not_saved: refuse("the draft could not be saved"),
    timed_out: refuse("timed out"),
} as const;

export const MAX_RECIPIENTS = 10;
// RFC 5322 caps a header line at 998 characters.
export const MAX_SUBJECT_CHARS = 998;
const MAX_ADDRESS_CHARS = 254;
// A save to an IMAP Drafts folder can wait on Thunderbird's own retry prompt, or on a passphrase for an encrypted draft, for as long as nobody answers.
export const SAVE_TIMEOUT_MS = 30_000;

// Bcc and attachments are left out on purpose, so a field the frame does not name is refused rather than ignored.
const DRAFT_FIELDS = new Set(["verb", "request_id", "to", "cc", "subject", "body", "from", "reply_to_id"]);

// A bare address only. A display name, a comma or a group would let one entry carry several recipients past the count cap, so they are refused.
const ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const SUBJECT_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
// Zero-width and bidirectional marks can hide or reorder text in the subject line, as in the reads.
const FORMAT = /\p{Cf}/gu;

const is_address_list = (value: unknown, min: number): value is string[] => Array.isArray(value) && value.length >= min && value.length <= MAX_RECIPIENTS && value.every((entry) => typeof entry === "string");
const is_address = (entry: string): boolean => entry.length <= MAX_ADDRESS_CHARS && ADDRESS.test(entry);

interface CheckedDraft {
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    from?: string;
    reply_to_id?: number;
}

/** The checks that need no API call. */
function check_fields(request: Record<string, unknown>): CheckedDraft | Reply {
    if (Object.keys(request).some((field) => !DRAFT_FIELDS.has(field))) return DRAFT_REFUSALS.bad_request;
    const { to, cc = [], subject, body, from, reply_to_id } = request;
    if (reply_to_id !== undefined && !is_message_id(reply_to_id)) return DRAFT_REFUSALS.bad_request;
    if (!is_address_list(to, reply_to_id === undefined ? 1 : 0) || !is_address_list(cc, 0)) return DRAFT_REFUSALS.bad_request;
    if (typeof subject !== "string" || typeof body !== "string") return DRAFT_REFUSALS.bad_request;
    if (from !== undefined && (typeof from !== "string" || from.length > MAX_ADDRESS_CHARS)) return DRAFT_REFUSALS.bad_request;
    if (![...to, ...cc].every(is_address)) return DRAFT_REFUSALS.bad_address;
    if (Array.from(subject).length > MAX_SUBJECT_CHARS || SUBJECT_CONTROL.test(subject)) return DRAFT_REFUSALS.bad_subject;
    if (cut_to_bytes(body, MAX_BODY_BYTES).cut) return DRAFT_REFUSALS.body_too_long;
    return { to, cc, subject: subject.replace(FORMAT, ""), body: clean_body(body), ...(from !== undefined && { from }), ...(reply_to_id !== undefined && { reply_to_id }) };
}

const is_refusal = (checked: CheckedDraft | Reply): checked is Reply => "ok" in checked;

export function create_bridge_drafts(deps: BridgeDraftsDeps) {
    const { api } = deps;
    // One draft at a time, so a second compose window never opens while the first is still up, and the focus each one gives back is the one it found. `SAVE_TIMEOUT_MS` frees the queue from a save that never ends.
    let queue: Promise<unknown> = Promise.resolve();

    // `from` names an identity by its exact address. Without it, a reply takes the identity the original was addressed to and a new draft the default one, as the keys do.
    async function identity_for(draft: CheckedDraft, original: IdentityContext | undefined): Promise<Identity | Reply> {
        try {
            if (draft.from !== undefined) return (await api.identities.list()).find((identity) => identity.email === draft.from) ?? DRAFT_REFUSALS.no_such_identity;
            return await resolve_identity(api, original ?? {});
        } catch (error) {
            return error instanceof RuntimeRefusal ? DRAFT_REFUSALS.no_identity : DRAFT_REFUSALS.identities_unread;
        }
    }

    /** The outcome of `work`, or `undefined` when it takes longer than `ms`. */
    function within<T>(ms: number, work: Promise<T>): Promise<T | undefined> {
        let timer: unknown;
        const expired = new Promise<undefined>((resolve) => (timer = deps.timers.set(() => resolve(undefined), ms)));
        return Promise.race([work, expired]).finally(() => deps.timers.clear(timer));
    }

    /** Opens the compose window, saves it to Drafts and closes that window. Gives the focus back to the window that had it, when Thunderbird had it. */
    async function save_to_drafts(draft: CheckedDraft, identity_id: string): Promise<Reply> {
        const details: DraftDetails = { subject: draft.subject, plainTextBody: draft.body, isPlainText: true, identityId: identity_id };
        // An empty `to` or `cc` on a reply keeps the recipients Thunderbird picks for it.
        if (draft.to.length > 0) details.to = draft.to;
        if (draft.cc.length > 0) details.cc = draft.cc;
        const had_focus = await ignore_refusal(api.windows.getLastFocused());
        let tab: ComposeTab | undefined;
        // A rejected `beginNew` returns no tab, so a window it opened before failing stays open. Closing a new compose window found by comparing `windows.getAll` could close one the user opened at that moment.
        const compose_and_save = async (): Promise<Reply> => {
            tab = draft.reply_to_id === undefined ? await api.compose.beginNew(undefined, details) : await api.compose.beginReply(draft.reply_to_id, "replyToSender", details);
            if (tab.id === undefined) return DRAFT_REFUSALS.not_saved;
            await api.compose.saveMessage(tab.id, { mode: "draft" });
            return { ok: true };
        };
        const outcome = await within(SAVE_TIMEOUT_MS, refused_as(compose_and_save(), DRAFT_REFUSALS.not_saved));
        // The window stays open after a timeout: closing it under a pending save could drop the draft, and the user can still see and save it.
        if (outcome === undefined) return DRAFT_REFUSALS.timed_out;
        if (tab?.windowId !== undefined) await best_effort(api.windows.remove(tab.windowId));
        // Only a Thunderbird window that had the focus gets it back. Raising one when another program had the focus would steal it a second time.
        if (had_focus?.focused === true && had_focus.id !== undefined) await best_effort(api.windows.update(had_focus.id, { focused: true }));
        return outcome;
    }

    async function create(request: Record<string, unknown>): Promise<Reply> {
        const settings = await deps.read_settings();
        if (!settings.bridge || !settings.bridge_allow_drafts) return DRAFT_REFUSALS.off;
        const draft = check_fields(request);
        if (is_refusal(draft)) return draft;
        let original: IdentityContext | undefined;
        if (draft.reply_to_id !== undefined) {
            original = (await ignore_refusal(api.messages.get(draft.reply_to_id))) ?? undefined;
            if (!original) return DRAFT_REFUSALS.no_such_message;
        }
        const identity = await identity_for(draft, original);
        if ("ok" in identity) return identity;
        return save_to_drafts(draft, identity.id);
    }

    /** Answers one draft frame. The settings are read from storage now, so a setting turned off a moment ago already refuses. The reply is `ok` or a fixed refusal, never the draft or its id. */
    function draft(request: Record<string, unknown>): Promise<Reply> {
        const answer = queue.then(() => create(request));
        queue = keep_chain(answer);
        return answer;
    }

    return { draft };
}
