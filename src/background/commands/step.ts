import { step_message } from "../handlers/app.ts";
import type { AppHandlerApi } from "../handlers/app.ts";
import type { MainWindowApi } from "../handlers/tabs.ts";
import { step_attachment, step_starred, step_unread } from "../handlers/step.ts";
import type { StepApi } from "../handlers/step.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// Each only moves the selection, so `bridge` is true. They find a row through `folderpane.viewFindRow`, which walks the list in the order shown, and read it through `app.viewRows`.
const direction = { name: "direction", type: "enum", values: ["next", "previous"], short: { next: "n", previous: "p" }, description: { next: "Go to the next one.", previous: "Go to the previous one." } } as const;

export const step: CommandGroup = {
    commands: {
        ...needing("message", {
            "step.message": {
                bridge: false,
                runs_in: "background",
                label: "Step to the next or previous message",
                intent: "Show the next or previous message of the window's list.",
                count: "ignore",
                needs: ["app.appCommand"],
                params: [direction, { name: "unread", type: "bool", short: "u", description: "Skip to a message that is unread." }],
                run: scoped<AppHandlerApi & MainWindowApi>(step_message),
            },
        }),
        ...needing("list", {
            "step.unread": {
                bridge: true,
                runs_in: "background",
                label: "Step to an unread message",
                intent: "Select the next or previous unread message. In all_folders scope, with none left in this folder, open the next folder that has unread mail, with the message list focused.",
                count: "repeat",
                needs: ["app.viewRows", "app.paneFocus", "folderpane.viewFindRow", "folderpane.viewRowCount"],
                params: [direction, { name: "scope", type: "enum", values: ["folder", "all_folders"], default: "folder", short: { all_folders: "U" }, description: { all_folders: "Go on to another folder when this one has no more." } }],
                run: scoped<StepApi>(step_unread),
            },
            "step.starred": { bridge: true, runs_in: "background", label: "Step to a starred message", intent: "Select the next or previous starred message.", count: "repeat", needs: ["app.viewRows", "folderpane.viewFindRow", "folderpane.viewRowCount"], params: [direction], run: scoped<StepApi>(step_starred) },
            "step.attachment": { bridge: true, runs_in: "background", label: "Step to a message with an attachment", intent: "Select the next or previous message that has an attachment.", count: "repeat", needs: ["app.viewRows", "folderpane.viewFindRow", "folderpane.viewRowCount"], params: [direction], run: scoped<StepApi>(step_attachment) },
        }),
    },
    window_keys: {
        J: { id: "step.message", args: { direction: "next", unread: false }, label: "Next message" },
        K: { id: "step.message", args: { direction: "previous", unread: false }, label: "Previous message" },
        "]u": { id: "step.message", args: { direction: "next", unread: true }, label: "Unread" },
        "[u": { id: "step.message", args: { direction: "previous", unread: true }, label: "Unread" },
    },
    normal_keys: {
        "]u": { id: "step.unread", args: { direction: "next", scope: "folder" }, label: "Unread" },
        "[u": { id: "step.unread", args: { direction: "previous", scope: "folder" }, label: "Unread" },
        "]U": { id: "step.unread", args: { direction: "next", scope: "all_folders" }, label: "Unread in all folders" },
        "[U": { id: "step.unread", args: { direction: "previous", scope: "all_folders" }, label: "Unread in all folders" },
        "]s": { id: "step.starred", args: { direction: "next" }, label: "Starred" },
        "[s": { id: "step.starred", args: { direction: "previous" }, label: "Starred" },
        "]a": { id: "step.attachment", args: { direction: "next" }, label: "Attachment" },
        "[a": { id: "step.attachment", args: { direction: "previous" }, label: "Attachment" },
    },
};
