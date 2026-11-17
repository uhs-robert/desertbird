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

// Keys of those groups that still need the list: `mR` reads the folder of the list, `Ft` filters it.
const LIST_ONLY_KEYS: ReadonlySet<string> = new Set(["mR", "Ft"]);

const mail_keys_for_message = Object.fromEntries(MESSAGE_MAIL_GROUPS.flatMap((group) => Object.entries(group.normal_keys)).filter(([keys]) => !LIST_ONLY_KEYS.has(keys)));

// The keys of the message document. The body script walks this tree, not the one of the mail tab. The reading keys come last, so `j`, `k`, `/` and the rest keep their message meaning.
export const MESSAGE_KEYMAP: KeymapConfig = { normal: Object.assign({}, mail_keys_for_message, ...Object.values(GROUPS).map((group) => group.message_keys)) };

export function compile_message_keymap(): CompileResult {
    return compile_keymap(MESSAGE_KEYMAP, {}, resolve_command);
}

/** The ids of the background commands a message key binds. The background runs a request of the body script only for these. */
export function message_background_commands(): Set<string> {
    const bound = Object.values(MESSAGE_KEYMAP.normal ?? {}).flatMap((binding) => (Array.isArray(binding) ? binding : binding ? [binding] : []));
    return new Set(bound.map((invocation) => invocation.id).filter((id) => registry.get(id)?.runs_in === "background"));
}
