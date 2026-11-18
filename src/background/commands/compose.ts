import { edit_external, forward, new_message, reply } from "../handlers/compose.ts";
import type { EditExternalApi } from "../handlers/compose.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const compose: CommandGroup = {
    commands: {
        "msg.reply": {
            bridge: false,
            runs_in: "background",
            label: "Reply",
            intent: "Reply to the sender, to all, or to the list.",
            params: [{ name: "to", type: "enum", values: ["sender", "all", "list"], default: "sender", short: { all: "a", list: "l" }, description: { all: "Reply to every recipient.", list: "Reply to the mailing list." } }],
            run: scoped(reply),
        },
        "msg.forward": { bridge: false, runs_in: "background", label: "Forward", intent: "Forward the selected message.", run: scoped(forward) },
        "msg.new": { bridge: false, runs_in: "background", label: "New message", intent: "Write a new message.", run: scoped(new_message) },
        // Ctrl+E in the compose body runs it through the compose script. It has no key in the mail window, which has no message being written.
        "compose.edit_external": {
            bridge: false,
            runs_in: "background",
            name: "edit",
            label: "Edit in external editor",
            intent: "Edit the message in the external editor.",
            run: scoped<EditExternalApi>(edit_external),
        },
    },
    normal_keys: {
        r: { id: "msg.reply", args: { to: "sender" } },
        R: { id: "msg.reply", args: { to: "all" } },
        gF: { id: "msg.forward", label: "Forward" },
        c: { id: "msg.new" },
    },
};
