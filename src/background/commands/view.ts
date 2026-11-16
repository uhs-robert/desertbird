import { search_threads, set_filter, set_sort, toggle_pane } from "../handlers/view.ts";
import type { ViewApi } from "../handlers/view.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

const UNTAGGED_STATES = ["unread", "all", "starred", "attachment"];

// All four change only what the list shows, never mail, so `bridge` is true.
export const view: CommandGroup = {
    commands: {
        "filter.set": {
            bridge: true,
            runs_in: "background",
            label: "Filter the list",
            intent: "Show only the messages in one state, or all of them.",
            params: [
                {
                    name: "state",
                    type: "enum",
                    values: ["unread", "all", "starred", "tag", "attachment"],
                    description: { unread: "Show the unread messages.", all: "Clear the filter and show every message.", starred: "Show the starred messages.", tag: "Show the messages with one tag.", attachment: "Show the messages with an attachment." },
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
            label: "Search the list",
            intent: "Show only the messages that match the text.",
            params: [{ name: "query", type: "string", description: "Match this text in the subject and the sender.", main: true, rest: true, pattern: "\\S" }],
            run: scoped<ViewApi>(search_threads),
        },
        "sort.set": {
            bridge: true,
            runs_in: "background",
            label: "Sort the list",
            intent: "Sort the message list by a column.",
            params: [
                {
                    name: "by",
                    type: "enum",
                    values: ["date", "subject", "author", "recipient", "size", "flagged", "unread", "attachments", "tags"],
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
                    },
                },
                { name: "order", type: "enum", values: ["ascending", "descending"], description: { ascending: "Put the smallest or oldest first.", descending: "Put the largest or newest first." } },
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
        Fs: { id: "filter.set", args: { state: "starred" } },
        Ff: { id: "filter.set", args: { state: "attachment" } },
        tm: { id: "pane.toggle", args: { pane: "message" } },
        tf: { id: "pane.toggle", args: { pane: "folder" } },
    },
};
