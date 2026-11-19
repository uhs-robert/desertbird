import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { CommandGroup } from "./define.ts";
import { app } from "./app.ts";
import { cmdline } from "./cmdline.ts";
import { help } from "./help.ts";
import { tabs } from "./tabs.ts";

// Reading keys of the tabs that are not the mail tab: calendar, tasks, settings, the address book, `about:` pages, search results and chat. The chrome page bundle runs them from a fixed table, so they carry no handler here, as the motions do.
export const page: CommandGroup = {
    commands: {
        "page.scroll_down": { runs_in: "chrome", bridge: false, label: "Scroll down", intent: "Scroll the page of the current tab down by a line.", count: "repeat" },
        "page.scroll_up": { runs_in: "chrome", bridge: false, label: "Scroll up", intent: "Scroll the page of the current tab up by a line.", count: "repeat" },
        "page.half_down": { runs_in: "chrome", bridge: false, label: "Scroll half a page down", intent: "Scroll the page of the current tab down by half a page.", count: "repeat" },
        "page.half_up": { runs_in: "chrome", bridge: false, label: "Scroll half a page up", intent: "Scroll the page of the current tab up by half a page.", count: "repeat" },
        "page.top": { runs_in: "chrome", bridge: false, label: "Go to top", intent: "Scroll the page of the current tab to the top." },
        "page.bottom": { runs_in: "chrome", bridge: false, label: "Go to bottom", intent: "Scroll the page of the current tab to the bottom." },
    },
    // The mail tab never reads these keys. The page keys are `PAGE_KEYS`, and `page_keymap.ts` compiles them.
    normal_keys: {},
};

const keys_of = (group: CommandGroup, ...sequences: string[]): NonNullable<KeymapConfig["normal"]> => Object.fromEntries(sequences.map((sequence) => [sequence, group.normal_keys[sequence]!]));

/** The default keys of a page tab. Existing commands reuse the binding of their own group, so a label has one source. `tab.close_mail` is left out on purpose: Ctrl+C and Ctrl+X must copy and cut in a page. */
export const PAGE_KEYS: NonNullable<KeymapConfig["normal"]> = {
    j: { id: "page.scroll_down" },
    k: { id: "page.scroll_up" },
    "<C-d>": { id: "page.half_down", label: "Half page down" },
    "<C-u>": { id: "page.half_up", label: "Half page up" },
    gg: { id: "page.top" },
    G: { id: "page.bottom" },
    ...keys_of(tabs, "q", "<A-q>", "<C-j>", "<C-k>"),
    ...keys_of(cmdline, ":"),
    ...keys_of(help, "g?"),
    ...keys_of(app, "gpa", "gpt", "gpc"),
};
