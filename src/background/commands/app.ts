import { focus_pane, open_conversation, open_page, undo } from "../handlers/app.ts";
import type { AppApi } from "../handlers/app.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `msg.undo` runs Thunderbird's own undo, which restores or deletes mail again, so `bridge` is false and `.` never repeats it. The other three change only what the window shows or opens.
export const app: CommandGroup = {
    commands: {
        "msg.undo": {
            bridge: false,
            repeatable: false,
            runs_in: "background",
            label: "Undo",
            intent: "Undo the last move or delete that Thunderbird can undo.",
            needs: ["keys.appCommand"],
            run: scoped<AppApi>(undo),
        },
        "thread.open_conversation": {
            bridge: true,
            runs_in: "background",
            label: "Open the conversation",
            intent: "Open the conversation view of the selected message.",
            needs: ["keys.appCommand"],
            run: scoped<AppApi>(open_conversation),
        },
        "app.open_page": {
            bridge: true,
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
            intent: "Move the focus to a pane.",
            needs: ["keys.paneFocus"],
            params: [{ name: "pane", type: "enum", values: ["folders", "threads", "message"], description: { folders: "Focus the folder pane.", threads: "Focus the thread list.", message: "Focus the message pane." } }],
            run: scoped<AppApi>(focus_pane),
        },
    },
    normal_keys: {
        u: { id: "msg.undo" },
        gC: { id: "thread.open_conversation" },
        gx: { id: "app.open_page", args: { page: "addons" } },
        gT: { id: "app.open_page", args: { page: "themes" } },
        gc: { id: "app.open_page", args: { page: "config" } },
        gf: { id: "pane.focus", args: { pane: "folders" } },
        ge: { id: "pane.focus", args: { pane: "threads" } },
        gm: { id: "pane.focus", args: { pane: "message" } },
    },
    // The body script takes every key while the message pane has the focus, so the way out of it is bound there too.
    message_keys: {
        gf: { id: "pane.focus", args: { pane: "folders" } },
        ge: { id: "pane.focus", args: { pane: "threads" } },
    },
};
