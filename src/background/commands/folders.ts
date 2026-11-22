import { open_folder } from "../handlers/folder_open.ts";
import type { FolderApi, FolderFocusApi } from "../handlers/folder_open.ts";
import { jump_to_mark, set_mark } from "../handlers/folder_marks.ts";
import { collapse_folder } from "../handlers/folder_collapse.ts";
import type { CollapseApi } from "../handlers/folder_collapse.ts";
import { jump_back, jump_forward } from "../handlers/jump_history.ts";
import { ACCOUNT_PARAM } from "./account_param.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

const SPECIAL = ["inbox", "trash", "drafts", "sent", "archive", "junk"];

// The slot is a `key` param that the bindings leave out, so the key press after `M` or `'` fills it (`with_captures` in `commands/captures.ts` builds the branch).
const SLOT_PARAM = { name: "slot", type: "key", description: "Name the one-key slot of the mark." } as const;

// `o` opens the command line on `open `, so the path is typed or picked there. The folder pattern takes any word, because a fuzzy word like `proj` reaches the handler when Enter has no row to take. Every command here changes only what the view shows, except `mark.set`, which writes a mark.
export const folders: CommandGroup = {
    commands: needing("list", {
        "folder.open": {
            name: "open",
            bridge: true,
            runs_in: "background",
            label: "Open a folder",
            intent: "Show a folder by its special use or its path. The message list takes the focus. The shown account comes first.",
            params: [
                {
                    name: "special",
                    type: "enum",
                    optional: true,
                    values: SPECIAL,
                    short: { inbox: "i", trash: "t", drafts: "d", sent: "s", archive: "a", junk: "j" },
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
            needs: ["app.paneFocus"],
            run: scoped<FolderFocusApi>(open_folder),
        },
        "folder.collapse": {
            bridge: true,
            runs_in: "background",
            label: "Collapse a folder, or focus the folder pane",
            intent: "Close a folder or its parent. From another pane, focus the folder pane.",
            needs: ["app.paneFocus"],
            run: scoped<CollapseApi>(collapse_folder),
        },
        "mark.set": { bridge: false, runs_in: "background", label: "Set a mark", intent: "Remember the shown folder under a one-key slot.", params: [SLOT_PARAM], run: scoped<FolderApi>(set_mark) },
        "mark.jump": { bridge: true, runs_in: "background", label: "Jump to a mark", intent: "Show the folder a slot remembers. The message list takes the focus.", needs: ["app.paneFocus"], params: [SLOT_PARAM], run: scoped<FolderFocusApi>(jump_to_mark) },
        "jump.back": { bridge: true, runs_in: "background", label: "Back in folder history", intent: "Show the folder shown before this one. The message list takes the focus. A count goes that many folders back.", count: "repeat", needs: ["app.paneFocus"], run: scoped<FolderFocusApi>(jump_back) },
        "jump.forward": { bridge: true, runs_in: "background", label: "Forward in folder history", intent: "Show the next folder in the history, after a jump back. The message list takes the focus.", count: "repeat", needs: ["app.paneFocus"], run: scoped<FolderFocusApi>(jump_forward) },
    }),
    normal_keys: {
        gi: { id: "folder.open", args: { special: "inbox" }, label: "Inbox" },
        gt: { id: "folder.open", args: { special: "trash" }, label: "Trash" },
        gd: { id: "folder.open", args: { special: "drafts" }, label: "Drafts" },
        gs: { id: "folder.open", args: { special: "sent" }, label: "Sent" },
        "<C-o>": { id: "jump.back" },
        "<C-i>": { id: "jump.forward" },
        M: { id: "mark.set", label: "Set mark" },
        "'": { id: "mark.jump", label: "Jump to mark" },
    },
};
