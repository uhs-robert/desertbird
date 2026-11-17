// Pure time math for the snooze presets. Local time, with the clock passed in.

export const SNOOZE_PRESETS = ["later_today", "tomorrow", "weekend", "monday"] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

const MORNING_HOUR = 8;
const LATER_TODAY_HOURS = 3;
const LATE_EVENING_HOUR = 23;
const SATURDAY = 6;
const MONDAY = 1;

function at_morning(now: Date, days_ahead: number): Date {
    const day = new Date(now);
    day.setDate(day.getDate() + days_ahead);
    day.setHours(MORNING_HOUR, 0, 0, 0);
    return day;
}

/** The next full hour at least three hours out, kept before 23:00. Late in the evening there is no such time, so it is one hour from now. */
function later_today(now: Date): Date {
    const candidate = new Date(now);
    candidate.setHours(candidate.getHours() + LATER_TODAY_HOURS + 1, 0, 0, 0);
    const evening = new Date(now);
    evening.setHours(LATE_EVENING_HOUR, 0, 0, 0);
    const result = candidate < evening ? candidate : evening;
    return result > now ? result : new Date(now.getTime() + 60 * 60 * 1000);
}

/** The due time in epoch milliseconds. `weekend` is the coming Saturday 08:00 and `monday` the coming Monday 08:00, always on a later day than `now`. */
export function preset_due_ms(preset: SnoozePreset, now: Date): number {
    switch (preset) {
        case "later_today":
            return later_today(now).getTime();
        case "tomorrow":
            return at_morning(now, 1).getTime();
        case "weekend":
            return at_morning(now, ((SATURDAY - now.getDay() + 7) % 7) || 7).getTime();
        case "monday":
            return at_morning(now, ((MONDAY - now.getDay() + 7) % 7) || 7).getTime();
    }
}
