// The command table of the background and the chrome runtime. Keys, help and the router read these definitions and define no behavior.

import { create_registry } from "../../vendor/desertfox/registry/define.ts";
import type { CheckedArgs, CommandContext, CommandRun } from "../../vendor/desertfox/command.ts";
import { archive, delete_messages, reply } from "./handlers/message.ts";
import type { HandlerScope } from "./handlers/message.ts";

export const registry = create_registry();

/** The router calls `run` with the usual context plus the scope. The vendored `CommandRun` type has no room for it. */
export type ScopedContext = CommandContext & HandlerScope;

const scoped = (handler: (scope: HandlerScope, args: CheckedArgs) => Promise<void>): CommandRun => (ctx, args) => handler(ctx as ScopedContext, args);

// Motions run in the chrome runtime from its fixed motion table, so they carry no handler here.
registry.define("motion.down", { runs_in: "chrome", label: "Move down", intent: "Select the next row in the message list.", count: "repeat" });
registry.define("motion.up", { runs_in: "chrome", label: "Move up", intent: "Select the previous row in the message list.", count: "repeat" });
registry.define("motion.top", { runs_in: "chrome", label: "Go to first row", intent: "Select the first row in the message list." });
registry.define("motion.bottom", { runs_in: "chrome", label: "Go to last row", intent: "Select the last row in the message list." });

registry.define("msg.archive", {
    runs_in: "background",
    label: "Archive",
    intent: "Archive the selected messages.",
    run: scoped(archive),
});

registry.define("msg.delete", {
    runs_in: "background",
    label: "Delete",
    intent: "Move the selected messages to Trash.",
    run: scoped(delete_messages),
});

registry.define("msg.reply", {
    runs_in: "background",
    label: "Reply",
    intent: "Reply to the sender of the selected message.",
    params: [{ name: "to", type: "enum", values: ["sender"], default: "sender" }],
    run: scoped(reply),
});
