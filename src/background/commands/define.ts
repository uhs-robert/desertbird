import type { CommandInput } from "../../../vendor/desertfox/registry/define.ts";
import type { CheckedArgs, CommandContext, CommandRun } from "../../../vendor/desertfox/command.ts";
import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { HandlerScope } from "../handlers/message.ts";

// Every command states `bridge` on purpose, because the bridge runs nothing by default and a forgotten field should not pass silently.
export type CommandDefinition = CommandInput & { bridge: boolean };

/** One group file: its commands by id, and the default normal-mode keys that run them. */
export interface CommandGroup {
    commands: Record<string, CommandDefinition>;
    normal_keys: NonNullable<KeymapConfig["normal"]>;
}

/** The router calls `run` with the usual context plus the scope. The vendored `CommandRun` type has no room for it. */
export type ScopedContext = CommandContext & HandlerScope;

export const scoped = (handler: (scope: HandlerScope, args: CheckedArgs) => Promise<void>): CommandRun => (ctx, args) => handler(ctx as ScopedContext, args);
