// The help page's rows, free of the DOM so tests drive them. Every row comes from the command registry and the effective keymap, so a new command or a changed binding shows with no help text to update.

import type { KeymapConfig } from "../../vendor/desertfox/keymap.ts";
import type { Registry } from "../../vendor/desertfox/registry/define.ts";
import { usage_line } from "../../vendor/desertfox/registry/usage.ts";

export interface HelpKey {
    keys: string;
    /** The args the binding sets, as readable text. Empty when it sets none. */
    args: string;
    /** `message` for a key that works in a message document (the reading pane, a message tab or window), empty for the mail tab. */
    where: "" | "message";
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

const readable_value = (value: unknown): string => (typeof value === "string" ? value.trim() : JSON.stringify(value));

const readable_args = (args: Record<string, unknown> | undefined): string => Object.entries(args ?? {}).map(([name, value]) => `${name}: ${readable_value(value)}`).join(", ");

/** The keys of each command in a keymap. A binding that runs several steps lists under each command it runs. */
function keys_by_command(keymap: KeymapConfig, where: HelpKey["where"], into: Map<string, HelpKey[]>): void {
    for (const [keys, binding] of Object.entries(keymap.normal ?? {})) {
        const steps = binding === null || binding === undefined ? [] : Array.isArray(binding) ? binding : [binding];
        for (const step of steps) into.set(step.id, [...(into.get(step.id) ?? []), { keys, args: readable_args(step.args), where }]);
    }
}

/** Commands grouped by the part of the id before the dot, in id order, each with the keys the keymap binds to it. */
export function help_groups(registry: Registry, keymap: KeymapConfig, message_keymap: KeymapConfig = {}): HelpGroup[] {
    const keys = new Map<string, HelpKey[]>();
    keys_by_command(keymap, "", keys);
    keys_by_command(message_keymap, "message", keys);
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
