import { needing } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// Reading keys of the tabs that are not the mail tab: calendar, tasks, settings, the address book, `about:` pages, search results and chat. The chrome page bundle runs them from a fixed table, so they carry no handler here, as the motions do.
export const page: CommandGroup = {
    commands: needing("tab", {
        "page.scroll_down": { runs_in: "chrome", bridge: false, label: "Scroll down", intent: "Scroll the page of the current tab down by a line.", count: "repeat" },
        "page.scroll_up": { runs_in: "chrome", bridge: false, label: "Scroll up", intent: "Scroll the page of the current tab up by a line.", count: "repeat" },
        "page.half_down": { runs_in: "chrome", bridge: false, label: "Scroll half a page down", intent: "Scroll the page of the current tab down by half a page.", count: "repeat" },
        "page.half_up": { runs_in: "chrome", bridge: false, label: "Scroll half a page up", intent: "Scroll the page of the current tab up by half a page.", count: "repeat" },
        "page.page_down": { runs_in: "chrome", bridge: false, label: "Scroll a page down", intent: "Scroll the page of the current tab down by a page.", count: "repeat" },
        "page.page_up": { runs_in: "chrome", bridge: false, label: "Scroll a page up", intent: "Scroll the page of the current tab up by a page.", count: "repeat" },
        "page.scroll_left": { runs_in: "chrome", bridge: false, label: "Scroll left", intent: "Scroll the page of the current tab to the left.", count: "repeat" },
        "page.scroll_right": { runs_in: "chrome", bridge: false, label: "Scroll right", intent: "Scroll the page of the current tab to the right.", count: "repeat" },
        "page.top": { runs_in: "chrome", bridge: false, label: "Go to top", intent: "Scroll the page of the current tab to the top." },
        "page.bottom": { runs_in: "chrome", bridge: false, label: "Go to bottom", intent: "Scroll the page of the current tab to the bottom." },
    }),
    normal_keys: {},
    page_keys: {
        j: { id: "page.scroll_down" },
        k: { id: "page.scroll_up" },
        "<C-d>": { id: "page.half_down", label: "Half page down" },
        "<C-u>": { id: "page.half_up", label: "Half page up" },
        "<C-f>": { id: "page.page_down", label: "Page down" },
        "<C-b>": { id: "page.page_up", label: "Page up" },
        h: { id: "page.scroll_left" },
        l: { id: "page.scroll_right" },
        gg: { id: "page.top" },
        G: { id: "page.bottom" },
    },
};
