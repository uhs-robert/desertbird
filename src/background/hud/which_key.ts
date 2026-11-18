// The which-key panel as data: what follows the keys typed so far. Pure functions over the compiled tree and the settings.

import { token_label } from "../../../vendor/desertfox/prefix_tree.ts";
import type { TreeBranch, TreeNode } from "../../../vendor/desertfox/prefix_tree.ts";
import type { Settings } from "../../../vendor/desertfox/config.ts";
import type { WhichKeyPanel } from "../../shared/protocol.ts";

const is_branch = (node: TreeNode | undefined): node is TreeBranch => node?.kind === "branch";

/** The branch the typed keys lead to, or null when they lead to a leaf or nowhere. */
export function branch_at(root: TreeBranch, keys: readonly string[]): TreeBranch | null {
    let node: TreeNode | undefined = root;
    for (const key of keys) node = is_branch(node) ? node.children[key] : undefined;
    return is_branch(node) ? node : null;
}

function group_label(branch: TreeBranch): string {
    const count = Object.keys(branch.children).length;
    return branch.label ?? `${count} ${count === 1 ? "key" : "keys"}`;
}

/** The panel for a half-typed sequence, or null when no key can follow it. The title is the chain of group names, else the typed keys. */
export function which_key_panel(root: TreeBranch, keys: readonly string[], settings: Pick<Settings, "which_key_border">): WhichKeyPanel | null {
    const branch = branch_at(root, keys);
    if (branch === null) return null;
    // The root list puts the prefix groups first, so the user sees what a prefix opens before the single keys.
    const entries = Object.entries(branch.children);
    if (keys.length === 0) entries.sort(([, a], [, b]) => Number(is_branch(b)) - Number(is_branch(a)));
    const rows = entries.map(([token, child]) =>
        is_branch(child) ? { key: token_label(token), label: group_label(child), is_group: true } : { key: token_label(token), label: child.label ?? child.steps[0]?.invocation.id ?? "", is_group: false },
    );
    if (rows.length === 0) return null;
    return { title: keys.join(" "), rows, border: settings.which_key_border };
}

/** Whether the panel may open on its own after the delay. A sequence in `which_key_skip` waits for a key that leads on, and a panel already up redraws at once. */
export const may_open_by_itself = (settings: Pick<Settings, "which_key_delay_ms" | "which_key_skip">, keys: readonly string[], panel_is_up: boolean): boolean =>
    settings.which_key_delay_ms > 0 && (panel_is_up || !settings.which_key_skip.includes(keys.join("")));
