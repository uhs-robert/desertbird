import { archive, delete_messages, reply } from "../handlers/message.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const messages: CommandGroup = {
    commands: {
        "msg.archive": { bridge: false, runs_in: "background", label: "Archive", intent: "Archive the selected messages.", run: scoped(archive) },
        "msg.delete": { bridge: false, runs_in: "background", label: "Delete", intent: "Move the selected messages to Trash.", run: scoped(delete_messages) },
        "msg.reply": {
            bridge: false,
            runs_in: "background",
            label: "Reply",
            intent: "Reply to the sender of the selected message.",
            params: [{ name: "to", type: "enum", values: ["sender"], default: "sender" }],
            run: scoped(reply),
        },
    },
    normal_keys: {
        x: { id: "msg.archive" },
        dd: { id: "msg.delete" },
        r: { id: "msg.reply", args: { to: "sender" } },
    },
};
