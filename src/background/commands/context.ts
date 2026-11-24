import { open_context_menu } from "../handlers/context.ts";
import type { ContextHandlerApi } from "../handlers/context.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// One command for every place a key works. The `context` Experiment reads the focus of the key's window and opens the menu Thunderbird shows for it. It has no command line name: a typed command leaves the focus on the line, so it would have no target.
export const context: CommandGroup = {
    commands: needing("main", {
        "context.menu": {
            bridge: false,
            runs_in: "background",
            label: "Context menu",
            intent: "Open the context menu of what has the focus.",
            needs: ["context.open"],
            run: scoped<ContextHandlerApi>(open_context_menu),
        },
    }),
    normal_keys: {
        ",m": { id: "context.menu", label: "Context menu" },
    },
};
