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
    /** The items due at `now_ms`. They stay stored until `remove`. */
    due(now_ms: number): Promise<SnoozeItem[]>;
    /** Removes the item when it is still stored with the same due time, so a message snoozed again while its wake ran keeps its new item. */
    remove(item: SnoozeItem): Promise<void>;
    /**
     * Runs `wake` on each due item and removes the item once `wake` succeeds. A failed wake keeps the item for the next tick. An item whose wake is still running is skipped, so ticks that overlap wake it once.
     * The item leaves the store after the wake, never before, so a wake that fails at start (the account is not online yet) is not lost. `wake` must be safe to repeat, because a quit during a wake repeats it at the next start.
     */
    wake_due(now_ms: number, wake: (item: SnoozeItem) => Promise<void>): Promise<void>;
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

const same_message = (a: SnoozeItem, b: SnoozeItem) => a.header_message_id === b.header_message_id && a.origin_account_id === b.origin_account_id;
const key_of = (item: SnoozeItem) => JSON.stringify([item.origin_account_id, item.header_message_id]);

export function create_snooze_store(api: RecordStorageApi): SnoozeStore {
    const store = create_record_store<SnoozeRecord>(api, { key: SNOOZE_STORAGE_KEY, empty: () => ({ record_version: SNOOZE_RECORD_VERSION, items: [] }), migrate: migrate_snooze_record });
    const waking = new Set<string>();
    const due = async (now_ms: number) => (await store.read()).items.filter((item) => item.due_ms <= now_ms);
    const remove = (item: SnoozeItem) =>
        store.update((record) => ({ value: { ...record, items: record.items.filter((other) => !(same_message(other, item) && other.due_ms === item.due_ms)) }, result: undefined }));
    return {
        list: async () => (await store.read()).items,
        add: (item) => store.update((record) => ({ value: { ...record, items: [...record.items.filter((other) => !same_message(other, item)), item] }, result: undefined })),
        due,
        remove,
        async wake_due(now_ms, wake) {
            for (const item of await due(now_ms)) {
                const key = key_of(item);
                if (waking.has(key)) continue;
                waking.add(key);
                try {
                    await wake(item);
                    await remove(item);
                } catch (error) {
                    console.error("desertbird snooze wake:", error);
                } finally {
                    waking.delete(key);
                }
            }
        },
    };
}
