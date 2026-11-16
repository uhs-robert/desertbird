// The command table of the background and the chrome runtime. Keys, help and the router read these definitions and define no behavior.

import { create_registry } from "../../vendor/desertfox/registry/define.ts";
import type { CommandInput } from "../../vendor/desertfox/registry/define.ts";
import type { CheckedArgs, CommandContext, CommandRun } from "../../vendor/desertfox/command.ts";
import { archive, delete_messages, reply } from "./handlers/message.ts";
import type { HandlerScope } from "./handlers/message.ts";

export const registry = create_registry();

// Every command states `bridge` on purpose, because the bridge runs nothing by default and a forgotten field should not pass silently.
const define = (id: string, input: CommandInput & { bridge: boolean }) => registry.define(id, input);

/** The router calls `run` with the usual context plus the scope. The vendored `CommandRun` type has no room for it. */
export type ScopedContext = CommandContext & HandlerScope;

const scoped = (handler: (scope: HandlerScope, args: CheckedArgs) => Promise<void>): CommandRun => (ctx, args) => handler(ctx as ScopedContext, args);

// Motions run in the chrome runtime from its fixed motion table, so they carry no handler here.
define("motion.down", { runs_in: "chrome", bridge: true, label: "Move down", intent: "Select the next row in the message list.", count: "repeat" });
define("motion.up", { runs_in: "chrome", bridge: true, label: "Move up", intent: "Select the previous row in the message list.", count: "repeat" });
define("motion.top", { runs_in: "chrome", bridge: true, label: "Go to first row", intent: "Select the first row in the message list." });
define("motion.bottom", { runs_in: "chrome", bridge: true, label: "Go to last row", intent: "Select the last row in the message list." });

define("msg.archive", {
    bridge: false,
    runs_in: "background",
    label: "Archive",
    intent: "Archive the selected messages.",
    run: scoped(archive),
});

define("msg.delete", {
    bridge: false,
    runs_in: "background",
    label: "Delete",
    intent: "Move the selected messages to Trash.",
    run: scoped(delete_messages),
});

define("msg.reply", {
    bridge: false,
    runs_in: "background",
    label: "Reply",
    intent: "Reply to the sender of the selected message.",
    params: [{ name: "to", type: "enum", values: ["sender"], default: "sender" }],
    run: scoped(reply),
});
