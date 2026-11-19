import { open_message, yank } from "../handlers/clipboard.ts";
import type { ClipboardApi } from "../handlers/clipboard.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

const yank_key = (field: string, label: string) => ({ id: "msg.yank", args: { field }, label });

export const clipboard: CommandGroup = {
    commands: {
        "msg.yank": {
            bridge: false,
            runs_in: "background",
            label: "Yank",
            intent: "Copy a field of the selected message as plain text.",
            params: [
                {
                    name: "field",
                    type: "enum",
                    values: ["content", "subject", "sender", "address", "message_id"],
                    default: "content",
                    short: { subject: "s", sender: "f", address: "a", message_id: "i" },
                    description: { subject: "Copy the subject.", sender: "Copy the sender with name and address.", address: "Copy the sender address only.", message_id: "Copy the Message-ID header value." },
                },
            ],
            run: scoped<ClipboardApi>((scope, args) => yank(scope, args)),
        },
        "msg.open": { bridge: false, runs_in: "background", label: "Open", intent: "Open the selected message in a tab.", run: scoped<ClipboardApi>(open_message) },
    },
    normal_keys: {
        yy: yank_key("content", "Message"),
        ys: yank_key("subject", "Subject"),
        yf: yank_key("sender", "Sender"),
        ya: yank_key("address", "Address"),
        yi: yank_key("message_id", "Message ID"),
        "<C-l>": { id: "msg.open", label: "Open message" },
    },
};
