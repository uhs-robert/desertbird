// The settings DesertBird stores, cut from the vendored table. A setting is listed here when a DesertBird consumer reads it or will read it soon. The rest of the table belongs to web pages.

import { DEFAULT_SETTINGS } from "../../../vendor/desertfox/config.ts";
import type { Settings as VendoredSettings } from "../../../vendor/desertfox/config.ts";
import { parse_sequence } from "../../../vendor/desertfox/keys/notation.ts";
import { MESSAGE_SCROLL_STEP_PX, MODE_INDICATORS, MODE_LABEL_STYLES } from "../../shared/protocol.ts";
import type { ModeLabelStyle } from "../../shared/protocol.ts";
import { DEFAULT_THEME, OASIS_THEME_NAMES } from "../../shared/theme_choice.ts";

/** The vendored table plus the settings only DesertBird has. The vendored table is a pinned copy and stays as it is. */
export type Settings = VendoredSettings & { message_scroll_step_px: number; notify_new_mail: boolean; notice_show_subject: boolean; mode_indicator_style: ModeLabelStyle; theme: string; external_editor: boolean; compose_send: boolean; cmdline_prompt: string; statusbar_widgets: string[]; hint_letters: string } & BridgeShareSettings & BridgeAllowSettings;

/** What the bridge may read. Each is inert while `bridge` is off. */
export type BridgeShareSettings = { bridge_share_headers: boolean; bridge_share_bodies: boolean; bridge_share_attachments: boolean; bridge_share_folders: boolean };

/** What the bridge may write. Each is inert while `bridge` is off. */
export type BridgeAllowSettings = { bridge_allow_drafts: boolean; bridge_allow_actions: boolean };


export type SettingName = "message_scroll_step_px" | "which_key_delay_ms" | "toast_ms" | "toast_error_ms" | "which_key_border" | "which_key_skip" | "layout_fallback" | "mode_indicator" | "mode_indicator_style" | "notify_new_mail" | "notice_show_subject" | "theme" | "external_editor" | "compose_send" | "cmdline_prompt" | "statusbar_widgets" | "hint_letters" | "bridge" | keyof BridgeShareSettings | keyof BridgeAllowSettings;

/** The longest custom prompt the line draws, as in DesertFox. `caret` and `colon` are the two named looks. */
const CMDLINE_PROMPT_MAX_LENGTH = 8;

/** The widgets the right end of the command line can show, in the names the `statusbar_widgets` setting takes. */
export const STATUS_WIDGET_NAMES = ["folder", "position"] as const;

/** The bounds of the toast time settings, as in DesertFox. */
export const TOAST_MIN_MS = 500;
export const TOAST_MAX_MS = 30000;

/** `whole` means an integer. `key_list` is a list of key sequences in keymap notation, as DesertFox checks `which_key_skip`. `letters` is the hint alphabet: two or more distinct characters, none of them `/`. */
export type SettingKind = { kind: "number"; min?: number; max?: number; whole?: boolean } | { kind: "boolean" } | { kind: "list" } | { kind: "key_list" } | { kind: "letters" } | { kind: "choice"; choices: readonly string[] } | { kind: "choice_list"; choices: readonly string[] } | { kind: "line"; max_length: number };

