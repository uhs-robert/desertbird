import { toggle_new_mail_notify } from "../new_mail_notify.ts";
import type { CommandGroup } from "./define.ts";
import { scoped } from "./define.ts";
import type { ConfigStorage } from "../config/store.ts";
import type { NotificationsApi } from "../notify.ts";

export const new_mail: CommandGroup = {
    commands: {
        "notify.toggle": {
            bridge: false,
            runs_in: "background",
            label: "Toggle new-mail notifications",
            intent: "Turn desktop notifications for new mail on or off. They are off by default.",
            repeatable: false,
            run: scoped<ConfigStorage & NotificationsApi>((scope) => toggle_new_mail_notify(scope)),
        },
    },
    normal_keys: {},
};
