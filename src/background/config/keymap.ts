// The keymap the user runs: the default bindings with the user's bindings on top.

import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { Settings } from "./settings.ts";
import type { CompileResult } from "../../../vendor/desertfox/keys/compiler.ts";
import { DEFAULT_KEYMAP, KEEPS_SELECTION_IDS, UNREPEATABLE_IDS, compile_bindings } from "../commands/index.ts";

/** What the user stores: normal-mode bindings, and the menu keys in a section of their own. A `null` binding removes a default key. The two sections never mix: `menu` unbinds only a menu key, and `normal` never holds a `menu.*` command. */
export type UserKeymap = Pick<KeymapConfig, "normal"> & { menu?: KeymapConfig["normal"] };

/** Defaults first, so a user entry for the same keys takes the default's place. With no user bindings the result equals `DEFAULT_KEYMAP`. */
export function effective_keymap(user: UserKeymap): KeymapConfig {
    return { ...DEFAULT_KEYMAP, normal: { ...DEFAULT_KEYMAP.normal, ...user.normal } };
}

export function compile_effective_keymap(user: UserKeymap, settings: Partial<Settings> = {}): CompileResult {
    return compile_bindings(effective_keymap(user), settings, DEFAULT_KEYMAP);
}

const MENU_COMMAND = /^menu\./;

/** Keeps the bindings that are objects or `null`. Stored data is untrusted. The `normal` section drops a `menu.*` command, which only the `menu` section may hold, so a stored key never replaces a mail-tab key. */
function kept_bindings(raw: unknown, menu: boolean): KeymapConfig["normal"] | undefined {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const kept = Object.entries(raw).filter(([, binding]) => binding === null || (typeof binding === "object" && !Array.isArray(binding) && typeof (binding as { id?: unknown }).id === "string" && MENU_COMMAND.test((binding as { id: string }).id) === menu));
    return Object.fromEntries(kept);
}

export function sanitize_user_keymap(raw: unknown): UserKeymap {
    const stored = raw as { normal?: unknown; menu?: unknown } | null | undefined;
    const normal = kept_bindings(stored?.normal, false);
    const menu = kept_bindings(stored?.menu, true);
    return { ...(normal && { normal }), ...(menu && { menu }) };
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
