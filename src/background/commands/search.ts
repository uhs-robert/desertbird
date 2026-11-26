import { open_search, search_next, search_prev } from "../handlers/search.ts";
import type { SearchOpenApi } from "../handlers/search.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `/` and `?` open the command line as a search line. In the thread list a search is the Quick Filter, so the keys change only what the list shows and `bridge` is true. The commands that search a message (`search.message`) and filter by text on the command line (`search.threads`) stay in their own groups.
export const search: CommandGroup = {
    commands: needing("list", {
        "search.open": {
            bridge: true,
            // A `.` that reopened the line would only startle. The line has its own history.
            repeatable: false,
            runs_in: "background",
            label: "Search the list",
            intent: "Narrow the list as you type, then select a match.",
            // The key opens the line, so the list of typed commands has no use for it.
            completion: "hidden",
            needs: ["overlay.mount", "app.viewRows", "folderpane.viewRowCount"],
            params: [{ name: "direction", type: "enum", values: ["forward", "backward"], short: { forward: "f", backward: "b" }, description: { forward: "Select the first match on Enter.", backward: "Select the last match on Enter, and make n go up." } }],
            run: scoped<SearchOpenApi>(open_search),
        },
        "search.next": {
            bridge: true,
            runs_in: "background",
            label: "Next search match",
            intent: "Select the next match of the last search.",
            count: "ignore",
            needs: ["app.viewRows", "folderpane.viewRowCount"],
            run: scoped<{ search: SearchOpenApi["search"] }>(search_next),
        },
        "search.prev": {
            bridge: true,
            runs_in: "background",
            label: "Previous search match",
            intent: "Select the previous match of the last search.",
            count: "ignore",
            needs: ["app.viewRows", "folderpane.viewRowCount"],
            run: scoped<{ search: SearchOpenApi["search"] }>(search_prev),
        },
    }),
    normal_keys: {
        "/": { id: "search.open", args: { direction: "forward" }, label: "Search list" },
        "?": { id: "search.open", args: { direction: "backward" }, label: "Search list backward" },
        n: { id: "search.next" },
        N: { id: "search.prev" },
    },
};
