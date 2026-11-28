// The five read frames of the bridge: `folders`, `messages`, `message`, `attachments` and `contacts`. Each is off until its share setting and `bridge` are on, checked in storage at request time. Every string a sender controls is cleaned here, and a body leaves only as marked, untrusted text.

import { refused_as } from "../../shared/swallow.ts";
import { plain_body } from "../handlers/clipboard.ts";
import type { MessagePart } from "../handlers/clipboard.ts";
import { safe_filename } from "../safe_filename.ts";

export const READ_VERBS = ["folders", "messages", "message", "attachments", "contacts"] as const;
export type ReadVerb = (typeof READ_VERBS)[number];

export interface ShareSettings {
    bridge: boolean;
    bridge_share_headers: boolean;
    bridge_share_bodies: boolean;
    bridge_share_attachments: boolean;
    bridge_share_folders: boolean;
    bridge_share_contacts: boolean;
}

interface ReadFolder {
    id: string;
    name?: string;
    path: string;
    accountId: string;
    isRoot?: boolean;
    isVirtual?: boolean;
    isUnified?: boolean;
}

interface ReadHeader {
    id: number;
    author?: string;
    subject?: string;
    date?: Date | string;
    recipients?: string[];
    read?: boolean;
    flagged?: boolean;
}

/** The fields of a `contacts.quickSearch` node that the reader looks at. The node holds far more (phones, addresses, notes, the whole vCard), and none of it is read. */
interface ReadContact {
    type?: string;
    remote?: boolean;
    properties?: { DisplayName?: string; FirstName?: string; LastName?: string; PrimaryEmail?: string; SecondEmail?: string };
}

/** A part of `messages.getFull` with the fields the encryption check reads. */
type FullPart = MessagePart & { decryptionStatus?: string; parts?: FullPart[] };

export interface ReadsApi {
    accounts: { list(): Promise<{ id: string; name?: string }[]> };
    folders: {
        query(query: object): Promise<ReadFolder[]>;
        get(folder_id: string): Promise<ReadFolder>;
        getFolderInfo(folder_id: string): Promise<{ unreadMessageCount?: number; totalMessageCount?: number }>;
    };
    messages: {
        get(id: number): Promise<ReadHeader>;
        // `decrypt: false` keeps an encrypted part encrypted, so the check below sees its content type.
        getFull(id: number, options: { decrypt: false }): Promise<FullPart>;
        query(query: { folderId: string; unread?: true }): Promise<{ id: string | null; messages: ReadHeader[] }>;
        continueList(list_id: string): Promise<{ id: string | null; messages: ReadHeader[] }>;
        listAttachments(id: number): Promise<{ name?: string; partName: string; size?: number; contentType?: string }[]>;
    };
    messengerUtilities: { convertToPlainText(html: string): Promise<string> };
    contacts: { quickSearch(query_info: { searchString: string; includeLocal: boolean; includeRemote: boolean; includeReadOnly: boolean; includeReadWrite: boolean }): Promise<ReadContact[]> };
}

export interface BridgeReadsDeps {
    api: ReadsApi;
    read_settings(): Promise<ShareSettings>;
    /** Whether the optional `addressBooks` permission is granted. Checked before each contacts search. */
    address_books_granted(): Promise<boolean>;
}

type Reply = { ok: true; [field: string]: unknown } | { ok: false; message: string };

const refuse = (message: string): Reply => ({ ok: false, message });

// Fixed refusals: none echoes what the caller sent.
const BAD_REQUEST = refuse("the request has a missing or bad field");
const NO_SUCH_FOLDER = refuse("no such folder");
const NO_SUCH_MESSAGE = refuse("no such message");
const ENCRYPTED = refuse("the message is encrypted, so its body never leaves Thunderbird");

const NO_CONTACTS_PERMISSION = refuse("the addressBooks permission is not granted, open the DesertBird options, set bridge_share_contacts to true and press Save, then allow the prompt");
const QUERY_TOO_SHORT = refuse("the query is too short, every word needs at least 2 characters");
const CONTACTS_FAILED = refuse("the address book could not be searched");

