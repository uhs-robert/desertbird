import type { CommandGroup } from "./define.ts";

// These commands run in the body script of the message document (`runs_in: "message"`), so they carry no handler here. Their keys live in their own keymap, `message_keys`, because `j` and `k` mean the thread list in the mail tab and scrolling in a message.
export const reading: CommandGroup = {
    commands: {
        "message.scroll_down": { runs_in: "message", bridge: true, label: "Scroll down", intent: "Scroll the message down by a line.", count: "repeat" },
        "message.scroll_up": { runs_in: "message", bridge: true, label: "Scroll up", intent: "Scroll the message up by a line.", count: "repeat" },
        "message.half_page_down": { runs_in: "message", bridge: true, label: "Scroll half a page down", intent: "Scroll the message down by half a page.", count: "repeat" },
        "message.half_page_up": { runs_in: "message", bridge: true, label: "Scroll half a page up", intent: "Scroll the message up by half a page.", count: "repeat" },
        "message.top": { runs_in: "message", bridge: true, label: "Go to top", intent: "Scroll to the top of the message." },
        "message.bottom": { runs_in: "message", bridge: true, label: "Go to bottom", intent: "Scroll to the bottom of the message." },
    },
    normal_keys: {},
    message_keys: {
        j: { id: "message.scroll_down" },
        k: { id: "message.scroll_up" },
        "<C-d>": { id: "message.half_page_down" },
        "<C-u>": { id: "message.half_page_up" },
        gg: { id: "message.top" },
        G: { id: "message.bottom" },
    },
};
