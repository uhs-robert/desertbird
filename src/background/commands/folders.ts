import { open_folder } from "../handlers/folder_open.ts";
import type { FolderApi } from "../handlers/folder_open.ts";
import { jump_to_mark, set_mark } from "../handlers/folder_marks.ts";
import { collapse_folder } from "../handlers/folder_collapse.ts";
import type { CollapseApi } from "../handlers/folder_collapse.ts";
import { jump_back, jump_forward } from "../handlers/jump_history.ts";
import { ACCOUNT_PARAM } from "./account_param.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";
import type { CommandDefinition } from "./define.ts";

const SPECIAL = ["inbox", "trash", "drafts", "sent", "archive", "junk"];

// The slots the marks bind. A slot is one key, and the keymap holds one leaf per slot because the chrome matcher passes no typed key on to a command.
const SLOTS = [..."abcehijklnopqrstuvwxy"];
const SLOT_PARAM = { name: "slot", type: "string", main: true, pattern: `^[${SLOTS.join("")}]$`, description: "Name the one-letter slot of the mark." } as const;

const slot_keys = (prefix: string, id: string) => Object.fromEntries(SLOTS.map((slot) => [`${prefix}${slot}`, { id, args: { slot } }]));

// `o` opens the command line on `open `, so the path is typed or picked there. The folder pattern takes any word, because a fuzzy word like `proj` reaches the handler when Enter has no row to take. Every command here changes only what the view shows, except `mark.set`, which writes a mark.
export const folders: CommandGroup = {
    commands: {
        "folder.open": {
            name: "open",
            bridge: true,
            runs_in: "background",
            label: "Open a folder",
            intent: "Show a folder by its special use or its path. The shown account comes first.",
            params: [
                {
                    name: "special",
                    type: "enum",
                    optional: true,
                    values: SPECIAL,
                    description: { inbox: "Show the Inbox.", trash: "Show Trash.", drafts: "Show Drafts.", sent: "Show Sent.", archive: "Show Archives.", junk: "Show Junk." },
                },
                // Exactly one of the two. The default list makes the path required when no special use is given, and the arm refuses a path beside one. The plain pattern admits the empty text only because a default list value must match it.
                {
                    name: "folder",
                    type: "string",
                    main: true,
                    values: { from: "folders" },
                    default: [{ value: "", when: { special: SPECIAL } }],
                    pattern: "^(\\S.*)?$",
                    pattern_arms: [{ pattern: "^$", when: { special: SPECIAL } }],
                },
                ACCOUNT_PARAM,
            ],
            run: scoped<FolderApi>(open_folder),
        },
        "folder.collapse": {
            bridge: true,
            runs_in: "background",
            label: "Collapse a folder, or focus the folder pane",
            intent: "Close a folder or its parent. From another pane, focus the folder pane.",
            needs: ["keys.paneFocus"],
            run: scoped<CollapseApi>(collapse_folder),
        },
        "mark.set": { bridge: false, runs_in: "background", label: "Set a mark", intent: "Remember the shown folder under a one-letter slot.", params: [SLOT_PARAM], run: scoped<FolderApi>(set_mark) },
        "mark.jump": { bridge: true, runs_in: "background", label: "Jump to a mark", intent: "Show the folder a slot remembers.", params: [SLOT_PARAM], run: scoped<FolderApi>(jump_to_mark) },
        "jump.back": { bridge: true, runs_in: "background", label: "Back in folder history", intent: "Show the folder shown before this one. A count goes that many folders back.", count: "repeat", run: scoped<FolderApi>(jump_back) },
        "jump.forward": { bridge: true, runs_in: "background", label: "Forward in folder history", intent: "Show the next folder in the history, after a jump back.", count: "repeat", run: scoped<FolderApi>(jump_forward) },
    } satisfies Record<string, CommandDefinition>,
    normal_keys: {
        H: { id: "folder.collapse", label: "Collapse folder or go to folders" },
        gi: { id: "folder.open", args: { special: "inbox" }, label: "Inbox" },
        gt: { id: "folder.open", args: { special: "trash" }, label: "Trash" },
        gd: { id: "folder.open", args: { special: "drafts" }, label: "Drafts" },
        gs: { id: "folder.open", args: { special: "sent" }, label: "Sent" },
        "<C-o>": { id: "jump.back" },
        "<C-i>": { id: "jump.forward" },
        ...slot_keys("M", "mark.set"),
        ...slot_keys("'", "mark.jump"),
    },
};
