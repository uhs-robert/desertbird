// The settings DesertBird stores, cut from the vendored table. A setting is listed here when a DesertBird consumer reads it or will read it soon. The rest of the table belongs to web pages.

import { DEFAULT_SETTINGS } from "../../../vendor/desertfox/config.ts";
import type { Settings } from "../../../vendor/desertfox/config.ts";

export type SettingName = "which_key_delay_ms" | "toast_ms" | "toast_error_ms" | "which_key_border" | "which_key_skip" | "layout_fallback" | "mode_indicator";

export type SettingKind = { kind: "number" } | { kind: "boolean" } | { kind: "list" } | { kind: "choice"; choices: readonly string[] };

export const SETTING_KINDS: Record<SettingName, SettingKind> = {
    which_key_delay_ms: { kind: "number" },
    toast_ms: { kind: "number" },
    toast_error_ms: { kind: "number" },
    which_key_border: { kind: "choice", choices: ["square", "round", "chamfer"] },
    which_key_skip: { kind: "list" },
    layout_fallback: { kind: "boolean" },
    mode_indicator: { kind: "choice", choices: ["always", "not_normal", "off"] },
};

export const SETTING_NAMES = Object.keys(SETTING_KINDS) as SettingName[];

export const is_setting_name = (name: string): name is SettingName => Object.hasOwn(SETTING_KINDS, name);

/** Why the value is not valid for the setting, or `undefined` when it is. */
export function setting_problem(name: SettingName, value: unknown): string | undefined {
    const spec = SETTING_KINDS[name];
    switch (spec.kind) {
        case "number":
            return typeof value === "number" && Number.isFinite(value) && value >= 0 ? undefined : "expected a number of at least 0";
        case "boolean":
            return typeof value === "boolean" ? undefined : "expected true or false";
        case "list":
            return Array.isArray(value) && value.every((item) => typeof item === "string") ? undefined : "expected a list of text";
        case "choice":
            return typeof value === "string" && spec.choices.includes(value) ? undefined : `expected one of ${spec.choices.join(", ")}`;
    }
}

/** Keeps the valid known entries of what storage holds. Stored data is untrusted: another version or a hand edit may have written it. */
export function sanitize_settings(raw: unknown, on_problem: (message: string) => void = () => {}): Partial<Settings> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const kept: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(raw)) {
        if (!is_setting_name(name)) {
            on_problem(`ignored the unknown setting "${name}"`);
            continue;
        }
        const problem = setting_problem(name, value);
        if (problem === undefined) kept[name] = value;
        else on_problem(`ignored ${name}: ${problem}`);
    }
    return kept as Partial<Settings>;
}

export const settings_with_defaults = (overrides: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });
