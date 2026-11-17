import { save_attachments } from "../handlers/attachments.ts";
import type { AttachmentsApi } from "../handlers/attachments.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const attachments: CommandGroup = {
    commands: {
        "msg.save_attachments": {
            bridge: false,
            runs_in: "background",
            label: "Save attachments",
            intent: "Save the attachments to a Downloads folder. Nothing is opened.",
            params: [
                {
                    name: "where",
                    type: "enum",
                    values: ["downloads", "ask"],
                    default: "downloads",
                    description: { ask: "Show the save dialog for each file." },
                },
            ],
            run: scoped<AttachmentsApi>((scope, args) => save_attachments(scope, args)),
        },
    },
    normal_keys: { ga: { id: "msg.save_attachments" } },
};
