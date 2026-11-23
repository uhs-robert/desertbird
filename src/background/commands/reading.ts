import { find_in_message } from "../handlers/message_find.ts";
import type { MessageFindApi } from "../handlers/message_find.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// Most of these commands run in the body script of the message document (`runs_in: "message"`), so they carry no handler here. `search.message` runs here and sends its pattern to the body script. Their keys live in their own keymap, `message_keys`, because `j` and `k` mean the thread list in the mail tab and scrolling in a message.
export const reading: CommandGroup = {
    commands: needing("body", {
        "message.scroll_down": { runs_in: "message", bridge: true, label: "Scroll down", intent: "Scroll the message down by a line.", count: "repeat" },
        "message.scroll_up": { runs_in: "message", bridge: true, label: "Scroll up", intent: "Scroll the message up by a line.", count: "repeat" },
        "message.half_page_down": { runs_in: "message", bridge: true, label: "Scroll half a page down", intent: "Scroll the message down by half a page.", count: "repeat" },
        "message.half_page_up": { runs_in: "message", bridge: true, label: "Scroll half a page up", intent: "Scroll the message up by half a page.", count: "repeat" },
        "message.page_down": { runs_in: "message", bridge: true, label: "Scroll a page down", intent: "Scroll the message down by a page.", count: "repeat" },
        "message.page_up": { runs_in: "message", bridge: true, label: "Scroll a page up", intent: "Scroll the message up by a page.", count: "repeat" },
        "message.scroll_left": { runs_in: "message", bridge: true, label: "Scroll left", intent: "Scroll the message to the left.", count: "repeat" },
        "message.scroll_right": { runs_in: "message", bridge: true, label: "Scroll right", intent: "Scroll the message to the right.", count: "repeat" },
        "message.top": { runs_in: "message", bridge: true, label: "Go to top", intent: "Scroll to the top of the message." },
        "message.bottom": { runs_in: "message", bridge: true, label: "Go to bottom", intent: "Scroll to the bottom of the message." },
        // `n` and `N` follow the find line, so they need `tab` as `find` does.
        "message.find_next": { runs_in: "message", bridge: true, needs: ["body", "tab"], label: "Next match", intent: "Go to the next match of the last find, wrapping.", count: "ignore" },
        "message.find_prev": { runs_in: "message", bridge: true, needs: ["body", "tab"], label: "Previous match", intent: "Go to the previous match of the last find, wrapping.", count: "ignore" },
        "hint.pick": {
            runs_in: "message",
            bridge: true,
            label: "Pick a link",
            intent: "Label the header and links, then open, focus or copy one.",
            count: "ignore",
            params: [{ name: "action", type: "enum", values: ["activate", "focus", "yank"], default: "activate", short: { focus: "f", yank: "y" }, description: { focus: "Focus the link.", yank: "Copy the address of the link, else its text." } }],
        },
        "search.message": {
            bridge: true,
            runs_in: "background",
            name: "find",
            // Find stays in the tabs of the main window: its line and its `n` and `N` have not been checked in a message window.
            needs: ["body", "tab"],
            label: "Find in the message",
            intent: "Highlight text in the message and go to the first match.",
            params: [{ name: "pattern", type: "string", description: "Find this text, case sensitive if it has a capital.", main: true, rest: true, pattern: "\\S" }],
            run: scoped<MessageFindApi>(find_in_message),
        },
    }),
    normal_keys: {},
    message_keys: {
        j: { id: "message.scroll_down" },
        k: { id: "message.scroll_up" },
        "<C-d>": { id: "message.half_page_down", label: "Half page down" },
        "<C-u>": { id: "message.half_page_up", label: "Half page up" },
        "<C-f>": { id: "message.page_down", label: "Page down" },
        "<C-b>": { id: "message.page_up", label: "Page up" },
        h: { id: "message.scroll_left" },
        l: { id: "message.scroll_right" },
        gg: { id: "message.top" },
        G: { id: "message.bottom" },
        "/": { id: "cmdline.open", args: { text: "find " }, label: "Find in message" },
        n: { id: "message.find_next" },
        N: { id: "message.find_prev" },
        f: { id: "hint.pick", label: "Click link" },
        ";f": { id: "hint.pick", args: { action: "focus" }, label: "Focus link" },
        ";c": { id: "hint.pick", args: { action: "activate" }, label: "Click link" },
        ";y": { id: "hint.pick", args: { action: "yank" }, label: "Copy link" },
    },
};
