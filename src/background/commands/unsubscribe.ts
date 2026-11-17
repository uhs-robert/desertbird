import { unsubscribe as unsubscribe_handler } from "../handlers/unsubscribe.ts";
import type { UnsubscribeApi } from "../handlers/unsubscribe.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const unsubscribe: CommandGroup = {
    commands: {
        "msg.unsubscribe": {
            bridge: false,
            runs_in: "background",
            label: "Unsubscribe",
            intent: "Unsubscribe from the mailing list of the selected message. The first press previews, the second acts.",
            // `.` must never replay the second step on another message.
            repeatable: false,
            run: scoped<UnsubscribeApi>((scope, args) => unsubscribe_handler(scope, args)),
        },
    },
    normal_keys: { gu: { id: "msg.unsubscribe" } },
};
