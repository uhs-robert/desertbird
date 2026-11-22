import { step_attachment, step_starred, step_unread } from "../handlers/step.ts";
import type { StepApi } from "../handlers/step.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// Each only moves the selection, so `bridge` is true. They read the rows through `app.viewRows`, which gives the list in the order shown.
const direction = { name: "direction", type: "enum", values: ["next", "previous"], short: { next: "n", previous: "p" }, description: { next: "Go to the next one.", previous: "Go to the previous one." } } as const;

export const step: CommandGroup = {
    commands: needing("list", {
        "step.unread": {
            bridge: true,
            runs_in: "background",
            label: "Step to an unread message",
            intent: "Select the next or previous unread message. In all_folders scope, with none left in this folder, open the next folder that has unread mail, with the message list focused.",
            count: "repeat",
            needs: ["app.viewRows", "app.paneFocus"],
            params: [direction, { name: "scope", type: "enum", values: ["folder", "all_folders"], default: "folder", short: { all_folders: "U" }, description: { all_folders: "Go on to another folder when this one has no more." } }],
            run: scoped<StepApi>(step_unread),
        },
        "step.starred": { bridge: true, runs_in: "background", label: "Step to a starred message", intent: "Select the next or previous starred message.", count: "repeat", needs: ["app.viewRows"], params: [direction], run: scoped<StepApi>(step_starred) },
        "step.attachment": { bridge: true, runs_in: "background", label: "Step to a message with an attachment", intent: "Select the next or previous message that has an attachment.", count: "repeat", needs: ["app.viewRows"], params: [direction], run: scoped<StepApi>(step_attachment) },
    }),
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
