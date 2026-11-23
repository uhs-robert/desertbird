import { edit_external, forward, new_message, reply, save_draft } from "../handlers/compose.ts";
import type { EditExternalApi, SaveDraftApi } from "../handlers/compose.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const compose: CommandGroup = {
    commands: needing("message", {
        "msg.reply": {
            bridge: false,
            runs_in: "background",
            label: "Reply",
            intent: "Reply to the sender, to all, or to the list.",
            params: [{ name: "to", type: "enum", values: ["sender", "all", "list"], default: "sender", short: { all: "a", list: "l" }, description: { all: "Reply to every recipient.", list: "Reply to the mailing list." } }],
            run: scoped(reply),
        },
        "msg.forward": { bridge: false, runs_in: "background", label: "Forward", intent: "Forward the selected message.", run: scoped(forward) },
        "msg.new": { bridge: false, runs_in: "background", needs: ["main"], label: "New message", intent: "Write a new message.", run: scoped(new_message) },
        // Ctrl+E in the compose body runs it through the compose script. It has no key in the mail window, which has no message being written.
        "compose.edit_external": {
            bridge: false,
            runs_in: "background",
            needs: ["compose"],
            name: "edit",
            label: "Edit in external editor",
            intent: "Edit the message in the external editor.",
            run: scoped<EditExternalApi>(edit_external),
        },
        // A save keeps the window open and leaves the text where it is. It has no close or send beside it, so no key of a compose window can discard a draft.
        "compose.save": {
            bridge: false,
            runs_in: "background",
            needs: ["compose"],
            name: "save",
            label: "Save draft",
            intent: "Save the message of the compose window as a draft. The window stays open.",
            run: scoped<SaveDraftApi>(save_draft),
        },
    }),
    compose_keys: {
        e: { id: "compose.edit_external", label: "Edit in external editor" },
        s: { id: "compose.save", label: "Save draft" },
        "?": { id: "help.open", label: "Open help" },
    },
    normal_keys: {
        r: { id: "msg.reply", args: { to: "sender" } },
        R: { id: "msg.reply", args: { to: "all" } },
        gF: { id: "msg.forward", label: "Forward" },
        c: { id: "msg.new" },
    },
};
