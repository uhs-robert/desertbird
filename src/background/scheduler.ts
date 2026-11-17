// Calls the add-on's features once a minute and at every background start. Shared by every feature that acts later (snooze, follow-up reminders).
//
// There is no due list here. Each feature keeps its own items in storage and reads what is due when its listener runs. Firefox alarms do not survive a restart, so `start` creates the repeating alarm again each time, and a time that passed while the browser was closed is handled by the run at start.
// A listener can run twice at once (an alarm tick during `start`), so it must act once on an item it already handles.

export const CATCH_UP_ALARM = "desertbird-catch-up";
export const CATCH_UP_PERIOD_MINUTES = 1;

export interface SchedulerApi {
    alarms: {
        create(name: string, info: { periodInMinutes: number }): unknown;
        onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
    };
}

export interface Scheduler {
    /** Registers the alarm listener, creates the repeating alarm and runs the listeners once. Call once per background start, after every `on_due` listener is added. */
    start(): Promise<void>;
    /** The listener receives the current time. It runs at start and on every tick. */
    on_due(listener: (now_ms: number) => void | Promise<void>): void;
}

export function create_scheduler(api: SchedulerApi, clock: () => number = Date.now): Scheduler {
    const listeners: ((now_ms: number) => void | Promise<void>)[] = [];

    async function run_listeners(): Promise<void> {
        const now_ms = clock();
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
                if (alarm.name === CATCH_UP_ALARM) run_listeners().catch(console.error);
            });
            api.alarms.create(CATCH_UP_ALARM, { periodInMinutes: CATCH_UP_PERIOD_MINUTES });
            await run_listeners();
        },
    };
}
