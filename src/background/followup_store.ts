// The follow-up reminders, kept in `storage.local`. A message changes its numeric id when it moves, so an item names the anchor by its Message-ID header and the account it is in.

import { create_record_store } from "./record_store.ts";
import type { RecordStorageApi } from "./record_store.ts";

export const FOLLOWUP_STORAGE_KEY = "desertbird_followups";

/** Bumped when the stored record changes shape. Add a step to `migrate_followup_record` in the same change. */
export const FOLLOWUP_RECORD_VERSION = 1;

export interface FollowupItem {
    header_message_id: string;
    /** The account of the anchor. Its Inbox is where the reply check looks. */
    account_id: string;
    /** The date of the anchor. Only messages newer than this can be its reply. */
    anchor_date_ms: number;
    due_ms: number;
}

interface FollowupRecord {
    record_version: number;
    items: FollowupItem[];
}

/** Tells a due item's handler whether the item is still stored. A cancel that lands while the handler works makes it false. */
export type StillWanted = () => Promise<boolean>;

export interface FollowupStore {
    list(): Promise<FollowupItem[]>;
    /** A message reminded again replaces its earlier item. */
    add(item: FollowupItem): Promise<void>;
    /** True when an item was stored for the message. */
    remove(header_message_id: string, account_id: string): Promise<boolean>;
    /**
     * Runs `fire` on each due item and removes the item once `fire` returns. A throw keeps the item for the next tick. An item whose fire is still running is skipped, and so is an item a cancel removed or a new reminder replaced since this tick read its list.
     * `fire` must be safe to repeat, because a quit during a fire repeats it at the next start, and it must call `still_wanted` right before any visible effect.
     */
    fire_due(now_ms: number, fire: (item: FollowupItem, still_wanted: StillWanted) => Promise<void>): Promise<void>;
}

function is_item(value: unknown): value is FollowupItem {
    const item = value as Partial<FollowupItem> | null;
    return typeof item?.header_message_id === "string" && typeof item.account_id === "string" && Number.isFinite(item.anchor_date_ms) && Number.isFinite(item.due_ms);
}

/** The hook for a change to the stored shape: turn each older version into the next one here, then fall through to the current check. A record from a newer version reads as empty. */
export function migrate_followup_record(stored: unknown): FollowupRecord | undefined {
    const record = stored as { record_version?: unknown; items?: unknown } | null | undefined;
    if (record?.record_version !== FOLLOWUP_RECORD_VERSION || !Array.isArray(record.items)) return undefined;
    return { record_version: FOLLOWUP_RECORD_VERSION, items: record.items.filter(is_item) };
}

const same_message = (a: FollowupItem, b: Pick<FollowupItem, "header_message_id" | "account_id">) => a.header_message_id === b.header_message_id && a.account_id === b.account_id;
const key_of = (item: FollowupItem) => JSON.stringify([item.account_id, item.header_message_id]);

export function create_followup_store(api: RecordStorageApi): FollowupStore {
    const store = create_record_store<FollowupRecord>(api, { key: FOLLOWUP_STORAGE_KEY, empty: () => ({ record_version: FOLLOWUP_RECORD_VERSION, items: [] }), migrate: migrate_followup_record });
    const firing = new Set<string>();
    // The due time is part of the match: a reminder set again while the old one fires is a new item and must survive.
    const is_stored = async (item: FollowupItem) => (await store.read()).items.some((other) => same_message(other, item) && other.due_ms === item.due_ms);
    const remove_exact = (item: FollowupItem) =>
        store.update((record) => ({ value: { ...record, items: record.items.filter((other) => !(same_message(other, item) && other.due_ms === item.due_ms)) }, result: undefined }));
    return {
        list: async () => (await store.read()).items,
        add: (item) => store.update((record) => ({ value: { ...record, items: [...record.items.filter((other) => !same_message(other, item)), item] }, result: undefined })),
        remove: (header_message_id, account_id) =>
            store.update((record) => {
                const items = record.items.filter((other) => !same_message(other, { header_message_id, account_id }));
                return { value: { ...record, items }, result: items.length < record.items.length };
            }),
        async fire_due(now_ms, fire) {
            for (const item of (await store.read()).items.filter((stored) => stored.due_ms <= now_ms)) {
                const key = key_of(item);
                if (firing.has(key)) continue;
                // Claimed before the first await, or two ticks both pass the check.
                firing.add(key);
                try {
                    if (!(await is_stored(item))) continue;
                    await fire(item, () => is_stored(item));
                    await remove_exact(item);
                } catch (error) {
                    console.error("desertbird follow-up:", error);
                } finally {
                    firing.delete(key);
                }
            }
        },
    };
}
