import { find_in_message } from "../handlers/message_find.ts";
import type { MessageFindApi } from "../handlers/message_find.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// Most of these commands run in the body script of the message document (`runs_in: "message"`), so they carry no handler here. `search.message` runs here and sends its pattern to the body script. Their keys live in their own keymap, `message_keys`, because `j` and `k` mean the thread list in the mail tab and scrolling in a message.
export const reading: CommandGroup = {
    commands: {
        "message.scroll_down": { runs_in: "message", bridge: true, label: "Scroll down", intent: "Scroll the message down by a line.", count: "repeat" },
        "message.scroll_up": { runs_in: "message", bridge: true, label: "Scroll up", intent: "Scroll the message up by a line.", count: "repeat" },
        "message.half_page_down": { runs_in: "message", bridge: true, label: "Scroll half a page down", intent: "Scroll the message down by half a page.", count: "repeat" },
        "message.half_page_up": { runs_in: "message", bridge: true, label: "Scroll half a page up", intent: "Scroll the message up by half a page.", count: "repeat" },
        "message.top": { runs_in: "message", bridge: true, label: "Go to top", intent: "Scroll to the top of the message." },
        "message.bottom": { runs_in: "message", bridge: true, label: "Go to bottom", intent: "Scroll to the bottom of the message." },
        "message.find_next": { runs_in: "message", bridge: true, label: "Next match", intent: "Go to the next match of the last find, wrapping.", count: "ignore" },
        "message.find_prev": { runs_in: "message", bridge: true, label: "Previous match", intent: "Go to the previous match of the last find, wrapping.", count: "ignore" },
        "hint.pick": { runs_in: "message", bridge: true, label: "Pick a link", intent: "Label the links on screen, then click the typed one.", count: "ignore" },
        "search.message": {
            bridge: true,
            runs_in: "background",
            name: "find",
            label: "Find in the message",
            intent: "Highlight text in the message and go to the first match.",
            params: [{ name: "pattern", type: "string", description: "Find this text, case sensitive if it has a capital.", main: true, rest: true, pattern: "\\S" }],
            run: scoped<MessageFindApi>(find_in_message),
        },
    },
    normal_keys: {},
    message_keys: {
        j: { id: "message.scroll_down" },
        k: { id: "message.scroll_up" },
        "<C-d>": { id: "message.half_page_down" },
        "<C-u>": { id: "message.half_page_up" },
        gg: { id: "message.top" },
        G: { id: "message.bottom" },
        "/": { id: "cmdline.open", args: { text: "find " } },
        n: { id: "message.find_next" },
        N: { id: "message.find_prev" },
        f: { id: "hint.pick" },
    },
};
