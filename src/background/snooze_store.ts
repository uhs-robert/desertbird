// The snoozed messages, kept in `storage.local`. A message changes its numeric id when it moves, so an item names it by its Message-ID header and the account it came from.

import { create_record_store } from "./record_store.ts";
import type { RecordStorageApi } from "./record_store.ts";

export const SNOOZE_STORAGE_KEY = "desertbird_snoozed";

/** Bumped when the stored record changes shape. Add a step to `migrate_snooze_record` in the same change. */
export const SNOOZE_RECORD_VERSION = 1;

export interface SnoozeItem {
    header_message_id: string;
    /** The account the message was in when snoozed. A wake returns it to this account's Inbox. */
    origin_account_id: string;
    due_ms: number;
}

interface SnoozeRecord {
    record_version: number;
    items: SnoozeItem[];
}

export interface SnoozeStore {
    list(): Promise<SnoozeItem[]>;
    /** A message snoozed again replaces its earlier item. */
    add(item: SnoozeItem): Promise<void>;
    /** Removes and returns the items due at `now_ms`. Two calls at once split the items between them, so a wake that fires twice acts once. */
    take_due(now_ms: number): Promise<SnoozeItem[]>;
}

function is_item(value: unknown): value is SnoozeItem {
    const item = value as Partial<SnoozeItem> | null;
    return typeof item?.header_message_id === "string" && typeof item.origin_account_id === "string" && Number.isFinite(item.due_ms);
}

/** The hook for a change to the stored shape: turn each older version into the next one here, then fall through to the current check. A record from a newer version reads as empty. */
export function migrate_snooze_record(stored: unknown): SnoozeRecord | undefined {
    const record = stored as { record_version?: unknown; items?: unknown } | null | undefined;
    if (record?.record_version !== SNOOZE_RECORD_VERSION || !Array.isArray(record.items)) return undefined;
    return { record_version: SNOOZE_RECORD_VERSION, items: record.items.filter(is_item) };
}

export function create_snooze_store(api: RecordStorageApi): SnoozeStore {
    const store = create_record_store<SnoozeRecord>(api, { key: SNOOZE_STORAGE_KEY, empty: () => ({ record_version: SNOOZE_RECORD_VERSION, items: [] }), migrate: migrate_snooze_record });
    return {
        list: async () => (await store.read()).items,
        add: (item) =>
            store.update((record) => ({
                value: { ...record, items: [...record.items.filter((other) => !(other.header_message_id === item.header_message_id && other.origin_account_id === item.origin_account_id)), item] },
                result: undefined,
            })),
        take_due: (now_ms) =>
            store.update((record) => ({
                value: { ...record, items: record.items.filter((item) => item.due_ms > now_ms) },
                result: record.items.filter((item) => item.due_ms <= now_ms),
            })),
    };
}