export const SETTING_KINDS: Record<SettingName, SettingKind> = {
    message_scroll_step_px: { kind: "number", min: 1 },
    which_key_delay_ms: { kind: "number" },
    toast_ms: { kind: "number", whole: true, min: TOAST_MIN_MS, max: TOAST_MAX_MS },
    toast_error_ms: { kind: "number", whole: true, min: TOAST_MIN_MS, max: TOAST_MAX_MS },
    which_key_border: { kind: "choice", choices: ["square", "round", "chamfer"] },
    which_key_skip: { kind: "key_list" },
    layout_fallback: { kind: "boolean" },
    mode_indicator: { kind: "choice", choices: MODE_INDICATORS },
    mode_indicator_style: { kind: "choice", choices: MODE_LABEL_STYLES },
    notify_new_mail: { kind: "boolean" },
    notice_show_subject: { kind: "boolean" },
    theme: { kind: "choice", choices: OASIS_THEME_NAMES },
    external_editor: { kind: "boolean" },
    compose_send: { kind: "boolean" },
    cmdline_prompt: { kind: "line", max_length: CMDLINE_PROMPT_MAX_LENGTH },
    statusbar_widgets: { kind: "choice_list", choices: STATUS_WIDGET_NAMES },
    hint_letters: { kind: "letters" },
    bridge: { kind: "boolean" },
    bridge_share_headers: { kind: "boolean" },
    bridge_share_bodies: { kind: "boolean" },
    bridge_share_attachments: { kind: "boolean" },
    bridge_share_folders: { kind: "boolean" },
    bridge_allow_drafts: { kind: "boolean" },
    bridge_allow_actions: { kind: "boolean" },
};

export const SETTING_NAMES = Object.keys(SETTING_KINDS) as SettingName[];

export const is_setting_name = (name: string): name is SettingName => Object.hasOwn(SETTING_KINDS, name);

function number_problem(value: unknown, spec: { min?: number; max?: number; whole?: boolean }): string | undefined {
    const min = spec.min ?? 0;
    const bounds = spec.max === undefined ? `of at least ${min}` : `from ${min} to ${spec.max}`;
    const ok = typeof value === "number" && Number.isFinite(value) && value >= min && (spec.max === undefined || value <= spec.max) && (!spec.whole || Number.isInteger(value));
    return ok ? undefined : `expected a ${spec.whole ? "whole " : ""}number ${bounds}`;
}

/** Why the value is not valid for the setting, or `undefined` when it is. */
export function setting_problem(name: SettingName, value: unknown): string | undefined {
    const spec = SETTING_KINDS[name];
    switch (spec.kind) {
        case "number":
            return number_problem(value, spec);
        case "boolean":
            return typeof value === "boolean" ? undefined : "expected true or false";
        case "list":
            return Array.isArray(value) && value.every((item) => typeof item === "string") ? undefined : "expected a list of text";
        case "key_list":
            return Array.isArray(value) && value.every((item) => typeof item === "string" && parse_sequence(item).error === undefined) ? undefined : "expected a list of key prefixes in keymap notation";
        case "letters":
            return typeof value === "string" && [...value].length >= 2 && new Set(value.toLowerCase()).size === [...value].length && !value.includes("/") ? undefined : "expected 2 or more distinct letters, without /";
        case "choice":
            return typeof value === "string" && spec.choices.includes(value) ? undefined : `expected one of ${spec.choices.join(", ")}`;
        case "choice_list":
            return Array.isArray(value) && value.every((item) => typeof item === "string" && spec.choices.includes(item)) ? undefined : `expected a list of ${spec.choices.join(", ")}`;
        case "line":
            return typeof value === "string" && value.length >= 1 && value.length <= spec.max_length ? undefined : `expected 1 to ${spec.max_length} characters`;
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
export const SETTING_DEFAULTS: Settings = { ...DEFAULT_SETTINGS, message_scroll_step_px: MESSAGE_SCROLL_STEP_PX, notify_new_mail: false, notice_show_subject: true, mode_indicator: "always", mode_indicator_style: "classic", theme: DEFAULT_THEME, external_editor: false, compose_send: false, cmdline_prompt: "caret", statusbar_widgets: ["folder", "position"], hint_letters: "asdfghjkl", bridge_share_headers: false, bridge_share_bodies: false, bridge_share_attachments: false, bridge_share_folders: false, bridge_allow_drafts: false, bridge_allow_actions: false };

export const settings_with_defaults = (overrides: Partial<Settings>): Settings => ({ ...SETTING_DEFAULTS, ...overrides });
