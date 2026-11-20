import type { CommandInput } from "../../../vendor/desertfox/registry/define.ts";
import type { CheckedArgs, CommandContext, CommandRun } from "../../../vendor/desertfox/command.ts";
import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { HandlerScope, MessageApi } from "../handlers/message.ts";

// Every command states `bridge` on purpose, because the bridge runs nothing by default and a forgotten field should not pass silently.
// `repeatable: false` keeps `.` from replaying the command. A command that moves mail where `u` cannot follow (`msg.move`, which takes a typed folder, and `msg.snooze`) sets it, so a stray `.` never repeats it on the next selection. `u` undoes `msg.delete` and `msg.archive`, so `.` repeats them.
// `keeps_selection: true` marks a command that leaves its rows in the list (read state, star, junk, tag, copy). Visual mode then stays on after it, so the range can take a second command. Commands that remove or move rows end the mode, because their rows are gone.
export type CommandDefinition = CommandInput & { bridge: boolean; repeatable?: false; keeps_selection?: true };

/** What a tab must offer for a command to run in it, written in `needs` next to the Experiment verbs and permissions. `list` is the thread list. `message` is a shown message. `body` is the body script of a message document or an own page, which find and hints need. `tab` means any tab. `page` is a tab whose page the chrome keys itself, with no body script: calendar, settings, the address book, `about:` pages. A tab that cannot meet every one of them gets no key for the command, so the key reaches Thunderbird. */
export const TAB_NEEDS = ["list", "message", "tab", "body", "page"] as const;
export type TabNeed = (typeof TAB_NEEDS)[number];

const is_tab_need = (need: string): need is TabNeed => (TAB_NEEDS as readonly string[]).includes(need);

/** The tab needs of a command. A command that names none needs the thread list, so a new command stays in the mail tab until it says more. */
export function tab_needs_of(command: { needs?: readonly string[] | undefined }): TabNeed[] {
    const named = (command.needs ?? []).filter(is_tab_need);
    return named.length > 0 ? named : ["list"];
}

/** Gives every command of a group the same tab need, unless it names one of its own. */
export const needing = (need: TabNeed, commands: Record<string, CommandDefinition>): Record<string, CommandDefinition> =>
    Object.fromEntries(Object.entries(commands).map(([id, command]) => [id, command.needs?.some(is_tab_need) ? command : { ...command, needs: [need, ...(command.needs ?? [])] }]));

/** One group file: its commands by id, and the default normal-mode keys that run them. `message_keys` bind in a document with a body script and replace the key of the same name there. `page_keys` are the reading keys of a tab with no body script, and any tab with a list or a body script keeps its own key for them. */
export interface CommandGroup {
    commands: Record<string, CommandDefinition>;
    normal_keys: NonNullable<KeymapConfig["normal"]>;
    message_keys?: NonNullable<KeymapConfig["normal"]>;
    page_keys?: NonNullable<KeymapConfig["normal"]>;
}

/** The router calls `run` with the usual context plus the scope. The vendored `CommandRun` type has no room for it. */
export type ScopedContext = CommandContext & HandlerScope;

/** A handler names the API subset it needs as `Api`. The router passes the whole API, which holds every subset. */
export const scoped = <Api = MessageApi>(handler: (scope: HandlerScope<Api>, args: CheckedArgs) => Promise<void>): CommandRun => (ctx, args) => handler(ctx as unknown as HandlerScope<Api>, args);
