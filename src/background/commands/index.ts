// The command table of the background and the chrome runtime. Keys, help and the router read these definitions and define no behavior. A new group is one file plus one line in `GROUPS`.

import { create_registry } from "../../../vendor/desertfox/registry/define.ts";
import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import { compile_keymap } from "../../../vendor/desertfox/keys/compiler.ts";
import type { CompileResult, ResolveCommand } from "../../../vendor/desertfox/keys/compiler.ts";
import { ANY_KEY } from "../../../vendor/desertfox/prefix_tree.ts";
import type { TreeBranch, TreeNode } from "../../../vendor/desertfox/prefix_tree.ts";
import type { KeyBinding } from "../../../vendor/desertfox/invocation.ts";
import { parse_sequence } from "../../../vendor/desertfox/keys/notation.ts";
import { captured_key_param } from "../../../vendor/desertfox/registry/params.ts";
import type { Settings } from "../config/settings.ts";
import { with_captures } from "./captures.ts";
import type { CommandDefinition, CommandGroup } from "./define.ts";
import { app } from "./app.ts";
import { attachments } from "./attachments.ts";
import { clipboard } from "./clipboard.ts";
import { cmdline } from "./cmdline.ts";
import { compose } from "./compose.ts";
import { folders } from "./folders.ts";
import { followup } from "./followup.ts";
import { help } from "./help.ts";
import { hints } from "./hints.ts";
import { messages } from "./messages.ts";
import { new_mail } from "./new_mail.ts";
import { page } from "./page.ts";
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

export const GROUPS: Record<string, CommandGroup> = { motion, messages, compose, view, clipboard, tabs, cmdline, snooze, reading, folders, thread, unsubscribe, attachments, new_mail, quick_reply, followup, step, help, app, search, hints, page };

export const registry = create_registry();

/** The commands after which the key runtime drops plain keys for a moment: the ones that open the overlay, and the hint pick. A burst such as `f d d` would otherwise reach the runtime before the labels take the keys, and the `d` would delete. */
export const hold_command_ids = (): string[] => registry.list().filter((command) => command.needs?.includes("overlay.mount") || command.needs?.includes("hints.pick")).map((command) => command.id);

const define = (id: string, input: CommandDefinition) => registry.define(id, input);

for (const group of Object.values(GROUPS)) for (const [id, input] of Object.entries(group.commands)) define(id, input);

/** Ids of the commands `.` must not replay. */
export const UNREPEATABLE_IDS: ReadonlySet<string> = new Set(Object.values(GROUPS).flatMap((group) => Object.entries(group.commands).filter(([, input]) => input.repeatable === false).map(([id]) => id)));

/** Ids of the commands after which visual mode stays on. */
export const KEEPS_SELECTION_IDS: ReadonlySet<string> = new Set(Object.values(GROUPS).flatMap((group) => Object.entries(group.commands).filter(([, input]) => input.keeps_selection).map(([id]) => id)));

// The name of each prefix in which-key. The table is central because a prefix spans group files (`g`, `m`, `;`). The compiler writes each name into the branch, for the mail tree and the message tree alike, and skips a name whose prefix has no keys in a tree. A key row is labeled on its binding, not on its command, because help and completion read the command label.
export const GROUP_NAMES: Record<string, string> = {
    g: "Go",
    gr: "Quick reply",
    gp: "Pages",
    m: "Message",
    mz: "Snooze",
    mf: "Remind",
    F: "Filter",
    ",": "DesertBird",
    s: "Sort",
    t: "Panes",
    z: "List view",
    y: "Copy",
    ";": "Hints",
    "]": "Next",
    "[": "Previous",
    d: "Delete",
};

export const DEFAULT_KEYMAP: KeymapConfig = { normal: Object.assign({}, ...Object.values(GROUPS).map((group) => group.normal_keys)), group_names: GROUP_NAMES };

export const resolve_command: ResolveCommand = (command_id) => {
    const command = registry.get(command_id);
    return command && { runs_in: command.runs_in, label: command.label, count: command.count ?? "ignore", ...(command.params && { params: command.params }) };
};

const key_tokens = (sequence: string): string[] => parse_sequence(sequence).tokens ?? [];

/** The default bindings that wait for a key press (`M`, `'`) and that a user key extends (`Ma`). A stored `null` unbinds and extends nothing. The compiler would drop such a default key and its capture row with it. */
function extended_capture_defaults(keymap: KeymapConfig, default_layer: KeymapConfig | undefined): [sequence: string, binding: KeyBinding][] {
    const bindings = Object.entries(keymap.normal ?? {});
    return Object.entries(default_layer?.normal ?? {}).flatMap(([sequence, binding]) => {
        const waits = binding !== null && !Array.isArray(binding) && keymap.normal?.[sequence] === binding && captured_key_param({ params: registry.get(binding.id)?.params ?? [] }, binding.args) !== undefined;
        const tokens = key_tokens(sequence);
        const extended = bindings.some(([other, written]) => written !== null && key_tokens(other).length > tokens.length && tokens.every((token, index) => key_tokens(other)[index] === token));
        return waits && extended ? [[sequence, binding]] : [];
    });
}

