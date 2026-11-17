// The help page's rows, free of the DOM so tests drive them. Every row comes from the command registry and the effective keymap, so a new command or a changed binding shows with no help text to update.

import type { KeyBinding } from "../../vendor/desertfox/invocation.ts";
import type { KeymapConfig } from "../../vendor/desertfox/keymap.ts";
import type { Registry } from "../../vendor/desertfox/registry/define.ts";
import { usage_line } from "../../vendor/desertfox/registry/usage.ts";

export interface HelpKey {
    keys: string;
    /** The args the binding sets, as text. Empty when it sets none. */
    args: string;
}

export interface HelpEntry {
    id: string;
    /** The word that types the command on the command line. */
    word: string;
    label: string;
    intent: string;
    usage: string;
    keys: HelpKey[];
    /** Where the command runs: only `background` commands run from the command line. */
    runs_in: string;
}

export interface HelpGroup {
    /** The part of the id before the dot: `msg`, `view`, `tab`. */
    name: string;
    entries: HelpEntry[];
}

const single = (binding: KeyBinding | null | undefined) => (binding && !Array.isArray(binding) ? binding : undefined);

function keys_by_command(keymap: KeymapConfig): Map<string, HelpKey[]> {
    const by_command = new Map<string, HelpKey[]>();
    for (const [keys, binding] of Object.entries(keymap.normal ?? {})) {
        const one = single(binding);
        if (one === undefined) continue;
        const list = by_command.get(one.id) ?? [];
        list.push({ keys, args: one.args ? Object.entries(one.args).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(" ") : "" });
        by_command.set(one.id, list);
    }
    return by_command;
}

/** Commands grouped by the part of the id before the dot, in id order, each with the keys the keymap binds to it. */
export function help_groups(registry: Registry, keymap: KeymapConfig): HelpGroup[] {
    const keys = keys_by_command(keymap);
    const groups = new Map<string, HelpEntry[]>();
    for (const command of [...registry.list()].sort((left, right) => left.id.localeCompare(right.id))) {
        const name = command.id.split(".")[0] ?? command.id;
        const entries = groups.get(name) ?? [];
        entries.push({
            id: command.id,
            word: command.name ?? command.id,
            label: command.label,
            intent: command.intent,
            usage: usage_line(command),
            keys: keys.get(command.id) ?? [],
            runs_in: command.runs_in,
        });
        groups.set(name, entries);
    }
    return [...groups].map(([name, entries]) => ({ name, entries }));
}
