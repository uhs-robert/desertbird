// The command table of the background and the chrome runtime. Keys, help and the router read these definitions and define no behavior. A new group is one file plus one line in `GROUPS`.

import { create_registry } from "../../../vendor/desertfox/registry/define.ts";
import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import { compile_keymap } from "../../../vendor/desertfox/keys/compiler.ts";
import type { CompileResult, ResolveCommand } from "../../../vendor/desertfox/keys/compiler.ts";
import type { CommandDefinition, CommandGroup } from "./define.ts";
import { app } from "./app.ts";
import { attachments } from "./attachments.ts";
import { clipboard } from "./clipboard.ts";
import { cmdline } from "./cmdline.ts";
import { compose } from "./compose.ts";
import { folders } from "./folders.ts";
import { followup } from "./followup.ts";
import { help } from "./help.ts";
import { messages } from "./messages.ts";
import { new_mail } from "./new_mail.ts";
import { motion } from "./motion.ts";
import { search } from "./search.ts";
import { snooze } from "./snooze.ts";
import { quick_reply } from "./quick_reply.ts";
import { reading } from "./reading.ts";
import { view } from "./view.ts";
import { tabs } from "./tabs.ts";
import { step } from "./step.ts";
import { thread } from "./thread.ts";
import { unsubscribe } from "./unsubscribe.ts";

export type { ScopedContext } from "./define.ts";

export const GROUPS: Record<string, CommandGroup> = { motion, messages, compose, view, clipboard, tabs, cmdline, snooze, reading, folders, thread, unsubscribe, attachments, new_mail, quick_reply, followup, step, help, app, search };

export const registry = create_registry();

const define = (id: string, input: CommandDefinition) => registry.define(id, input);

for (const group of Object.values(GROUPS)) for (const [id, input] of Object.entries(group.commands)) define(id, input);

/** Ids of the commands `.` must not replay. */
export const UNREPEATABLE_IDS: ReadonlySet<string> = new Set(Object.values(GROUPS).flatMap((group) => Object.entries(group.commands).filter(([, input]) => input.repeatable === false).map(([id]) => id)));

export const DEFAULT_KEYMAP: KeymapConfig = { normal: Object.assign({}, ...Object.values(GROUPS).map((group) => group.normal_keys)) };

export const resolve_command: ResolveCommand = (command_id) => {
    const command = registry.get(command_id);
    return command && { runs_in: command.runs_in, label: command.label, count: command.count ?? "ignore", ...(command.params && { params: command.params }) };
};

export function compile_default_keymap(): CompileResult {
    return compile_keymap(DEFAULT_KEYMAP, {}, resolve_command);
}

// The groups whose mail keys also work while a message has the focus. They act on the displayed messages, which the body request reads from the sender tab. Every other group needs the thread list or the mail tab, so its keys stay out.
const MESSAGE_MAIL_GROUPS = [messages, compose, clipboard, followup, snooze, tabs, cmdline];

// Keys of those groups that still need the list: `mR` reads the folder of the list, `Ft` and `Ff` filter it and `,,` sorts it. The close chords stay out because Ctrl+C and Ctrl+X must copy and cut in a message body.
const LIST_ONLY_KEYS: ReadonlySet<string> = new Set(["mR", "Ft", "Ff", ",,", "<C-x>", "<C-c>", "<C-h>"]);

const mail_keys_for_message = Object.fromEntries(MESSAGE_MAIL_GROUPS.flatMap((group) => Object.entries(group.normal_keys)).filter(([keys]) => !LIST_ONLY_KEYS.has(keys)));

// The keys of the message document. The body script walks this tree, not the one of the mail tab. The reading keys come last, so `j`, `k`, `/` and the rest keep their message meaning.
export const MESSAGE_KEYMAP: KeymapConfig = { normal: Object.assign({}, mail_keys_for_message, ...Object.values(GROUPS).map((group) => group.message_keys)) };

// Closes the tab on chords that must copy and cut in a message body, so no user key may carry it there.
const NEVER_REBOUND_IN_MESSAGE: ReadonlySet<string> = new Set(["tab.close_mail"]);

const invocations_of = (bindings: NonNullable<KeymapConfig["normal"]>) => Object.values(bindings).flatMap((binding) => (Array.isArray(binding) ? binding : binding ? [binding] : []));

// The commands a user key may run in a message: those of the message groups and the reading keys. A binding of any other command (a list motion, `repeat.last`) stays in the mail tab.
const REBINDABLE_IN_MESSAGE: ReadonlySet<string> = new Set([
    ...MESSAGE_MAIL_GROUPS.flatMap((group) => Object.keys(group.commands)),
    ...invocations_of(MESSAGE_KEYMAP.normal ?? {}).map((invocation) => invocation.id),
].filter((id) => !NEVER_REBOUND_IN_MESSAGE.has(id)));

const LIST_ONLY_DEFAULTS = invocations_of(Object.fromEntries(MESSAGE_MAIL_GROUPS.flatMap((group) => Object.entries(group.normal_keys)).filter(([keys]) => LIST_ONLY_KEYS.has(keys))));

// A user key with the same command and args as a list-only default (`,,` is `cmdline.open` with `sort `) needs the list as well. Args compare with sorted keys, so the order in a stored binding does not matter.
const same_binding_key = (invocation: { id: string; args?: object }) => JSON.stringify([invocation.id, Object.entries(invocation.args ?? {}).sort(([left], [right]) => (left < right ? -1 : 1))]);
const LIST_ONLY_BINDINGS: ReadonlySet<string> = new Set(LIST_ONLY_DEFAULTS.map(same_binding_key));

/** The message keys with the user's bindings of message commands on top. A `null` goes through, and the compiler removes the key it names, however spelled. */
export function message_keymap(user: KeymapConfig["normal"] = {}): KeymapConfig {
    const kept = Object.entries(user ?? {}).filter(([, binding]) => binding === null || (!Array.isArray(binding) && REBINDABLE_IN_MESSAGE.has(binding.id) && !LIST_ONLY_BINDINGS.has(same_binding_key(binding))));
    return { normal: { ...MESSAGE_KEYMAP.normal, ...Object.fromEntries(kept) } };
}

// The message keys are the default layer, so a user key that extends a message key (`gfz` over `gf`) drops that key as it does in the mail tab.
export function compile_message_keymap(user: KeymapConfig["normal"] = {}): CompileResult {
    return compile_keymap(message_keymap(user), {}, resolve_command, undefined, MESSAGE_KEYMAP);
}

/** The ids of the background commands a message key may run, by default or by a user key. The background runs a request of the body script only for these. A command bound only to a list key (`mR`) stays out, since it needs the list. */
export function message_background_commands(): Set<string> {
    const in_message = new Set(invocations_of(MESSAGE_KEYMAP.normal ?? {}).map((invocation) => invocation.id));
    const needs_list = new Set(LIST_ONLY_DEFAULTS.map((invocation) => invocation.id).filter((id) => !in_message.has(id)));
    return new Set([...REBINDABLE_IN_MESSAGE].filter((id) => !needs_list.has(id) && registry.get(id)?.runs_in === "background"));
}
