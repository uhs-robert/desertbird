import { cancel_followups, remind_messages } from "../handlers/followup.ts";
import type { FollowupApi } from "../handlers/followup.ts";
import { FOLLOWUP_PRESETS } from "../followup_presets.ts";
import type { NotificationsApi } from "../notify.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const followup: CommandGroup = {
    commands: needing("message", {
        "msg.remind": {
            bridge: false,
            repeatable: false,
            runs_in: "background",
            label: "Remind",
            intent: "Get a notice after a chosen time if no reply has come.",
            params: [
                {
                    name: "after",
                    type: "enum",
                    values: [...FOLLOWUP_PRESETS],
                    short: { one_day: "d", three_days: "t", one_week: "w" },
                    description: { one_day: "Remind after one day.", three_days: "Remind after three days.", one_week: "Remind after one week." },
                },
            ],
            run: scoped<FollowupApi & NotificationsApi>(remind_messages),
        },
        "msg.remind_cancel": {
            bridge: false,
            repeatable: false,
            runs_in: "background",
            label: "Cancel reminder",
            intent: "Drop the pending reminder and the Follow up tag.",
            run: scoped<FollowupApi & NotificationsApi>(cancel_followups),
        },
    }),
    normal_keys: {
        mfd: { id: "msg.remind", args: { after: "one_day" }, label: "In 1 day" },
        mft: { id: "msg.remind", args: { after: "three_days" }, label: "In 3 days" },
        mfw: { id: "msg.remind", args: { after: "one_week" }, label: "In 1 week" },
        mfc: { id: "msg.remind_cancel", label: "Cancel" },
    },
};
