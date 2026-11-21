import { focus_pane, focus_pane_beside, open_conversation, open_page, resize_pane } from "../handlers/app.ts";
import { undo } from "../handlers/undo.ts";
import type { UndoApi } from "../handlers/undo.ts";
import type { AppHandlerApi } from "../handlers/app.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `msg.undo` reverses DesertBird's own changes from its undo log, never Thunderbird's: Thunderbird records no step for an API change, and mixing the two stacks would undo in the wrong order. It and the two commands that open a tab or a window change mail or open pages, so `bridge` is false. The pane commands only move the focus.
// The relative pair `pane.left` and `pane.right` sit on `H` and `L`, `<A-h>` and `<A-l>`, and on `w h` and `w l` under the `w` prefix of the pane toggles. Each stops at the edge and never wraps. The fixed jumps stay on `g f`, `g e` and `g m`.
const PANE_CHORDS = {
    H: { id: "pane.left", label: "Pane left" },
    "<A-h>": { id: "pane.left", label: "Pane left" },
    L: { id: "pane.right", label: "Pane right" },
    "<A-l>": { id: "pane.right", label: "Pane right" },
};

// Undo and the conversation view act on the displayed message as well as on the list, so the message tree binds them too.
const MESSAGE_ACTIONS = {
    u: { id: "msg.undo" },
    gC: { id: "thread.open_conversation", label: "Open conversation" },
};

export const app: CommandGroup = {
    commands: needing("message", {
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
            needs: ["app.appCommand"],
            run: scoped<AppHandlerApi>(open_conversation),
        },
        "app.open_page": {
            bridge: false,
            runs_in: "background",
            label: "Open a Thunderbird page",
            intent: "Open the add-ons, themes or config page in a tab.",
            needs: ["tab", "app.appOpenPage"],
            params: [{ name: "page", type: "enum", values: ["addons", "themes", "config"], short: { addons: "a", themes: "t", config: "c" }, description: { addons: "Open the add-ons manager.", themes: "Open the themes page.", config: "Open the configuration editor." } }],
            run: scoped<AppHandlerApi>(open_page),
        },
        "pane.focus": {
            bridge: true,
            runs_in: "background",
            label: "Focus a pane",
            intent: "Move the focus to a pane. A hidden pane, or a message pane that shows no single message, is refused.",
            needs: ["app.paneFocus"],
            params: [{ name: "pane", type: "enum", values: ["folders", "threads", "message"], short: { folders: "f", threads: "e", message: "m" }, description: { folders: "Focus the folder pane.", threads: "Focus the thread list.", message: "Focus the message pane." } }],
            run: scoped<AppHandlerApi>(focus_pane),
        },
        "pane.left": {
            bridge: true,
            runs_in: "background",
            label: "Focus the pane to the left",
            intent: "Move the focus to the pane left of the focused one. From the message pane it goes to the thread list, from the thread list to the folder pane. It stops at the folder pane, and a hidden folder pane counts as the end.",
            needs: ["app.paneFocus"],
            run: scoped<AppHandlerApi>(focus_pane_beside("left")),
        },
        "pane.right": {
            bridge: true,
            runs_in: "background",
            label: "Focus the pane to the right",
            intent: "Move the focus to the pane right of the focused one. From the folder pane it goes to the thread list, from the thread list to the message pane. It stops at the message pane, and a hidden message pane or one with no message counts as the end.",
            needs: ["app.paneFocus"],
            run: scoped<AppHandlerApi>(focus_pane_beside("right")),
        },
        "pane.resize": {
            bridge: false,
            runs_in: "background",
            label: "Resize the focused pane",
            intent: "Move the border of the focused pane by 24 CSS pixels. A count multiplies the step. A pane that sits between two borders moves the one after it. The size is stored as a drag stores it, so it stays after a restart. `reset` puts both splitters back to their default sizes. It refuses a pane that is hidden, or a layout with no border on that axis, and it never collapses a pane. The resize mode of `w r` types these as `h`, `l`, `j`, `k` and `=`.",
            count: "repeat",
            needs: ["app.paneResize"],
            params: [{ name: "direction", type: "enum", values: ["left", "right", "up", "down", "reset"], description: { left: "Move the border to the left.", right: "Move the border to the right.", up: "Move the border up.", down: "Move the border down.", reset: "Put both splitters back to their default sizes." } }],
            run: scoped<AppHandlerApi>(resize_pane),
        },
    }),
    normal_keys: {
        ...MESSAGE_ACTIONS,
        gpa: { id: "app.open_page", args: { page: "addons" }, label: "Add-ons" },
        gpt: { id: "app.open_page", args: { page: "themes" }, label: "Themes" },
        gpc: { id: "app.open_page", args: { page: "config" }, label: "Config" },
        gf: { id: "pane.focus", args: { pane: "folders" }, label: "Folder pane" },
        ge: { id: "pane.focus", args: { pane: "threads" }, label: "Thread list" },
        gm: { id: "pane.focus", args: { pane: "message" }, label: "Message pane" },
        wh: { id: "pane.left", label: "Pane left" },
        wl: { id: "pane.right", label: "Pane right" },
        ...PANE_CHORDS,
    },
};
