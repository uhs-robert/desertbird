import type { KeymapConfig } from "../../vendor/desertfox/keymap.ts";
import { compile_keymap } from "../../vendor/desertfox/keys/compiler.ts";
import type { CompileResult } from "../../vendor/desertfox/keys/compiler.ts";
import { registry } from "./registry.ts";

export const DEFAULT_KEYMAP: KeymapConfig = {
    normal: {
        j: { id: "motion.down" },
        k: { id: "motion.up" },
        gg: { id: "motion.top" },
        G: { id: "motion.bottom" },
        x: { id: "msg.archive" },
        dd: { id: "msg.delete" },
        r: { id: "msg.reply", args: { to: "sender" } },
    },
};

export function compile_default_keymap(): CompileResult {
    return compile_keymap(DEFAULT_KEYMAP, {}, (command_id) => {
        const command = registry.get(command_id);
        return command && { runs_in: command.runs_in, label: command.label, count: command.count ?? "ignore", ...(command.params && { params: command.params }) };
    });
}
