import { reply_with } from "../handlers/quick_reply.ts";
import type { QuickReplyApi } from "../handlers/quick_reply.ts";
import { QUICK_REPLY_SLOT_COUNT } from "../quick_reply_store.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

const slots = Array.from({ length: QUICK_REPLY_SLOT_COUNT }, (_, index) => index + 1);

export const quick_reply: CommandGroup = {
    commands: needing("message", {
        "msg.reply_with": {
            bridge: false,
            repeatable: false,
            runs_in: "background",
            label: "Reply with quick reply",
            intent: "Open a reply with the text of a quick reply slot. Never sends.",
            params: [{ name: "slot", type: "int", short: "s", min: 1, max: QUICK_REPLY_SLOT_COUNT, description: "Name the quick reply slot, 1 to 9." }],
            run: scoped<QuickReplyApi>(reply_with),
        },
    }),
    normal_keys: Object.fromEntries(slots.map((slot) => [`gr${slot}`, { id: "msg.reply_with", args: { slot }, label: `Slot ${slot}` }])),
};
