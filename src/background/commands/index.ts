// The command table of the background and the chrome runtime. Keys, help and the router read these definitions and define no behavior. A new group is one file plus one line in `GROUPS`.

import { create_registry } from "../../../vendor/desertfox/registry/define.ts";
import type { KeymapConfig } from "../../../vendor/desertfox/keymap.ts";
import { compile_keymap } from "../../../vendor/desertfox/keys/compiler.ts";
import type { CompileResult } from "../../../vendor/desertfox/keys/compiler.ts";
import type { CommandDefinition, CommandGroup } from "./define.ts";
import { clipboard } from "./clipboard.ts";
import { compose } from "./compose.ts";
import { messages } from "./messages.ts";
import { motion } from "./motion.ts";
import { view } from "./view.ts";
import { tabs } from "./tabs.ts";

export type { ScopedContext } from "./define.ts";

export const GROUPS: Record<string, CommandGroup> = { motion, messages, compose, view, clipboard, tabs };

export const registry = create_registry();

const define = (id: string, input: CommandDefinition) => registry.define(id, input);

for (const group of Object.values(GROUPS)) for (const [id, input] of Object.entries(group.commands)) define(id, input);

export const DEFAULT_KEYMAP: KeymapConfig = { normal: Object.assign({}, ...Object.values(GROUPS).map((group) => group.normal_keys)) };

export function compile_default_keymap(): CompileResult {
    return compile_keymap(DEFAULT_KEYMAP, {}, (command_id) => {
        const command = registry.get(command_id);
        return command && { runs_in: command.runs_in, label: command.label, count: command.count ?? "ignore", ...(command.params && { params: command.params }) };
    });
}
