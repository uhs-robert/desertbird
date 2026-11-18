import { focus_pane, focus_pane_beside, open_conversation, open_page } from "../handlers/app.ts";
import { undo } from "../handlers/undo.ts";
import type { UndoApi } from "../handlers/undo.ts";
import type { AppApi } from "../handlers/app.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `msg.undo` reverses DesertBird's own changes from its undo log, never Thunderbird's: Thunderbird records no step for an API change, and mixing the two stacks would undo in the wrong order. It and the two commands that open a tab or a window change mail or open pages, so `bridge` is false. The pane commands only move the focus.
// Each names a pane, not a direction: `<A-h>` and `L` both reach the thread list from any pane. `pane.left` and `pane.right` are the relative pair, unbound by default.
const PANE_CHORDS = {
    "<A-h>": { id: "pane.focus", args: { pane: "threads" }, label: "Focus thread list" },
    L: { id: "pane.focus", args: { pane: "threads" }, label: "Focus thread list" },
    "<A-l>": { id: "pane.focus", args: { pane: "message" }, label: "Focus message pane" },
};

// Undo and the conversation view act on the displayed message as well as on the list, so the message tree binds them too.
const MESSAGE_ACTIONS = {
    u: { id: "msg.undo" },
    gC: { id: "thread.open_conversation", label: "Open conversation" },
};

export const app: CommandGroup = {
    commands: {
        "msg.undo": {
            bridge: false,
            repeatable: false,
            runs_in: "background",
            name: "undo",
            label: "Undo",
            intent: "Undo DesertBird's last delete, archive, move or mark. The marks are read, star and junk, and a tag toggle. Snooze, mark folder read and changes made in Thunderbird itself are not undone.",
            run: scoped<UndoApi>(undo),
        },
        "thread.open_conversation": {
            bridge: false,
            runs_in: "background",
            label: "Open the conversation",
            intent: "Open the conversation view of the selected message.",
            needs: ["keys.appCommand"],
            run: scoped<AppApi>(open_conversation),
        },
        "app.open_page": {
            bridge: false,
            runs_in: "background",
            label: "Open a Thunderbird page",
            intent: "Open the add-ons, themes or config page in a tab.",
            needs: ["keys.appOpenPage"],
            params: [{ name: "page", type: "enum", values: ["addons", "themes", "config"], description: { addons: "Open the add-ons manager.", themes: "Open the themes page.", config: "Open the configuration editor." } }],
            run: scoped<AppApi>(open_page),
        },
        "pane.focus": {
            bridge: true,
            runs_in: "background",
            label: "Focus a pane",
            intent: "Move the focus to a pane. A hidden pane, or a message pane that shows no single message, is refused.",
            needs: ["keys.paneFocus"],
            params: [{ name: "pane", type: "enum", values: ["folders", "threads", "message"], description: { folders: "Focus the folder pane.", threads: "Focus the thread list.", message: "Focus the message pane." } }],
            run: scoped<AppApi>(focus_pane),
        },
        "pane.left": {
            bridge: true,
            runs_in: "background",
            label: "Focus the pane to the left",
            intent: "Move the focus to the pane left of the focused one. From the message pane it goes to the thread list, from the thread list to the folder pane. It stops at the folder pane, and a hidden folder pane counts as the end.",
            needs: ["keys.paneFocus"],
            run: scoped<AppApi>(focus_pane_beside("left")),
        },
        "pane.right": {
            bridge: true,
            runs_in: "background",
            label: "Focus the pane to the right",
            intent: "Move the focus to the pane right of the focused one. From the folder pane it goes to the thread list, from the thread list to the message pane. It stops at the message pane, and a hidden message pane or one with no message counts as the end.",
            needs: ["keys.paneFocus"],
            run: scoped<AppApi>(focus_pane_beside("right")),
        },
    },
    normal_keys: {
        ...MESSAGE_ACTIONS,
        gpa: { id: "app.open_page", args: { page: "addons" }, label: "Add-ons" },
        gpt: { id: "app.open_page", args: { page: "themes" }, label: "Themes" },
        gpc: { id: "app.open_page", args: { page: "config" }, label: "Config" },
        gf: { id: "pane.focus", args: { pane: "folders" }, label: "Folder pane" },
        ge: { id: "pane.focus", args: { pane: "threads" }, label: "Thread list" },
        gm: { id: "pane.focus", args: { pane: "message" }, label: "Message pane" },
        ...PANE_CHORDS,
    },
    // The body script takes every key while the message pane has the focus, so the way out of it is bound there too.
    message_keys: {
        ...MESSAGE_ACTIONS,
        H: { id: "pane.focus", args: { pane: "folders" }, label: "Focus folder pane" },
        gf: { id: "pane.focus", args: { pane: "folders" }, label: "Folder pane" },
        ge: { id: "pane.focus", args: { pane: "threads" }, label: "Thread list" },
        ...PANE_CHORDS,
    },
};
