// The logic behind the options page, free of the DOM so tests drive it directly.

import type { KeyBinding } from "../../vendor/desertfox/invocation.ts";
import { DEFAULT_KEYMAP, is_menu_command } from "../background/commands/index.ts";
import { default_menu_keymap, menu_direction_of, menu_key_table } from "../background/commands/tab_keymaps.ts";
import { parse_sequence } from "../../vendor/desertfox/keys/notation.ts";
import { compile_effective_keymap } from "../background/config/keymap.ts";
import type { UserKeymap } from "../background/config/keymap.ts";
import { SETTING_KINDS, setting_problem } from "../background/config/settings.ts";
import type { SettingName, Settings } from "../background/config/settings.ts";

const is_list_kind = (kind: string) => kind === "list" || kind === "choice_list";

/** The form text of a setting value: a list reads as comma-separated text. */
export function setting_to_text(name: SettingName, value: unknown): string {
    return is_list_kind(SETTING_KINDS[name].kind) ? (value as string[]).join(", ") : String(value);
}

export type SettingParse = { value: Settings[SettingName] } | { error: string };

export function parse_setting_text(name: SettingName, text: string): SettingParse {
    const spec = SETTING_KINDS[name];
    const trimmed = text.trim();
    // A line keeps its spaces: a prompt such as "$ " needs the one at its end.
    let value: unknown = spec.kind === "line" ? text : trimmed;
    if (spec.kind === "number") value = trimmed === "" ? Number.NaN : Number(trimmed);
    else if (spec.kind === "boolean") value = trimmed === "true" ? true : trimmed === "false" ? false : trimmed;
    else if (is_list_kind(spec.kind)) value = trimmed === "" ? [] : trimmed.split(",").map((item) => item.trim());
    const problem = setting_problem(name, value);
    return problem === undefined ? { value: value as Settings[SettingName] } : { error: problem };
}

/** The overrides the form holds: a field equal to its default is no override. */
export function overrides_from_texts(texts: Record<SettingName, string>, defaults: Settings): { overrides: Partial<Settings>; errors: Partial<Record<SettingName, string>> } {
    const overrides: Record<string, unknown> = {};
    const errors: Partial<Record<SettingName, string>> = {};
    for (const name of Object.keys(SETTING_KINDS) as SettingName[]) {
        const parsed = parse_setting_text(name, texts[name]);
        if ("error" in parsed) errors[name] = parsed.error;
        else if (JSON.stringify(parsed.value) !== JSON.stringify(defaults[name])) overrides[name] = parsed.value;
    }
    return { overrides: overrides as Partial<Settings>, errors };
}

export interface BindingRow {
    keys: string;
    command: string;
    /** JSON text of the args, empty for none. */
    args: string;
}

export interface BindingEdits {
    /** Default key sequences the user unbinds. */
    removed: string[];
    /** The user's own bindings, which also replace a default of the same keys. */
    rows: BindingRow[];
}

const single = (binding: KeyBinding | null | undefined) => (binding && !Array.isArray(binding) ? binding : undefined);

export function default_rows(): BindingRow[] {
    return Object.entries(DEFAULT_KEYMAP.normal ?? {}).flatMap(([keys, binding]) => {
        const one = single(binding);
        return one ? [{ keys, command: one.id, args: one.args ? JSON.stringify(one.args) : "" }] : [];
    });
}

/** The default menu keys, shown in the options page apart from the thread list keys. */
export function default_menu_rows(): BindingRow[] {
    return Object.entries(default_menu_keymap().normal ?? {}).flatMap(([keys, binding]) => {
        const one = single(binding);
        return one ? [{ keys, command: one.id, args: "" }] : [];
    });
}

/** The edits of the `menu` section of the user keymap, which `edits_from_user_keymap` leaves out. */
export const menu_edits_from_user_keymap = (user: UserKeymap): BindingEdits => edits_from_user_keymap(user.menu ? { normal: user.menu } : {});

export function edits_from_user_keymap(user: UserKeymap): BindingEdits {
    const entries = Object.entries(user.normal ?? {});
    return {
        removed: entries.filter(([, binding]) => binding === null).map(([keys]) => keys),
        rows: entries.flatMap(([keys, binding]) => {
            const one = single(binding);
            return one ? [{ keys, command: one.id, args: one.args ? JSON.stringify(one.args) : "" }] : [];
        }),
    };
}

/** Whether the compiled tree runs the row's command on the row's keys. The tree says it, so no compiler message is parsed. */
function binding_is_active(root: unknown, row: BindingRow): boolean {
    const { tokens } = parse_sequence(row.keys.trim());
    let node = root as { kind?: string; children?: Record<string, unknown>; steps?: { invocation: { id: string } }[] } | undefined;
    for (const token of tokens ?? []) node = node?.children?.[token] as typeof node;
    return node?.kind === "leaf" && node.steps?.[0]?.invocation.id === row.command.trim();
}

export type KeymapBuild = { user_keymap: UserKeymap; messages: string[]; blocked: boolean } | { error: string };

/** Builds the user keymap from the edits and runs it through the compiler. A user binding the compiled tree does not run blocks the save, so a typo never reaches storage. Other compiler messages, such as a default key skipped because of a user key, are shown and do not block. */
export function build_user_keymap(edits: BindingEdits, settings: Partial<Settings> = {}, menu_edits: BindingEdits = { removed: [], rows: [] }): KeymapBuild {
    const normal: NonNullable<UserKeymap["normal"]> = {};
    if (edits.rows.some((row) => is_menu_command(row.command.trim()))) return { error: "a menu command belongs in the menu keys section" };
    for (const keys of edits.removed) normal[keys] = null;
    for (const row of edits.rows) {
        if (row.keys.trim() === "" || row.command.trim() === "") return { error: "every binding needs keys and a command" };
        let args: unknown;
        if (row.args.trim() !== "") {
            try {
                args = JSON.parse(row.args);
            } catch {
                return { error: `the args of "${row.keys}" are not valid JSON` };
            }
            if (typeof args !== "object" || args === null || Array.isArray(args)) return { error: `the args of "${row.keys}" must be a JSON object` };
        }
        normal[row.keys.trim()] = { id: row.command.trim(), ...(args === undefined ? {} : { args: args as Record<string, unknown> }) };
    }
    const menu: NonNullable<UserKeymap["menu"]> = {};
    for (const keys of menu_edits.removed) menu[keys] = null;
    for (const row of menu_edits.rows) {
        if (row.keys.trim() === "" || row.command.trim() === "") return { error: "every menu key needs a key and a command" };
        menu[row.keys.trim()] = { id: row.command.trim() };
    }
    // The table keeps a key only when it is one typed character that runs a menu command, so a row it lacks blocks the save.
    const table = menu_key_table(menu);
    const bad_menu_row = menu_edits.rows.find((row) => !is_menu_command(row.command.trim()) || table[row.keys.trim()] !== menu_direction_of(row.command.trim()));
    if (bad_menu_row) return { error: `"${bad_menu_row.keys}" must be one typed character and a menu command` };
    const user_keymap: UserKeymap = { normal, ...(Object.keys(menu).length > 0 && { menu }) };
    const { compiled, warnings } = compile_effective_keymap(user_keymap, settings);
    const skipped_row = edits.rows.find((row) => !binding_is_active(compiled.modes.normal, row));
    return { user_keymap, messages: warnings, blocked: skipped_row !== undefined };
}
