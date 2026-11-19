import { archive, delete_messages } from "../handlers/message.ts";
import type { TrashApi } from "../handlers/message.ts";
import { copy_messages, move_messages, read_all, set_read, toggle_flag, toggle_junk, toggle_tag } from "../handlers/message_state.ts";
import { ACCOUNT_PARAM } from "./account_param.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `msg.tag`, `msg.move` and `msg.copy` take a typed value, so they open on the command line (`mt`, `mm`, `mc`). Their `values.from` feeds that line's completion only. The tag pattern rejects text with spaces at either end, the folder pattern takes any non-empty word, so a fuzzy word reaches the handler.
const FOLDER_PARAM = { name: "folder", type: "string", main: true, values: { from: "folders" }, pattern: "^\\S.*" } as const;

export const messages: CommandGroup = {
    commands: needing("message", {
        "msg.archive": { bridge: false, runs_in: "background", label: "Archive", intent: "Archive the selected messages. A count archives that many rows from the current one.", count: "repeat", run: scoped<TrashApi>(archive) },
        "msg.delete": { bridge: false, runs_in: "background", label: "Delete", intent: "Move the selected messages to Trash. A count deletes that many rows from the current one.", count: "repeat", run: scoped<TrashApi>(delete_messages) },
        "msg.read": {
            bridge: false,
            keeps_selection: true,
            runs_in: "background",
            label: "Read state",
            intent: "Mark the selected messages read or unread. With no flag, the first message decides. A count marks that many rows from the current one.",
            count: "repeat",
            params: [{ name: "state", type: "enum", values: ["read", "unread", "toggle"], default: "toggle", short: { read: "r", unread: "u" }, description: { read: "Mark the messages read.", unread: "Mark the messages unread." } }],
            run: scoped<TrashApi>(set_read),
        },
        "folder.read_all": {
            bridge: false,
            runs_in: "background",
            needs: ["list"],
            label: "Mark folder read",
            intent: "Mark every message in the shown folder read.",
            run: scoped(read_all),
        },
        "msg.flag": { bridge: false, keeps_selection: true, runs_in: "background", label: "Flag", intent: "Star the selected messages, or clear the star. The first message decides which.", run: scoped(toggle_flag) },
        "msg.junk": { bridge: false, keeps_selection: true, runs_in: "background", label: "Junk", intent: "Mark the selected messages as junk without moving them. The first message decides between junk and not junk.", run: scoped(toggle_junk) },
        "msg.tag": {
            bridge: false,
            keeps_selection: true,
            runs_in: "background",
            name: "tag",
            label: "Toggle tag",
            intent: "Toggle a tag on the selection. The first message decides: if it has the tag, the tag comes off every message, else it goes on every message.",
            params: [{ name: "tag", type: "string", main: true, values: { from: "tags" }, pattern: "^\\S(.*\\S)?$" }],
            run: scoped(toggle_tag),
        },
        "msg.move": {
            bridge: false,
            repeatable: false,
            runs_in: "background",
            name: "move",
            label: "Move",
            intent: "Move the selected messages to a folder by its path.",
            params: [FOLDER_PARAM, ACCOUNT_PARAM],
            run: scoped(move_messages),
        },
        "msg.copy": {
            bridge: false,
            keeps_selection: true,
            repeatable: false,
            runs_in: "background",
            name: "copy",
            label: "Copy",
            intent: "Copy the selected messages to a folder by its path. The originals stay where they are.",
            params: [FOLDER_PARAM, ACCOUNT_PARAM],
            run: scoped(copy_messages),
        },
    }),
    normal_keys: {
        a: { id: "msg.archive" },
        dd: { id: "msg.delete", label: "Delete" },
        mr: { id: "msg.read", args: { state: "read" }, label: "Mark read" },
        mu: { id: "msg.read", args: { state: "unread" }, label: "Mark unread" },
        mR: { id: "folder.read_all", label: "Mark folder read" },
        ms: { id: "msg.flag", label: "Toggle star" },
        mj: { id: "msg.junk", label: "Mark junk" },
    },
};
