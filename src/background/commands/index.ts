// The command table of the background and the chrome runtime. Keys, help and the router read these definitions and define no behavior. A new group is one file plus one line in `GROUPS`.

import { create_registry } from "../../../vendor/desertfox/registry/define.ts";
import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import { compile_keymap } from "../../../vendor/desertfox/keys/compiler.ts";
import type { CompileResult, ResolveCommand } from "../../../vendor/desertfox/keys/compiler.ts";
import { ANY_KEY } from "../../../vendor/desertfox/prefix_tree.ts";
import type { TreeNode } from "../../../vendor/desertfox/prefix_tree.ts";
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
import { context } from "./context.ts";
import { folders } from "./folders.ts";
import { followup } from "./followup.ts";
import { help } from "./help.ts";
import { hints } from "./hints.ts";
import { menu } from "./menu.ts";
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
import { zoom } from "./zoom.ts";

export type { ScopedContext } from "./define.ts";

export const GROUPS: Record<string, CommandGroup> = { motion, messages, compose, view, clipboard, tabs, cmdline, snooze, reading, folders, thread, unsubscribe, attachments, new_mail, quick_reply, followup, step, help, app, search, hints, page, zoom, menu, context };

export const registry = create_registry();

/** The commands after which the key runtime drops plain keys for a moment: the ones that open the overlay, and the hint pick. A burst such as `f d d` would otherwise reach the runtime before the labels take the keys, and the `d` would delete. */
export const hold_command_ids = (): string[] => registry.list().filter((command) => command.needs?.includes("overlay.mount") || command.needs?.includes("hints.pick")).map((command) => command.id);

const define = (id: string, input: CommandDefinition) => registry.define(id, input);

for (const group of Object.values(GROUPS)) for (const [id, input] of Object.entries(group.commands)) define(id, input);

/** Whether the command is a menu key command (`menu.down`, `menu.up`, `menu.left`, `menu.right`): the one test the stored keymap, the options page and the menu key table share. */
export const is_menu_command = (id: string): boolean => registry.get(id)?.needs?.includes("menu") === true;

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
    Fm: "By message",
    ",": "DesertBird",
    s: "Sort",
    t: "Tabs",
    w: "Panes",
    z: "Zoom and scroll",
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
