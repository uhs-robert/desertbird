// Pure time math for the follow-up presets. A day is 24 hours, so a clock change moves the local time of day by an hour and nothing else.

export const FOLLOWUP_PRESETS = ["one_day", "three_days", "one_week"] as const;
export type FollowupPreset = (typeof FOLLOWUP_PRESETS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESET_DAYS: Record<FollowupPreset, number> = { one_day: 1, three_days: 3, one_week: 7 };

/** The due time in epoch milliseconds: `after` from `now`. */
export function followup_due_ms(after: FollowupPreset, now: Date): number {
    return now.getTime() + PRESET_DAYS[after] * DAY_MS;
}
