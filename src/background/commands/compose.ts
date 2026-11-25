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
        // A save keeps the window open and leaves the text where it is.
        "compose.save": {
            bridge: false,
            runs_in: "background",
            needs: ["compose"],
            name: "save",
            label: "Save draft",
            intent: "Save the message of the compose window as a draft. The window stays open.",
            run: scoped<SaveDraftApi>(save_draft),
        },
        // The three below run in the chrome runtime of the compose window (`composewin`), which takes the leaf from its fixed table.
        "compose.focus": {
            bridge: false,
            runs_in: "chrome",
            needs: ["compose"],
            label: "Go to field",
            intent: "Move the focus to a field of the compose window. A hidden Cc or Bcc row shows.",
            params: [{ name: "field", type: "enum", values: ["to", "cc", "bcc", "subject", "body"], description: { to: "Go to the To field.", cc: "Go to the Cc field and show its row.", bcc: "Go to the Bcc field and show its row.", subject: "Go to the subject.", body: "Go to the message body." } }],
        },
        // Thunderbird's own close command, so a changed draft asks to save. `windows.remove` would drop it with no prompt (measured).
        "compose.close": { bridge: false, runs_in: "chrome", needs: ["compose"], label: "Close", intent: "Close the compose window. Thunderbird asks first when the draft has unsaved changes." },
        "compose.send": {
            bridge: false,
            runs_in: "chrome",
            needs: ["compose"],
            label: "Send",
            intent: "Send the message as Ctrl+Enter does. Thunderbird's checks and send confirm apply. Runs only while the compose_send setting is on.",
        },
    }),
    compose_keys: {
        e: { id: "compose.edit_external", label: "Edit in external editor" },
        s: { id: "compose.save", label: "Save draft" },
        "?": { id: "help.open", label: "Open help" },
        "g?": { id: "help.open", label: "Open help" },
        "<A-?>": { id: "help.whichkey", label: "Show keys" },
        gt: { id: "compose.focus", args: { field: "to" }, label: "To" },
        gc: { id: "compose.focus", args: { field: "cc" }, label: "Cc" },
        gb: { id: "compose.focus", args: { field: "bcc" }, label: "Bcc" },
        gs: { id: "compose.focus", args: { field: "subject" }, label: "Subject" },
        gm: { id: "compose.focus", args: { field: "body" }, label: "Message body" },
        gS: { id: "compose.send", label: "Send" },
        q: { id: "compose.close", label: "Close" },
    },
    normal_keys: {
        r: { id: "msg.reply", args: { to: "sender" } },
        R: { id: "msg.reply", args: { to: "all" } },
        gF: { id: "msg.forward", label: "Forward" },
        c: { id: "msg.new" },
    },
};
