// Wakes the add-on at chosen times. Shared by every feature that acts later (snooze, follow-up reminders).
//
// The due times live in `storage.local`. Firefox alarms do not survive a restart, so `start` creates them again on every background start. A catch-up alarm every minute covers an alarm that never fires, such as one missed while the computer slept.
// The scheduler only says that something may be due. Each feature keeps its own items and decides what is due, so a wake that fires twice must change nothing the second time.

import { create_record_store } from "./record_store.ts";
import type { RecordStorageApi } from "./record_store.ts";

export const DUE_STORAGE_KEY = "desertbird_scheduler_due";
export const CATCH_UP_ALARM = "desertbird-catch-up";
export const DUE_ALARM_PREFIX = "desertbird-due-";
export const CATCH_UP_PERIOD_MINUTES = 1;

/** Bumped when the stored record changes shape. */
const DUE_RECORD_VERSION = 1;

interface DueRecord {
    record_version: number;
    due_ms: number[];
}

export interface SchedulerApi extends RecordStorageApi {
    alarms: {
        create(name: string, info: { when?: number; periodInMinutes?: number }): unknown;
        onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
    };
}

export interface Scheduler {
    /** Registers the alarm listener, creates the alarms again and fires at once for what is overdue. Call once per background start, after every `on_due` listener is added. */
    start(): Promise<void>;
    /** Remembers a due time and sets an alarm for it. A time already past fires at once. */
    schedule(due_ms: number): Promise<void>;
    /** The listener runs when a due time is reached, on the catch-up alarm and at start. It receives the current time. */
    on_due(listener: (now_ms: number) => void | Promise<void>): void;
}

function migrate_due_record(stored: unknown): DueRecord | undefined {
    const record = stored as Partial<DueRecord> | null | undefined;
    if (record?.record_version !== DUE_RECORD_VERSION || !Array.isArray(record.due_ms)) return undefined;
    return { record_version: DUE_RECORD_VERSION, due_ms: record.due_ms.filter((due) => Number.isFinite(due)) };
}

export function create_scheduler(api: SchedulerApi, clock: () => number = Date.now): Scheduler {
    const store = create_record_store<DueRecord>(api, { key: DUE_STORAGE_KEY, empty: () => ({ record_version: DUE_RECORD_VERSION, due_ms: [] }), migrate: migrate_due_record });
    const listeners: ((now_ms: number) => void | Promise<void>)[] = [];

    const set_alarm = (due_ms: number) => void api.alarms.create(`${DUE_ALARM_PREFIX}${due_ms}`, { when: due_ms });

    // Drops every due time up to `through_ms`, sets alarms for the rest, then tells the listeners. Listeners run outside the store queue so one can call `schedule`.
    async function fire(through_ms: number): Promise<void> {
        const now_ms = Math.max(clock(), through_ms);
        const pending = await store.update((record) => {
            const pending = record.due_ms.filter((due) => due > now_ms);
            return { value: { ...record, due_ms: pending }, result: pending };
        });
        pending.forEach(set_alarm);
        for (const listener of listeners) {
            try {
                await listener(now_ms);
            } catch (error) {
                console.error("desertbird scheduler:", error);
            }
        }
    }

    return {
        on_due: (listener) => void listeners.push(listener),
        async start() {
            api.alarms.onAlarm.addListener((alarm) => {
                const is_due_alarm = alarm.name.startsWith(DUE_ALARM_PREFIX);
                if (alarm.name !== CATCH_UP_ALARM && !is_due_alarm) return;
                const alarm_due = is_due_alarm ? Number(alarm.name.slice(DUE_ALARM_PREFIX.length)) : 0;
                fire(Number.isFinite(alarm_due) ? alarm_due : 0).catch(console.error);
            });
            api.alarms.create(CATCH_UP_ALARM, { periodInMinutes: CATCH_UP_PERIOD_MINUTES });
            await fire(0);
        },
        async schedule(due_ms) {
            await store.update((record) => ({ value: { ...record, due_ms: record.due_ms.includes(due_ms) ? record.due_ms : [...record.due_ms, due_ms] }, result: undefined }));
            if (due_ms <= clock()) await fire(due_ms);
            else set_alarm(due_ms);
        },
    };
}
