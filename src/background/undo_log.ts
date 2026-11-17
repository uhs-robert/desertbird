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
    /** The Date header and the size, which tell apart two copies that share a Message-ID. */
    date_ms?: number;
    size?: number;
}

export interface StateItem {
    header_message_id: string;
    folder_id: string;
    /** The value before the change, which the undo writes back. */
    old: boolean;
}

export type MoveAction = "delete" | "archive" | "move";
export type StateField = "read" | "flagged" | "junk";

/** `refused` marks an entry whose undo found a message missing once. The next undo of it drops what is still missing. */
export type UndoEntry = ({ kind: "moved"; action: MoveAction; items: MovedItem[] } | { kind: "state"; field: StateField; items: StateItem[] }) & { id: string; refused?: true };

/** An entry before the log gives it an id. */
export type NewUndoEntry = { kind: "moved"; action: MoveAction; items: MovedItem[] } | { kind: "state"; field: StateField; items: StateItem[] };

interface UndoRecord {
    record_version: number;
    /** Oldest first. */
    entries: UndoEntry[];
}

/** What one undo of an entry did. The items in `left` stay in the entry, `refused` marks it, and `refusal` says why. `undone` and `dropped` count the messages. */
export interface UndoOutcome {
    left: UndoEntry["items"];
    refusal?: string;
    refused?: true;
    undone?: number;
    dropped?: number;
}

export interface UndoLog {
    /** Runs `change` with the log held, then stores the last entry it passed to `keep`, even when it throws: a change that failed part way keeps what it did. The mail call goes inside, so a `u` pressed during it waits for the entry. */
    record(change: (keep: (entry: NewUndoEntry) => void) => Promise<void>): Promise<void>;
    /**
     * Runs after any undo before it. Takes the newest entry, runs `wait` on it without the log, then `undo` with the log held, and stores the outcome. The wait can last seconds, and an `x` pressed meanwhile must not wait with it.
     * Answers undefined when no entry is left to take, else the entry and the outcome.
     */
    undo_newest(wait: (entry: UndoEntry) => Promise<void>, undo: (entry: UndoEntry) => Promise<UndoOutcome>): Promise<{ entry: UndoEntry; outcome: UndoOutcome } | undefined>;
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
    if ((value as { refused?: unknown } | null)?.refused !== undefined && (value as { refused?: unknown }).refused !== true) return false;
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
    // Undos run one at a time in their own queue, so two quick `u` presses apply in stack order, and a `u` pressed during a wait gets the entry if it stays. Mail changes do not wait in this queue.
    let undoing: Promise<unknown> = Promise.resolve();
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
        undo_newest(wait, undo) {
            const result = undoing.then(() => undo_one(wait, undo));
            undoing = result.catch(() => {});
            return result;
        },
    };

    async function undo_one(wait: (entry: UndoEntry) => Promise<void>, undo: (entry: UndoEntry) => Promise<UndoOutcome>): Promise<{ entry: UndoEntry; outcome: UndoOutcome } | undefined> {
        const taken = await hold(async () => (await store.read()).entries.at(-1));
        if (taken === undefined) return undefined;
        await wait(taken);
        return hold(async () => {
            // The cap can drop the entry while the wait ran.
            const entry = (await store.read()).entries.find((other) => other.id === taken.id);
            if (entry === undefined) return undefined;
            const outcome = await undo(entry);
            const left = outcome.left.length === 0 ? undefined : ({ ...entry, items: outcome.left, ...(outcome.refused && { refused: true }) } as UndoEntry);
            await store.update((record) => ({ value: { ...record, entries: record.entries.flatMap((other) => (other.id !== entry.id ? [other] : left ? [left] : [])) }, result: undefined }));
            return { entry, outcome };
        });
    }
}
