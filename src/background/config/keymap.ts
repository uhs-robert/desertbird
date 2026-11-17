// The keymap the user runs: the default bindings with the user's bindings on top.

import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { Settings } from "../../../vendor/desertfox/config.ts";
import { compile_keymap } from "../../../vendor/desertfox/keys/compiler.ts";
import type { CompileResult } from "../../../vendor/desertfox/keys/compiler.ts";
import { DEFAULT_KEYMAP, resolve_command } from "../commands/index.ts";

/** What the user stores: normal-mode bindings only. A `null` binding removes a default key. */
export type UserKeymap = Pick<KeymapConfig, "normal">;

/** Defaults first, so a user entry for the same keys takes the default's place. With no user bindings the result equals `DEFAULT_KEYMAP`. */
export function effective_keymap(user: UserKeymap): KeymapConfig {
    return { ...DEFAULT_KEYMAP, normal: { ...DEFAULT_KEYMAP.normal, ...user.normal } };
}

export function compile_effective_keymap(user: UserKeymap, settings: Partial<Settings> = {}): CompileResult {
    return compile_keymap(effective_keymap(user), settings, resolve_command, undefined, DEFAULT_KEYMAP);
}

/** Keeps the `normal` bindings that are objects or `null`. Stored data is untrusted. */
export function sanitize_user_keymap(raw: unknown): UserKeymap {
    const normal = (raw as { normal?: unknown } | null | undefined)?.normal;
    if (typeof normal !== "object" || normal === null || Array.isArray(normal)) return {};
    const kept = Object.entries(normal).filter(([, binding]) => binding === null || (typeof binding === "object" && !Array.isArray(binding) && typeof (binding as { id?: unknown }).id === "string"));
    return { normal: Object.fromEntries(kept) };
}
