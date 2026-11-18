import type { CommandInput } from "../../../vendor/desertfox/registry/define.ts";
import type { CheckedArgs, CommandContext, CommandRun } from "../../../vendor/desertfox/command.ts";
import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { HandlerScope, MessageApi } from "../handlers/message.ts";

// Every command states `bridge` on purpose, because the bridge runs nothing by default and a forgotten field should not pass silently.
// `repeatable: false` keeps `.` from replaying the command. A command that moves mail where `u` cannot follow (`msg.move`, which takes a typed folder, and `msg.snooze`) sets it, so a stray `.` never repeats it on the next selection. `u` undoes `msg.delete` and `msg.archive`, so `.` repeats them.
// `keeps_selection: true` marks a command that leaves its rows in the list (read state, star, junk, tag, copy). Visual mode then stays on after it, so the range can take a second command. Commands that remove or move rows end the mode, because their rows are gone.
export type CommandDefinition = CommandInput & { bridge: boolean; repeatable?: false; keeps_selection?: true };

/** One group file: its commands by id, and the default normal-mode keys that run them. `message_keys` bind in the message document and not in the mail tab. */
export interface CommandGroup {
    commands: Record<string, CommandDefinition>;
    normal_keys: NonNullable<KeymapConfig["normal"]>;
    message_keys?: NonNullable<KeymapConfig["normal"]>;
}

/** The router calls `run` with the usual context plus the scope. The vendored `CommandRun` type has no room for it. */
export type ScopedContext = CommandContext & HandlerScope;

/** A handler names the API subset it needs as `Api`. The router passes the whole API, which holds every subset. */
export const scoped = <Api = MessageApi>(handler: (scope: HandlerScope<Api>, args: CheckedArgs) => Promise<void>): CommandRun => (ctx, args) => handler(ctx as unknown as HandlerScope<Api>, args);
