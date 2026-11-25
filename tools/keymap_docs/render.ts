// Renders the generated block of docs/keymap.md: a count line, then for each tab kind one table per which-key group.

import type { CommandDef } from "../../vendor/desertfox/command.ts";
import type { BoundInvocation, KeyBinding } from "../../vendor/desertfox/invocation.ts";
import type { KeymapConfig } from "../../vendor/desertfox/keymap.ts";
import { parse_sequence } from "../../vendor/desertfox/keys/notation.ts";
import { print_command } from "../../vendor/desertfox/registry/print_command.ts";
import { cell, code } from "./splice.ts";

type Lookup = { get(id: string): CommandDef | undefined };

/** One tab kind: its heading, a line saying what it is, and its default keys. */
export type KeymapSection = { title: string; about: string; keymap: KeymapConfig };

type Row = { key: string; command: string };

const UNGROUPED = "Single keys";

function command_text(binding: Exclude<KeyBinding, null>, registry: Lookup): string {
  const steps: BoundInvocation[] = [binding].flat();
  const texts = steps.map((step) => {
    const command = registry.get(step.id);
    return command ? print_command(command, step.args ?? {}, { flags: "long" }) : step.id;
  });
  const prompts = steps.some((step) => step.prompt) ? " (prompts)" : "";
  return `${code(texts.join(" ; "))}${prompts}`;
}

// The group of a key is its longest proper prefix that has a name. A key with none is a single key or sits under an unnamed prefix.
// Groups are keyed by prefix and not by name, because two groups can share a name ("Message" is both `m` and `bm`).
function group_of(key: string, group_names: Record<string, string>): string {
  const tokens = parse_sequence(key).tokens ?? [key];
  for (let length = tokens.length - 1; length > 0; length--) {
    const prefix = tokens.slice(0, length).join("");
    if (group_names[prefix] !== undefined) return prefix;
  }
  return UNGROUPED;
}

// A nested group whose name another group also has reads after its parent, so `bm` is "Filter by message" and not a second "Message".
function heading_of(prefix: string, group_names: Record<string, string>): string {
  if (prefix === UNGROUPED) return UNGROUPED;
  const name = group_names[prefix]!;
  const parent = group_of(prefix, group_names);
  const is_duplicate = Object.values(group_names).filter((other) => other === name).length > 1;
  return parent === UNGROUPED || !is_duplicate ? name : `${heading_of(parent, group_names)} ${name.toLowerCase()}`;
}

function table(rows: readonly Row[]): string {
  const lines = rows.map((row) => `| ${[code(row.key), row.command].map(cell).join(" | ")} |`);
  return ["| Key | Command |", "| --- | --- |", ...lines].join("\n");
}

function section_text({ title, about, keymap }: KeymapSection, registry: Lookup, group_names: Record<string, string>): { text: string; count: number } {
  const by_group = new Map<string, Row[]>();
  for (const prefix of [UNGROUPED, ...Object.keys(group_names)]) by_group.set(prefix, []);
  let count = 0;
  for (const [key, binding] of Object.entries(keymap.normal ?? {})) {
    if (!binding) continue;
    const prefix = group_of(key, group_names);
    by_group.set(prefix, [...(by_group.get(prefix) ?? []), { key, command: command_text(binding, registry) }]);
    count++;
  }
  const tables = [...by_group].filter(([, rows]) => rows.length > 0).map(([prefix, rows]) => `#### ${heading_of(prefix, group_names)}\n\n${table(rows)}`);
  return { text: [`### ${title}`, about, ...tables].join("\n\n"), count };
}

export function render(sections: readonly KeymapSection[], registry: Lookup, group_names: Record<string, string>): string {
  const rendered = sections.map((section) => section_text(section, registry, group_names));
  const per_section = sections.map((section, at) => `${section.title} ${rendered[at]!.count}`).join(", ");
  const counts = `bound: ${rendered.reduce((sum, { count }) => sum + count, 0)} (${per_section})`;
  return [counts, ...rendered.map(({ text }) => text)].join("\n\n");
}
