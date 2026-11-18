// Gives each leaf that waits for a key press a branch of its own. The vendored compiler leaves such a leaf where it is bound, so the matcher would run it with no key.

import type { TreeBranch } from "../../../vendor/desertfox/prefix_tree.ts";
import { capture_branch } from "../../../vendor/desertfox/prefix_tree.ts";
import { captured_key_param } from "../../../vendor/desertfox/registry/params.ts";
import type { CommandDef } from "../../../vendor/desertfox/command.ts";

/** Marks the step with `capture` (the name of the `key` param the press fills) and moves the leaf under the branch of `capture_branch`. The branch carries the leaf label, so `M` lists as a group and `M <key>` as its one row. Edits `branch` in place. */
export function with_captures(branch: TreeBranch, get_command: (id: string) => Pick<CommandDef, "params"> | undefined): void {
    for (const [token, node] of Object.entries(branch.children)) {
        if (node.kind === "branch") {
            with_captures(node, get_command);
            continue;
        }
        let waits = false;
        for (const step of node.steps) {
            const command = get_command(step.invocation.id);
            const param = command && captured_key_param(command, step.invocation.args);
            if (param === undefined) continue;
            step.capture = param.name;
            waits = true;
        }
        if (waits) branch.children[token] = capture_branch(node);
    }
}
