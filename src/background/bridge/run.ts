// What a program outside Thunderbird may run through the bridge, and the one path it takes: parse, the bridge rules, the one validator, then the router. The answer is success or a refusal text, never mail data.

import type { CommandDef } from "../../../vendor/desertfox/command.ts";
import { check_args } from "../../../vendor/desertfox/registry/check_args.ts";
import { parse_command_line } from "../../../vendor/desertfox/registry/command_line.ts";
import type { JsonValue, KeysInvocation } from "../../shared/protocol.ts";
import { GROUPS, registry } from "../commands/index.ts";

/** One row of the `list` reply. */
export type BridgeCommand = Pick<CommandDef, "id" | "label"> & Partial<Pick<CommandDef, "name" | "aliases" | "intent" | "params" | "count">>;

export type BridgeAnswer = { ok: true } | { ok: false; message: string };

// Whole groups that never run through the bridge, whatever a command's `bridge` field says. A name counts both as an id prefix (`config.reload`) and as a group file (`clipboard` holds `msg.yank` and `msg.open`).
// `hint` covers every hint command: a picked hint opens a link, and a link address comes from mail the user did not write.
const NEVER_GROUPS: readonly string[] = ["config", "settings", "native", "permissions", "clipboard", "hint"];
// `repeat.last` replays the last command of the window, which can be any command a key ran. `mark.set` writes stored state and `msg.undo` moves mail back.
// Send, delete and move (archive, junk and snooze move too) are on the list as well as `bridge: false`, so a later flag change alone cannot let them through.
// `search.message` succeeds only when its text is in the shown message, so its answer would leak the body one probe at a time. `search.threads` narrows the list to subjects and senders that match, and a step after it answers whether any did.
const NEVER_IDS: readonly string[] = ["search.message", "search.threads", "repeat.last", "mark.set", "msg.undo", "msg.delete", "msg.move", "msg.archive", "msg.junk", "msg.snooze", "msg.reply", "msg.forward", "msg.new", "msg.reply_with"];
// Commands that open an address taken from mail or typed by the caller.
const OPENS_URL_IDS: readonly string[] = ["hint.pick", "msg.open", "msg.unsubscribe", "app.open_page", "help.open", "options.open"];

const NEVER_GROUP_IDS: ReadonlySet<string> = new Set(NEVER_GROUPS.flatMap((name) => Object.keys(GROUPS[name]?.commands ?? {})));

// The ok or failed answer tells whether a typed name matched, so a command that matches text against mail names takes only values that name nothing.
const ARG_RULES: Record<string, (args: Record<string, unknown>) => string | undefined> = {
    // A title would be matched against tab titles, which are message subjects.
    "tab.switch": (args) => (/^\d+$/.test(String(args["tab"]).trim()) ? undefined : "tab.switch takes only a tab number through the bridge"),
    // A tag filter followed by a step answers whether a tag of that name exists and is in use.
    "filter.set": (args) => (args["state"] !== "tag" && !args["tag"] ? undefined : "filter.set takes no tag through the bridge"),
    "folder.open": (args) => (args["folder"] === "" && !args["account"] ? undefined : "folder.open takes only a special folder through the bridge"),
};

export const never_listed = (id: string): boolean => NEVER_GROUPS.includes(id.split(".")[0] ?? "") || NEVER_GROUP_IDS.has(id) || NEVER_IDS.includes(id) || OPENS_URL_IDS.includes(id);

// The caller's own text comes back in a parse refusal, so its length is capped before anything reads it.
export const MAX_COMMAND_CHARS = 4096;

export interface BridgeRunDeps {
    /** The main window a command acts on: the last focused normal window, or undefined when none is open. */
    target_window(): Promise<number | undefined>;
    /** Runs one checked invocation through the router. It throws on a refusal or a failure. */
    route(invocation: KeysInvocation): Promise<void>;
}

const refuse = (message: string): BridgeAnswer => ({ ok: false, message });

// The rules that hold before any arg is read.
function refusal_for(command: CommandDef & { bridge?: boolean }): string | undefined {
    if (never_listed(command.id)) return `${command.id} never runs through the bridge`;
    if (command.bridge !== true) return `${command.id} is not allowed through the bridge`;
    // A chrome or message command runs on a key in the window, and the background has no verb to start it.
    if (command.runs_in !== "background") return `${command.id} runs on a key in the mail window and cannot run through the bridge`;
    return undefined;
}

const bridge_command = (id: string) => registry.get(id) as (CommandDef & { bridge?: boolean }) | undefined;

export function create_bridge_run(deps: BridgeRunDeps) {
    async function run(command_text: string): Promise<BridgeAnswer> {
        if (command_text.length > MAX_COMMAND_CHARS) return refuse("the command text is too long");
        // A refused command is refused on its first word, before its args are parsed. A quoted first word skips this and is caught after the parse.
        const first_word = /^\s*([^\s"'\\]+)(?:\s|$)/.exec(command_text)?.[1];
        const named = first_word === undefined ? undefined : registry.find(first_word);
        const early_refusal = named && refusal_for(named);
        if (early_refusal) return refuse(early_refusal);
        // Parsing reads only the text and the registry. No dynamic value list is read, so a folder or tag name never reaches the reply.
        const parsed = parse_command_line(registry, command_text);
        if (parsed.kind === "error") return refuse(parsed.error);
        if (parsed.kind === "help") return refuse("help is not available through the bridge");
        const command = bridge_command(parsed.invocation.id);
        if (command === undefined) return refuse(`unknown command "${parsed.invocation.id}"`);
        const refusal = refusal_for(command);
        if (refusal !== undefined) return refuse(refusal);
        // An `@source` parses to an object. DesertBird has no context sources.
        if (Object.values(parsed.invocation.args ?? {}).some((value) => typeof value === "object" && value !== null)) return refuse(`${command.id} does not take @sources through the bridge`);
        const checked = check_args(command, parsed.invocation.args);
        if (!checked.ok) return refuse(checked.error);
        const arg_refusal = ARG_RULES[command.id]?.(checked.args);
        if (arg_refusal !== undefined) return refuse(arg_refusal);
        const window_id = await deps.target_window();
        if (window_id === undefined) return refuse("no mail window is open");
        try {
            await deps.route({ command: command.id, args: (parsed.invocation.args ?? {}) as Record<string, JsonValue>, count: 1, windowId: window_id, messageIds: [] });
        } catch {
            // A handler refusal can name a folder or a subject, so the caller gets fixed text. Only the parse, rule and validator refusals above echo the caller's own text.
            return refuse(`${command.id} failed`);
        }
        return { ok: true };
    }

    return { run };
}

// The commands `run` accepts, with their params, for completion in the CLI. A param of folders or tags carries only its `{ from }` source, never the names.
export function list_bridge_commands(): BridgeCommand[] {
    return registry
        .list()
        .filter((command) => refusal_for(command) === undefined)
        .map(({ id, name, aliases, label, intent, params, count }) => ({ id, label, ...(name !== undefined && { name }), ...(aliases !== undefined && { aliases }), ...(intent !== undefined && { intent }), ...(params !== undefined && { params }), ...(count !== undefined && { count }) }));
}