const GATES: Record<ReadVerb, { settings: (keyof ShareSettings)[]; refusal: string }> = {
    folders: { settings: ["bridge_share_folders"], refusal: "folder sharing is off, set bridge_share_folders to true" },
    // A folder id is the folder's path, so a "no such folder" answer would confirm a guessed name while folder sharing is off.
    messages: { settings: ["bridge_share_headers", "bridge_share_folders"], refusal: "header or folder sharing is off, set bridge_share_headers and bridge_share_folders to true" },
    message: { settings: ["bridge_share_headers", "bridge_share_bodies"], refusal: "body sharing is off, set bridge_share_headers and bridge_share_bodies to true" },
    attachments: { settings: ["bridge_share_attachments"], refusal: "attachment sharing is off, set bridge_share_attachments to true" },
    contacts: { settings: ["bridge_share_contacts"], refusal: "contact sharing is off, set bridge_share_contacts to true" },
};

export const MAX_FOLDER_ID_CHARS = 1024;
export const MAX_MESSAGES = 200;
export const DEFAULT_MESSAGES = 50;
// The body cap counts UTF-8 bytes, which is what the reply size counts.
export const MAX_BODY_BYTES = 64 * 1024;
// One line of a header list. A subject or address longer than this is cut, so 200 rows stay far below the host's 1 MiB reply cap.
export const MAX_FIELD_CHARS = 512;
const MAX_RECIPIENTS = 100;
const MAX_ATTACHMENTS = 500;
const MAX_FOLDERS = 5000;
export const MAX_CONTACTS = 20;
export const MIN_QUERY_WORD_CHARS = 2;
const MAX_QUERY_CHARS = 100;
const MAX_QUERY_WORDS = 5;
// Kept under the host's 1 MiB cap with room for the reply envelope. A list over it drops rows from its end and says `truncated`.
export const MAX_REPLY_BYTES = 900 * 1024;

// C0 and C1 controls and the format characters (zero-width marks, bidirectional controls, the soft hyphen, tag characters), which can hide or reorder text.
const CONTROL_OR_FORMAT = /[\u0000-\u001f\u007f-\u009f\p{Cf}\u2028\u2029]/gu;
// A body keeps its line breaks and tabs.
const BODY_CONTROL_OR_FORMAT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/gu;

const utf8 = new TextEncoder();
const byte_length = (text: string): number => utf8.encode(text).length;

/** Cuts at a code point, never inside a surrogate pair. */
export function cut_to_chars(text: string, max_chars: number): { text: string; cut: boolean } {
    const points = Array.from(text);
    return points.length <= max_chars ? { text, cut: false } : { text: points.slice(0, max_chars).join(""), cut: true };
}

/** Cuts to at most `max_bytes` of UTF-8, at a code point. */
export function cut_to_bytes(text: string, max_bytes: number): { text: string; cut: boolean } {
    if (byte_length(text) <= max_bytes) return { text, cut: false };
    let bytes = 0;
    let end = 0;
    for (const point of text) {
        const size = byte_length(point);
        if (bytes + size > max_bytes) break;
        bytes += size;
        end += point.length;
    }
    return { text: text.slice(0, end), cut: true };
}

/** One line of sender-controlled text: controls and format characters removed, cut to `MAX_FIELD_CHARS`. */
export const clean_line = (text: string | undefined): string => cut_to_chars((text ?? "").replace(CONTROL_OR_FORMAT, "").trim(), MAX_FIELD_CHARS).text;

export const clean_body = (text: string): string => text.replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n").replace(BODY_CONTROL_OR_FORMAT, "");

const ENCRYPTED_TYPES = ["multipart/encrypted", "application/pkcs7-mime", "application/x-pkcs7-mime", "application/pgp-encrypted"];
const INLINE_PGP = "-----BEGIN PGP MESSAGE-----";

/** True when any part is encrypted, by content type, by Thunderbird's decryption status, or as inline PGP text. Under `decrypt: false` Thunderbird marks the root `skipped` when it holds encrypted parts and `none` when it does not. */
export function is_encrypted(part: FullPart): boolean {
    const type = part.contentType?.toLowerCase().split(";")[0]?.trim() ?? "";
    if (ENCRYPTED_TYPES.includes(type)) return true;
    if (part.decryptionStatus !== undefined && part.decryptionStatus !== "none") return true;
    if (part.body?.includes(INLINE_PGP)) return true;
    return (part.parts ?? []).some(is_encrypted);
}

export const is_message_id = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const is_folder_id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_FOLDER_ID_CHARS;

