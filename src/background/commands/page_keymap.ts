// The keys of a page tab, compiled for the chrome page bundle. The tree is the page keys with the user's bindings of page commands on top, in the way `message_keymap` does for a message.

import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import type { CompileResult } from "../../../vendor/desertfox/keys/compiler.ts";
import { GROUP_NAMES, compile_bindings } from "./index.ts";
import { PAGE_KEYS } from "./page.ts";

const same_use = (binding: { id: string; args?: object }) => JSON.stringify([binding.id, Object.entries(binding.args ?? {}).sort(([left], [right]) => (left < right ? -1 : 1))]);

// A user key stays in a page only with a command and arguments that a default page key has, wherever the user puts it. That keeps `tab.close_mail` out for the reason its default keys are out, and keeps out every command that needs the thread list, `cmdline.open` with typed text among them. `app.open_page` is the one command whose argument is free: it names the page to open.
const DEFAULT_USES: ReadonlySet<string> = new Set(Object.values(PAGE_KEYS).flatMap((binding) => (binding && !Array.isArray(binding) ? [same_use(binding)] : [])));

/** The page keys with the user's page bindings on top. A `null` goes through, and the compiler removes the key it names, however spelled. */
export function page_keymap(user: KeymapConfig["normal"] = {}): KeymapConfig {
    const kept = Object.entries(user ?? {}).filter(([, binding]) => binding === null || (!Array.isArray(binding) && (DEFAULT_USES.has(same_use(binding)) || (binding.id === "app.open_page" && !!binding.args))));
    return { normal: { ...PAGE_KEYS, ...Object.fromEntries(kept) }, group_names: GROUP_NAMES };
}

/** The page keys are the default layer, so a user key that extends a page key (`ggz` over `gg`) drops that key as it does in the mail tab. */
export function compile_page_keymap(user: KeymapConfig["normal"] = {}): CompileResult {
    return compile_bindings(page_keymap(user), {}, { normal: PAGE_KEYS, group_names: GROUP_NAMES });
}
