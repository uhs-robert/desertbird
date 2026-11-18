import { snooze_messages } from "../handlers/snooze.ts";
import type { SnoozeApi } from "../handlers/snooze.ts";
import type { NotificationsApi } from "../notify.ts";
import { SNOOZE_PRESETS } from "../snooze_presets.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const snooze: CommandGroup = {
    commands: {
        "msg.snooze": {
            bridge: false,
            repeatable: false,
            runs_in: "background",
            label: "Snooze",
            intent: "Hide the selected messages until a chosen time. They wait in a Snoozed folder, then return to the Inbox as unread.",
            params: [
                {
                    name: "until",
                    type: "enum",
                    values: [...SNOOZE_PRESETS],
                    description: { later_today: "Return later today.", tomorrow: "Return tomorrow at 08:00.", weekend: "Return on Saturday at 08:00.", monday: "Return on Monday at 08:00." },
                },
            ],
            run: scoped<SnoozeApi & NotificationsApi>(snooze_messages),
        },
    },
    normal_keys: {
        mzl: { id: "msg.snooze", args: { until: "later_today" }, label: "Later today" },
        mzt: { id: "msg.snooze", args: { until: "tomorrow" }, label: "Tomorrow" },
        mzw: { id: "msg.snooze", args: { until: "weekend" }, label: "Weekend" },
        mzm: { id: "msg.snooze", args: { until: "monday" }, label: "Monday" },
    },
};
