import { search_threads, set_filter, set_sort, toggle_pane } from "../handlers/view.ts";
import type { ViewApi } from "../handlers/view.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

const UNTAGGED_STATES = ["unread", "all", "starred", "toggle_starred", "attachment"];

// A sort key names its order because the column alone leaves it open: dates read newest first and every other column reads smallest first.
const sort_key = (by: string, order: string) => ({ id: "sort.set", args: { by, order } });

// All four change only what the list shows, never mail, so `bridge` is true.
export const view: CommandGroup = {
    commands: {
        "filter.set": {
            bridge: true,
            runs_in: "background",
            name: "filter",
            label: "Filter the list",
            intent: "Show only the messages in one state, or all of them.",
            params: [
                {
                    name: "state",
                    type: "enum",
                    values: ["unread", "all", "starred", "toggle_starred", "tag", "attachment"],
                    description: { unread: "Show the unread messages.", all: "Clear the filter and show every message.", starred: "Show the starred messages.", toggle_starred: "Toggle the starred filter.", tag: "Show the messages with one tag.", attachment: "Show the messages with an attachment." },
                },
                // A tag needs its key and the other states take none. The default list is what makes the tag required, because a param with `when` cannot be.
                {
                    name: "tag",
                    type: "string",
                    description: "Name the tag key for the tag state, for example $label1.",
                    default: [{ value: "", when: { state: UNTAGGED_STATES } }],
                    pattern_arms: [
                        { pattern: "\\S", when: { state: ["tag"] } },
                        { pattern: "^$", when: { state: UNTAGGED_STATES } },
                    ],
                },
            ],
            run: scoped<ViewApi>(set_filter),
        },
        "search.threads": {
            bridge: true,
            runs_in: "background",
            name: "search",
            label: "Search the list",
            intent: "Show only the messages that match the text.",
            params: [{ name: "query", type: "string", description: "Match this text in the subject and the sender.", main: true, rest: true, pattern: "\\S" }],
            run: scoped<ViewApi>(search_threads),
        },
        "sort.set": {
            bridge: true,
            runs_in: "background",
            name: "sort",
            label: "Sort the list",
            intent: "Sort the message list by a column.",
            params: [
                {
                    name: "by",
                    type: "enum",
                    values: ["date", "subject", "author", "recipient", "size", "flagged", "unread", "attachments", "tags", "received", "priority", "current"],
                    description: {
                        date: "Sort by the date sent.",
                        subject: "Sort by the subject.",
                        author: "Sort by the sender.",
                        recipient: "Sort by the recipient.",
                        size: "Sort by the message size.",
                        flagged: "Sort by the star.",
                        unread: "Sort by the read state.",
                        attachments: "Sort by the attachment.",
                        tags: "Sort by the tag.",
                        received: "Sort by the date received.",
                        priority: "Sort by the priority.",
                        current: "Keep the column the list is sorted by now.",
                    },
                },
                {
                    name: "order",
                    type: "enum",
                    values: ["ascending", "descending", "toggle"],
                    description: { ascending: "Put the smallest or oldest first.", descending: "Put the largest or newest first.", toggle: "Reverse the order the list has now." },
                },
            ],
            run: scoped<ViewApi>(set_sort),
        },
        "pane.toggle": {
            bridge: true,
            runs_in: "background",
            label: "Toggle a pane",
            intent: "Show or hide the message pane or the folder pane.",
            params: [{ name: "pane", type: "enum", values: ["message", "folder"], description: { message: "Toggle the message pane.", folder: "Toggle the folder pane." } }],
            run: scoped<ViewApi>(toggle_pane),
        },
    },
    normal_keys: {
        Fu: { id: "filter.set", args: { state: "unread" } },
        Fa: { id: "filter.set", args: { state: "all" } },
        Fs: { id: "filter.set", args: { state: "toggle_starred" } },
        FA: { id: "filter.set", args: { state: "attachment" } },
        ",d": sort_key("date", "descending"),
        ",s": sort_key("subject", "ascending"),
        ",f": sort_key("author", "ascending"),
        ",z": sort_key("size", "ascending"),
        ",t": sort_key("tags", "ascending"),
        ",a": sort_key("attachments", "ascending"),
        ",u": sort_key("unread", "ascending"),
        ",r": sort_key("received", "descending"),
        ",p": sort_key("priority", "descending"),
        ",o": sort_key("current", "toggle"),
        tm: { id: "pane.toggle", args: { pane: "message" } },
        tf: { id: "pane.toggle", args: { pane: "folder" } },
    },
};
