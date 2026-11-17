// The settings DesertBird stores, cut from the vendored table. A setting is listed here when a DesertBird consumer reads it or will read it soon. The rest of the table belongs to web pages.

import { DEFAULT_SETTINGS } from "../../../vendor/desertfox/config.ts";
import type { Settings as VendoredSettings } from "../../../vendor/desertfox/config.ts";
import { MESSAGE_SCROLL_STEP_PX, MODE_INDICATORS, MODE_LABEL_STYLES } from "../../shared/protocol.ts";
import type { ModeLabelStyle } from "../../shared/protocol.ts";
import { DEFAULT_THEME, OASIS_THEME_NAMES } from "../../shared/theme_choice.ts";

/** The vendored table plus the settings only DesertBird has. The vendored table is a pinned copy and stays as it is. */
export type Settings = VendoredSettings & { message_scroll_step_px: number; notify_new_mail: boolean; notice_show_subject: boolean; mode_indicator_style: ModeLabelStyle; theme: string };


export type SettingName = "message_scroll_step_px" | "which_key_delay_ms" | "toast_ms" | "toast_error_ms" | "which_key_border" | "which_key_skip" | "layout_fallback" | "mode_indicator" | "mode_indicator_style" | "notify_new_mail" | "notice_show_subject" | "theme";

export type SettingKind = { kind: "number"; min?: number } | { kind: "boolean" } | { kind: "list" } | { kind: "choice"; choices: readonly string[] };

export const SETTING_KINDS: Record<SettingName, SettingKind> = {
    message_scroll_step_px: { kind: "number", min: 1 },
    which_key_delay_ms: { kind: "number" },
    toast_ms: { kind: "number" },
    toast_error_ms: { kind: "number" },
    which_key_border: { kind: "choice", choices: ["square", "round", "chamfer"] },
    which_key_skip: { kind: "list" },
    layout_fallback: { kind: "boolean" },
    mode_indicator: { kind: "choice", choices: MODE_INDICATORS },
    mode_indicator_style: { kind: "choice", choices: MODE_LABEL_STYLES },
    notify_new_mail: { kind: "boolean" },
    notice_show_subject: { kind: "boolean" },
    theme: { kind: "choice", choices: OASIS_THEME_NAMES },
};

export const SETTING_NAMES = Object.keys(SETTING_KINDS) as SettingName[];

export const is_setting_name = (name: string): name is SettingName => Object.hasOwn(SETTING_KINDS, name);

/** Why the value is not valid for the setting, or `undefined` when it is. */
export function setting_problem(name: SettingName, value: unknown): string | undefined {
    const spec = SETTING_KINDS[name];
    switch (spec.kind) {
        case "number":
            return typeof value === "number" && Number.isFinite(value) && value >= (spec.min ?? 0) ? undefined : `expected a number of at least ${spec.min ?? 0}`;
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

/** Every setting at its default: the vendored defaults plus DesertBird's own. */
export const SETTING_DEFAULTS: Settings = { ...DEFAULT_SETTINGS, message_scroll_step_px: MESSAGE_SCROLL_STEP_PX, notify_new_mail: false, notice_show_subject: true, mode_indicator: "always", mode_indicator_style: "classic", theme: DEFAULT_THEME };

export const settings_with_defaults = (overrides: Partial<Settings>): Settings => ({ ...SETTING_DEFAULTS, ...overrides });
