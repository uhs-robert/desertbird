// The keymap the user runs: the default bindings with the user's bindings on top.

import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { Settings } from "./settings.ts";
import { compile_keymap } from "../../../vendor/desertfox/keys/compiler.ts";
import type { CompileResult } from "../../../vendor/desertfox/keys/compiler.ts";
import { DEFAULT_KEYMAP, KEEPS_SELECTION_IDS, UNREPEATABLE_IDS, resolve_command } from "../commands/index.ts";

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

/** Tags each step of a command with `repeatable: false` (so the chrome runtime never replays it) or `keeps_selection: true` (so visual mode stays on after it) in the compiled tree. The compiler has no field for either, and the runtime knows no command ids beyond its motions. */
export function mark_steps(node: object): void {
    const { steps, otherwise, children } = node as { steps?: Array<{ invocation: { id: string } }>; otherwise?: object; children?: Record<string, object> };
    for (const step of steps ?? []) {
        if (UNREPEATABLE_IDS.has(step.invocation.id)) Object.assign(step, { repeatable: false });
        if (KEEPS_SELECTION_IDS.has(step.invocation.id)) Object.assign(step, { keeps_selection: true });
    }
    if (otherwise) mark_steps(otherwise);
    for (const child of Object.values(children ?? {})) mark_steps(child);
}