const iso_date = (date: Date | string | undefined): string => {
    const parsed = date === undefined ? new Date(Number.NaN) : new Date(date);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

const contact_name = ({ properties = {} }: ReadContact): string => clean_line(properties.DisplayName?.trim() || [properties.FirstName, properties.LastName].filter(Boolean).join(" "));

// One address: no space, angle bracket, comma, quote or backslash, so it stays a bare `local@domain` that a draft takes as it is.
const BARE_ADDRESS = /^[^\s<>(),;:"\\@]+@[^\s<>(),;:"\\@]+$/u;

const contact_emails = ({ properties = {} }: ReadContact): string[] => {
    const cleaned = [properties.PrimaryEmail, properties.SecondEmail].map((address) => clean_line(address));
    return [...new Set(cleaned.filter((address) => BARE_ADDRESS.test(address)))];
};

/** Drops rows from the end until the reply fits under `MAX_REPLY_BYTES`. */
function fit_rows<T>(rows: T[], reply_of: (rows: T[], truncated: boolean) => Reply, truncated: boolean): Reply {
    let kept = rows;
    let cut = truncated;
    while (kept.length > 0 && byte_length(JSON.stringify(reply_of(kept, cut))) > MAX_REPLY_BYTES) {
        kept = kept.slice(0, Math.max(0, Math.floor(kept.length * 0.9)));
        cut = true;
    }
    return reply_of(kept, cut);
}

export function create_bridge_reads(deps: BridgeReadsDeps) {
    const { api } = deps;

    async function folders(): Promise<Reply> {
        const accounts = new Map((await api.accounts.list()).map((account) => [account.id, clean_line(account.name ?? account.id)]));
        const listed = (await api.folders.query({})).filter((folder) => !folder.isRoot && !folder.isVirtual && !folder.isUnified);
        const rows = await Promise.all(
            listed.slice(0, MAX_FOLDERS).map(async (folder) => {
                const info = await refused_as(api.folders.getFolderInfo(folder.id), { unreadMessageCount: 0, totalMessageCount: 0 });
                return { id: folder.id, name: clean_line(folder.name ?? folder.path), path: clean_line(folder.path), account: accounts.get(folder.accountId) ?? "", unread: info.unreadMessageCount ?? 0, total: info.totalMessageCount ?? 0 };
            }),
        );
        return fit_rows(rows, (kept, truncated) => ({ ok: true, folders: kept, truncated }), listed.length > MAX_FOLDERS);
    }

    async function messages(request: Record<string, unknown>): Promise<Reply> {
        const { folder, limit = DEFAULT_MESSAGES, unread_only = false } = request;
        if (!is_folder_id(folder) || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_MESSAGES || typeof unread_only !== "boolean") return BAD_REQUEST;
        try {
            await api.folders.get(folder);
        } catch {
            return NO_SUCH_FOLDER;
        }
        // Thunderbird lists a folder in storage order, oldest first. Every page is read, and only the newest `limit` rows so far are kept, so memory stays at one page plus `limit`.
        const by_newest = (left: ReadHeader, right: ReadHeader) => new Date(right.date ?? 0).getTime() - new Date(left.date ?? 0).getTime();
        let newest: ReadHeader[] = [];
        let seen = 0;
        let page = await api.messages.query({ folderId: folder, ...(unread_only && { unread: true as const }) });
        for (;;) {
            seen += page.messages.length;
            newest = [...newest, ...page.messages].sort(by_newest).slice(0, limit as number);
            if (page.id === null) break;
            page = await api.messages.continueList(page.id);
        }
        const rows = newest.map((header) => ({ id: header.id, from: clean_line(header.author), subject: clean_line(header.subject), date: iso_date(header.date), folder, read: header.read === true, flagged: header.flagged === true }));
        return fit_rows(rows, (kept, truncated) => ({ ok: true, messages: kept, truncated }), seen > rows.length);
    }

    async function message(request: Record<string, unknown>): Promise<Reply> {
        const { id } = request;
        if (!is_message_id(id)) return BAD_REQUEST;
        let header: ReadHeader;
        let root: FullPart;
        try {
            header = await api.messages.get(id);
            root = await api.messages.getFull(id, { decrypt: false });
        } catch {
            return NO_SUCH_MESSAGE;
        }
        if (is_encrypted(root)) return ENCRYPTED;
        let html_stripped = false;
        // Thunderbird's own converter turns HTML into text. It resolves no link and loads nothing.
        const text = await plain_body(root, (html) => ((html_stripped = true), api.messengerUtilities.convertToPlainText(html)));
        const body = cut_to_bytes(clean_body(text), MAX_BODY_BYTES);
        return {
            ok: true,
            message: {
                id,
                from: clean_line(header.author),
                to: (header.recipients ?? []).slice(0, MAX_RECIPIENTS).map(clean_line),
                subject: clean_line(header.subject),
                date: iso_date(header.date),
                // The root of `getFull` is always `message/rfc822`. The message's own top-level type is its first part.
                content_type: clean_line(root.parts?.[0]?.contentType ?? root.contentType),
                body: body.text,
                untrusted: true,
                html_stripped,
                truncated: body.cut,
            },
        };
    }

    async function attachments(request: Record<string, unknown>): Promise<Reply> {
        const { id } = request;
        if (!is_message_id(id)) return BAD_REQUEST;
        let listed: Awaited<ReturnType<ReadsApi["messages"]["listAttachments"]>>;
        try {
            // `listAttachments` decrypts an encrypted message, which can ask for a passphrase and lists encrypted names. So the check comes first.
            if (is_encrypted(await api.messages.getFull(id, { decrypt: false }))) return ENCRYPTED;
            listed = await api.messages.listAttachments(id);
        } catch {
            return NO_SUCH_MESSAGE;
        }
        // Names and sizes only. The bytes never leave.
        const rows = listed.slice(0, MAX_ATTACHMENTS).map((attachment) => ({ part: clean_line(attachment.partName), name: safe_filename(attachment.name ?? "", "attachment"), size: attachment.size ?? 0, content_type: clean_line(attachment.contentType) }));
        return fit_rows(rows, (kept, truncated) => ({ ok: true, attachments: kept, truncated }), listed.length > MAX_ATTACHMENTS);
    }

    async function contacts(request: Record<string, unknown>): Promise<Reply> {
        const { query, limit = MAX_CONTACTS } = request;
        if (typeof query !== "string" || query.length > MAX_QUERY_CHARS || query.replace(CONTROL_OR_FORMAT, "") !== query || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_CONTACTS) return BAD_REQUEST;
        // Thunderbird matches each word on its own, so one short word among long ones would still list a large part of the book. Every word must be long enough.
        const words = query.split(/\s+/).filter((word) => word !== "");
        if (words.length === 0 || words.some((word) => Array.from(word).length < MIN_QUERY_WORD_CHARS)) return QUERY_TOO_SHORT;
        if (words.length > MAX_QUERY_WORDS) return BAD_REQUEST;
        if (!(await deps.address_books_granted())) return NO_CONTACTS_PERMISSION;
        let found: ReadContact[];
        try {
            // The four flags default to true in Thunderbird's schema, so each is spelled out to keep the choice in view. `includeRemote: false` leaves out LDAP books, which a search would send the typed name to. A CardDAV book reports `remote: false` (it is a synced copy in a local database), so it is still searched: the API gives no way to tell it from a local book.
            found = await api.contacts.quickSearch({ searchString: words.join(" "), includeLocal: true, includeRemote: false, includeReadOnly: true, includeReadWrite: true });
        } catch {
            return CONTACTS_FAILED;
        }
        const rows = found
            .filter((node) => node.type === "contact" && node.remote !== true)
            .map((node) => ({ name: contact_name(node), emails: contact_emails(node) }))
            .filter((row) => row.emails.length > 0);
        // Only name and bare addresses are copied. The rest of the node is never read, so it cannot leak by a later field.
        return fit_rows(rows.slice(0, limit as number), (kept, truncated) => ({ ok: true, contacts: kept, untrusted: true, truncated }), rows.length > (limit as number));
    }

    const READERS: Record<ReadVerb, (request: Record<string, unknown>) => Promise<Reply>> = { folders, messages, message, attachments, contacts };

    /** Answers one read frame. The settings are read from storage now, so a setting turned off a moment ago already refuses. */
    async function read(verb: ReadVerb, request: Record<string, unknown>): Promise<Reply> {
        const settings = await deps.read_settings();
        if (!settings.bridge) return refuse("the bridge is off, set bridge to true");
        const gate = GATES[verb];
        if (!gate.settings.every((name) => settings[name])) return refuse(gate.refusal);
        return READERS[verb](request);
    }

    return { read };
}
