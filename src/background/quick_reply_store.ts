// The quick reply texts, kept in `storage.local`. Slot 1 to 9 each hold free text. An empty string is an empty slot. The options page and the background page both use this file.

import { create_record_store } from "./record_store.ts";
import type { RecordStorageApi } from "./record_store.ts";

export const QUICK_REPLY_STORAGE_KEY = "desertbird_quick_replies";
export const QUICK_REPLY_SLOT_COUNT = 9;

/** Bumped when the stored record changes shape. Add a step to `migrate_quick_reply_record` in the same change. */
export const QUICK_REPLY_RECORD_VERSION = 1;

interface QuickReplyRecord {
    record_version: number;
    slots: string[];
}

export interface QuickReplyStore {
    /** The nine texts, index 0 for slot 1. */
    read_all(): Promise<string[]>;
    /** The text of a slot from 1 to 9, "" when the slot is empty. */
    read_slot(slot: number): Promise<string>;
    write_all(slots: string[]): Promise<void>;
}

const empty_slots = (): string[] => Array.from({ length: QUICK_REPLY_SLOT_COUNT }, () => "");

/** The hook for a change to the stored shape: turn each older version into the next one here, then fall through to the current check. A record from a newer version reads as empty. */
export function migrate_quick_reply_record(stored: unknown): QuickReplyRecord | undefined {
    const record = stored as { record_version?: unknown; slots?: unknown } | null | undefined;
    if (record?.record_version !== QUICK_REPLY_RECORD_VERSION || !Array.isArray(record.slots)) return undefined;
    const stored_slots: unknown[] = record.slots;
    const slots = empty_slots().map((_, index) => (typeof stored_slots[index] === "string" ? stored_slots[index] : ""));
    return { record_version: QUICK_REPLY_RECORD_VERSION, slots };
}

export function create_quick_reply_store(api: RecordStorageApi): QuickReplyStore {
    const store = create_record_store<QuickReplyRecord>(api, { key: QUICK_REPLY_STORAGE_KEY, empty: () => ({ record_version: QUICK_REPLY_RECORD_VERSION, slots: empty_slots() }), migrate: migrate_quick_reply_record });
    return {
        read_all: async () => [...(await store.read()).slots],
        read_slot: async (slot) => (await store.read()).slots[slot - 1] ?? "",
        write_all: (slots) => store.update(() => ({ value: { record_version: QUICK_REPLY_RECORD_VERSION, slots: empty_slots().map((_, index) => slots[index] ?? "") }, result: undefined })),
    };
}
