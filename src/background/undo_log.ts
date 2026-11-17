// DesertBird's own undo stack, kept in `storage.local`. Thunderbird records no undo step for a change made through the API, so `u` reverses these entries instead. One stack serves every window. A message changes its numeric id when it moves, so an item names it by its Message-ID header and the folder it sits in.

import { create_record_store } from "./record_store.ts";
import type { RecordStorageApi } from "./record_store.ts";

export const UNDO_STORAGE_KEY = "desertbird_undo";

/** Bumped when the stored record changes shape. Add a step to `migrate_undo_record` in the same change. */
export const UNDO_RECORD_VERSION = 1;

/** The newest entries kept. An older one drops off, since the mail it names has likely changed by hand since. */
export const UNDO_STACK_LIMIT = 20;

export interface MovedItem {
    header_message_id: string;
    /** The folder the message came from, where an undo returns it. */
    from_folder_id: string;
    /** The folders the undo searches for the message. An archive lists every Archives folder, since Thunderbird picks the year folder itself. */
    to_folder_ids: string[];
    /** True for an archive, which files into year subfolders of Archives. */
    to_subfolders: boolean;
}

export interface StateItem {
    header_message_id: string;
    folder_id: string;
    /** The value before the change, which the undo writes back. */
    old: boolean;
}

export type MoveAction = "delete" | "archive" | "move";
export type StateField = "read" | "flagged" | "junk";

export type UndoEntry = { id: string; kind: "moved"; action: MoveAction; items: MovedItem[] } | { id: string; kind: "state"; field: StateField; items: StateItem[] };

/** An entry before the log gives it an id. */
export type NewUndoEntry = { kind: "moved"; action: MoveAction; items: MovedItem[] } | { kind: "state"; field: StateField; items: StateItem[] };

interface UndoRecord {
    record_version: number;
    /** Oldest first. */
    entries: UndoEntry[];
}

/** What one undo of the newest entry did: the items it could not undo stay in the entry, and `refusal` says why. */
export interface UndoOutcome {
    left: UndoEntry["items"];
    refusal?: string;
}

export interface UndoLog {
    /** Runs `change` with the log held, then stores the last entry it passed to `keep`, even when it throws: a change that failed part way keeps what it did. The mail call goes inside, so a `u` pressed during it waits for the entry. */
    record(change: (keep: (entry: NewUndoEntry) => void) => Promise<void>): Promise<void>;
    /** Runs `undo` on the newest entry with the log held, so two quick `u` presses never take the same entry. Answers undefined when the stack is empty, else the entry and the outcome. */
    undo_newest(undo: (entry: UndoEntry) => Promise<UndoOutcome>): Promise<{ entry: UndoEntry; outcome: UndoOutcome } | undefined>;
}

const is_string_list = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function is_moved_item(value: unknown): value is MovedItem {
    const item = value as Partial<MovedItem> | null;
    return typeof item?.header_message_id === "string" && typeof item.from_folder_id === "string" && is_string_list(item.to_folder_ids) && typeof item.to_subfolders === "boolean";
}

function is_state_item(value: unknown): value is StateItem {
    const item = value as Partial<StateItem> | null;
    return typeof item?.header_message_id === "string" && typeof item.folder_id === "string" && typeof item.old === "boolean";
}

function is_entry(value: unknown): value is UndoEntry {
    const entry = value as { id?: unknown; kind?: unknown; action?: unknown; field?: unknown; items?: unknown } | null;
    if (typeof entry?.id !== "string" || !Array.isArray(entry.items) || entry.items.length === 0) return false;
    if (entry.kind === "moved") return ["delete", "archive", "move"].includes(entry.action as string) && entry.items.every(is_moved_item);
    return entry.kind === "state" && ["read", "flagged", "junk"].includes(entry.field as string) && entry.items.every(is_state_item);
}

/** The hook for a change to the stored shape: turn each older version into the next one here, then fall through to the current check. A record from a newer version reads as empty. */
export function migrate_undo_record(stored: unknown): UndoRecord | undefined {
    const record = stored as { record_version?: unknown; entries?: unknown } | null | undefined;
    if (record?.record_version !== UNDO_RECORD_VERSION || !Array.isArray(record.entries)) return undefined;
    return { record_version: UNDO_RECORD_VERSION, entries: record.entries.filter(is_entry) };
}

export function create_undo_log(api: RecordStorageApi): UndoLog {
    const store = create_record_store<UndoRecord>(api, { key: UNDO_STORAGE_KEY, empty: () => ({ record_version: UNDO_RECORD_VERSION, entries: [] }), migrate: migrate_undo_record });
    // The store queues its own reads and writes. This queue holds the log across a whole mail change or undo, which spans several API calls.
    let held: Promise<unknown> = Promise.resolve();
    const hold = <R>(work: () => Promise<R>): Promise<R> => {
        const result = held.then(work);
        held = result.catch(() => {});
        return result;
    };

    return {
        record: (change) =>
            hold(async () => {
                let kept: NewUndoEntry | undefined;
                try {
                    await change((entry) => void (kept = entry));
                } finally {
                    if (kept !== undefined && kept.items.length > 0) {
                        const stored = { ...structuredClone(kept), id: crypto.randomUUID() } as UndoEntry;
                        await store.update((record) => ({ value: { ...record, entries: [...record.entries, stored].slice(-UNDO_STACK_LIMIT) }, result: undefined }));
                    }
                }
            }),
        undo_newest: (undo) =>
            hold(async () => {
                const entry = (await store.read()).entries.at(-1);
                if (entry === undefined) return undefined;
                const outcome = await undo(entry);
                const left = outcome.left.length === 0 ? undefined : ({ ...entry, items: outcome.left } as UndoEntry);
                await store.update((record) => ({ value: { ...record, entries: record.entries.flatMap((other) => (other.id !== entry.id ? [other] : left ? [left] : [])) }, result: undefined }));
                return { entry, outcome };
            }),
    };
}
