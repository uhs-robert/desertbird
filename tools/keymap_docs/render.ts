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
function group_of(key: string, group_names: Record<string, string>): string {
  const tokens = parse_sequence(key).tokens ?? [key];
  for (let length = tokens.length - 1; length > 0; length--) {
    const name = group_names[tokens.slice(0, length).join("")];
    if (name !== undefined) return name;
  }
  return UNGROUPED;
}

function table(rows: readonly Row[]): string {
  const lines = rows.map((row) => `| ${[code(row.key), row.command].map(cell).join(" | ")} |`);
  return ["| Key | Command |", "| --- | --- |", ...lines].join("\n");
}

function section_text({ title, about, keymap }: KeymapSection, registry: Lookup, group_names: Record<string, string>): { text: string; count: number } {
  const by_group = new Map<string, Row[]>();
  for (const name of [UNGROUPED, ...Object.values(group_names)]) by_group.set(name, []);
  let count = 0;
  for (const [key, binding] of Object.entries(keymap.normal ?? {})) {
    if (!binding) continue;
    const name = group_of(key, group_names);
    by_group.set(name, [...(by_group.get(name) ?? []), { key, command: command_text(binding, registry) }]);
    count++;
  }
  const tables = [...by_group].filter(([, rows]) => rows.length > 0).map(([name, rows]) => `#### ${name}\n\n${table(rows)}`);
  return { text: [`### ${title}`, about, ...tables].join("\n\n"), count };
}

export function render(sections: readonly KeymapSection[], registry: Lookup, group_names: Record<string, string>): string {
  const rendered = sections.map((section) => section_text(section, registry, group_names));
  const per_section = sections.map((section, at) => `${section.title} ${rendered[at]!.count}`).join(", ");
  const counts = `bound: ${rendered.reduce((sum, { count }) => sum + count, 0)} (${per_section})`;
  return [counts, ...rendered.map(({ text }) => text)].join("\n\n");
}
