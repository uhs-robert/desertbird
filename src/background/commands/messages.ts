import { archive, delete_messages } from "../handlers/message.ts";
import { add_tag, move_messages, read_all, set_read, toggle_flag, toggle_junk } from "../handlers/message_state.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `msg.tag` and `msg.move` take a typed value, so they have no default key until the command line exists. Their `values.from` feeds that line's completion only. The tag pattern rejects text with spaces at either end, the folder pattern rejects anything but a path.
export const messages: CommandGroup = {
    commands: {
        "msg.archive": { bridge: false, runs_in: "background", label: "Archive", intent: "Archive the selected messages.", run: scoped(archive) },
        "msg.delete": { bridge: false, runs_in: "background", label: "Delete", intent: "Move the selected messages to Trash.", run: scoped(delete_messages) },
        "msg.read": {
            bridge: false,
            runs_in: "background",
            label: "Read state",
            intent: "Mark the selected messages read or unread. With no flag, the first message decides.",
            params: [{ name: "state", type: "enum", values: ["read", "unread", "toggle"], default: "toggle", short: { read: "r", unread: "u" }, description: { read: "Mark the messages read.", unread: "Mark the messages unread." } }],
            run: scoped(set_read),
        },
        "folder.read_all": {
            bridge: false,
            runs_in: "background",
            label: "Mark folder read",
            intent: "Mark every message in the shown folder read.",
            run: scoped(read_all),
        },
        "msg.flag": { bridge: false, runs_in: "background", label: "Flag", intent: "Star the selected messages, or clear the star. The first message decides which.", run: scoped(toggle_flag) },
        "msg.junk": { bridge: false, runs_in: "background", label: "Junk", intent: "Mark the selected messages as junk without moving them. The first message decides between junk and not junk.", run: scoped(toggle_junk) },
        "msg.tag": {
            bridge: false,
            runs_in: "background",
            name: "tag",
            label: "Tag",
            intent: "Add a tag to the selected messages.",
            params: [{ name: "tag", type: "string", main: true, values: { from: "tags" }, pattern: "^\\S(.*\\S)?$" }],
            run: scoped(add_tag),
        },
        "msg.move": {
            bridge: false,
            runs_in: "background",
            name: "move",
            label: "Move",
            intent: "Move the selected messages to a folder by its path.",
            params: [{ name: "folder", type: "string", main: true, values: { from: "folders" }, pattern: "^/.+" }],
            run: scoped(move_messages),
        },
    },
    normal_keys: {
        x: { id: "msg.archive" },
        dd: { id: "msg.delete" },
        mr: { id: "msg.read", args: { state: "read" } },
        mu: { id: "msg.read", args: { state: "unread" } },
        mR: { id: "folder.read_all" },
        ms: { id: "msg.flag" },
        mj: { id: "msg.junk" },
    },
};
