import { fold_all, half_page, move_left, move_right, reposition, step_thread_root } from "../handlers/thread_view.ts";
import type { ThreadViewApi } from "../handlers/thread_view.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// All five move the selection or the fold state of the list and never touch mail, so `bridge` is true. Each reads the rows through the chrome verbs in `needs`.
export const thread: CommandGroup = {
    commands: {
        "motion.left": { bridge: true, runs_in: "background", label: "Close thread or go to its root", intent: "Close the open thread, or go from a reply to its root.", needs: ["keys.viewRows", "keys.viewThread"], run: scoped<ThreadViewApi>(move_left) },
        "motion.right": { bridge: true, runs_in: "background", label: "Open thread or go to its first reply", intent: "Open the closed thread, or go to its first reply.", needs: ["keys.viewRows", "keys.viewThread"], run: scoped<ThreadViewApi>(move_right) },
        "step.thread_root": {
            bridge: true,
            runs_in: "background",
            label: "Step to a thread root",
            intent: "Select the root of the next or previous thread.",
            count: "repeat",
            needs: ["keys.viewRows"],
            params: [{ name: "direction", type: "enum", values: ["next", "previous"], description: { next: "Go to the root of the next thread.", previous: "Go to the root of this thread or the one before." } }],
            run: scoped<ThreadViewApi>(step_thread_root),
        },
        "view.reposition": {
            bridge: true,
            runs_in: "background",
            label: "Scroll the current row to a place",
            intent: "Scroll the list so the current row sits at a chosen place.",
            needs: ["keys.viewRows", "keys.viewScroll"],
            params: [{ name: "position", type: "enum", values: ["center", "top", "bottom"], description: { center: "Put the row in the middle.", top: "Put the row at the top.", bottom: "Put the row at the bottom." } }],
            run: scoped<ThreadViewApi>(reposition),
        },
        "view.half_page": {
            bridge: true,
            runs_in: "background",
            label: "Move half a page",
            intent: "Select the row half a page down or up in the thread list.",
            needs: ["keys.viewRows"],
            params: [{ name: "direction", type: "enum", values: ["next", "previous"], description: { next: "Go half a page down.", previous: "Go half a page up." } }],
            run: scoped<ThreadViewApi>(half_page),
        },
        "thread.fold_all": {
            bridge: true,
            runs_in: "background",
            label: "Open or close every thread or folder",
            intent: "Open every thread in the list, or close them all. In the folder pane it opens or closes every folder.",
            needs: ["keys.viewAllThreads"],
            params: [{ name: "open", type: "bool", description: "Open every thread instead of closing every one." }],
            run: scoped<ThreadViewApi>(fold_all),
        },
    },
    normal_keys: {
        h: { id: "motion.left" },
        l: { id: "motion.right" },
        "]t": { id: "step.thread_root", args: { direction: "next" } },
        "[t": { id: "step.thread_root", args: { direction: "previous" } },
        "<C-d>": { id: "view.half_page", args: { direction: "next" } },
        "<C-u>": { id: "view.half_page", args: { direction: "previous" } },
        zz: { id: "view.reposition", args: { position: "center" } },
        zt: { id: "view.reposition", args: { position: "top" } },
        zb: { id: "view.reposition", args: { position: "bottom" } },
        zM: { id: "thread.fold_all", args: { open: false } },
        zR: { id: "thread.fold_all", args: { open: true } },
    },
};