/** The vendored compiler plus the capture branches of the leaves that wait for a key (`M` and `'`). A user key under such a prefix (`Ma`) keeps its own leaf, and the default capture row stays beside it for every other key: the matcher tries the typed key first and the capture second. */
export function compile_bindings(keymap: KeymapConfig, settings: Partial<Settings>, default_layer?: KeymapConfig): CompileResult {
    const kept_defaults = extended_capture_defaults(keymap, default_layer);
    const without_kept = { ...keymap, normal: Object.fromEntries(Object.entries(keymap.normal ?? {}).filter(([sequence]) => !kept_defaults.some(([kept]) => kept === sequence))) };
    const result = compile_keymap(without_kept, settings, resolve_command, undefined, default_layer);
    const normal = result.compiled.modes.normal;
    if (normal === undefined) return result;
    with_captures(normal, (id) => registry.get(id));
    for (const [sequence, binding] of kept_defaults) {
        let node: TreeNode | undefined = normal;
        for (const token of key_tokens(sequence)) node = node?.kind === "branch" ? node.children[token] : undefined;
        if (node?.kind !== "branch" || node.children[ANY_KEY] !== undefined) continue;
        const alone = compile_keymap({ normal: { [sequence]: binding } }, {}, resolve_command).compiled.modes.normal;
        if (alone === undefined) continue;
        with_captures(alone, (id) => registry.get(id));
        let own: TreeNode | undefined = alone;
        for (const token of key_tokens(sequence)) own = own?.kind === "branch" ? own.children[token] : undefined;
        if (own?.kind !== "branch" || own.children[ANY_KEY] === undefined) continue;
        node.children[ANY_KEY] = own.children[ANY_KEY];
        if (node.label === undefined && own.label !== undefined) node.label = own.label;
    }
    return result;
}

export function compile_default_keymap(): CompileResult {
    return compile_bindings(DEFAULT_KEYMAP, {});
}

// The groups whose mail keys also work while a message has the focus. They act on the displayed messages, which the body request reads from the sender tab. Every other group needs the thread list or the mail tab, so its keys stay out.
const MESSAGE_MAIL_GROUPS = [messages, compose, clipboard, followup, snooze, tabs, cmdline, unsubscribe, attachments, quick_reply];

// Keys of those groups that still need the list: `mR` reads the folder of the list, `Ft` and `Ff` filter it, `ss` sorts it and `;;` opens the line on `hint `, whose command labels the mail window. The close chords stay out because Ctrl+C and Ctrl+X must copy and cut in a message body.
const LIST_ONLY_KEYS: ReadonlySet<string> = new Set(["mR", "Ft", "Ff", "ss", ";;", "<C-x>", "<C-c>"]);

const mail_keys_for_message = Object.fromEntries(MESSAGE_MAIL_GROUPS.flatMap((group) => Object.entries(group.normal_keys)).filter(([keys]) => !LIST_ONLY_KEYS.has(keys)));

// The keys of the message document. The body script walks this tree, not the one of the mail tab. The reading keys come last, so `j`, `k`, `/` and the rest keep their message meaning.
export const MESSAGE_KEYMAP: KeymapConfig = { normal: Object.assign({}, mail_keys_for_message, ...Object.values(GROUPS).map((group) => group.message_keys)), group_names: GROUP_NAMES };

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
    return { normal: { ...MESSAGE_KEYMAP.normal, ...Object.fromEntries(kept) }, group_names: GROUP_NAMES };
}

// The message keys are the default layer, so a user key that extends a message key (`gfz` over `gf`) drops that key as it does in the mail tab.
// `mail_root` is the mail tree with the user's keys, so a user's mail sequence ends in a message too.
export function compile_message_keymap(user: KeymapConfig["normal"] = {}, mail_root = compile_default_keymap().compiled.modes.normal as TreeBranch): CompileResult {
    const result = compile_bindings(message_keymap(user), {}, MESSAGE_KEYMAP);
    complete_mail_sequences(result.compiled.modes.normal as TreeBranch, mail_root);
    return result;
}

// A mail sequence that the message tree lacks (`] a`, `g p a`, `; ; y`) would break partway, and the matcher retries the rest from the root, where `a` archives and `; y` copies a link. So every such sequence gets a leaf that runs nothing. A prefix the message tree lacks also takes any one key, so after a list prefix no key runs (`2 t a`). A mail key of one token stays out: nothing shorter can run in its place, and an absent chord must reach Thunderbird. A mail leaf whose key a capture (`ANY_KEY`) of the message branch takes is no gap. The compiler has no empty leaf, so this adds them after the compile.
function complete_mail_sequences(message_branch: TreeBranch, mail_branch: TreeBranch, is_root = true): void {
    for (const [token, mail_node] of Object.entries(mail_branch.children)) {
        if (mail_node.kind === "leaf" && (is_root || (message_branch.children[ANY_KEY] && [...token].length === 1))) continue;
        const message_node = (message_branch.children[token] ??= mail_node.kind === "leaf" ? { kind: "leaf", steps: [] } : { kind: "branch", children: { [ANY_KEY]: { kind: "leaf", steps: [] } } });
        if (mail_node.kind === "branch" && message_node.kind === "branch") complete_mail_sequences(message_node, mail_node, false);
    }
}

/** The ids of the background commands a message key may run, by default or by a user key. The background runs a request of the body script only for these. A command bound only to a list key (`mR`) stays out, since it needs the list. */
export function message_background_commands(): Set<string> {
    const in_message = new Set(invocations_of(MESSAGE_KEYMAP.normal ?? {}).map((invocation) => invocation.id));
    const needs_list = new Set(LIST_ONLY_DEFAULTS.map((invocation) => invocation.id).filter((id) => !in_message.has(id)));
    return new Set([...REBINDABLE_IN_MESSAGE].filter((id) => !needs_list.has(id) && registry.get(id)?.runs_in === "background"));
}
