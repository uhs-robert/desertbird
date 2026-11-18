// The which-key panel as data: what follows the keys typed so far. Pure functions over the compiled tree and the settings.

import { token_label } from "../../../vendor/desertfox/prefix_tree.ts";
import type { TreeBranch, TreeNode } from "../../../vendor/desertfox/prefix_tree.ts";
import type { Settings } from "../../../vendor/desertfox/config.ts";
import { WHICH_KEY_ROOT_TITLE } from "../../shared/protocol.ts";
import type { WhichKeyPanel } from "../../shared/protocol.ts";

const is_branch = (node: TreeNode | undefined): node is TreeBranch => node?.kind === "branch";

/** A leaf that runs nothing, or a branch that leads only to such leaves. The message tree holds them so that a mail sequence ends there and runs nothing (see `compile_message_keymap`). They have no row, so a prefix that holds only them has no panel. */
export const runs_nothing = (node: TreeNode): boolean => (is_branch(node) ? Object.values(node.children).every(runs_nothing) : node.steps.length === 0);

const shown_children = (branch: TreeBranch): [string, TreeNode][] => Object.entries(branch.children).filter(([, child]) => !runs_nothing(child));

/** The branch the typed keys lead to, or null when they lead to a leaf or nowhere. */
export function branch_at(root: TreeBranch, keys: readonly string[]): TreeBranch | null {
    let node: TreeNode | undefined = root;
    for (const key of keys) node = is_branch(node) ? node.children[key] : undefined;
    return is_branch(node) ? node : null;
}

/** The chain of groups the typed keys went through, each as `+Name` or, for a group without a name, `+` and its key. */
function title_chain(root: TreeBranch, keys: readonly string[]): string[] {
    if (keys.length === 0) return [WHICH_KEY_ROOT_TITLE];
    return keys.map((key, index) => `+${branch_at(root, keys.slice(0, index + 1))?.label ?? token_label(key)}`);
}

function group_label(branch: TreeBranch): string {
    const count = shown_children(branch).length;
    return branch.label ?? `${count} ${count === 1 ? "key" : "keys"}`;
}

// The root list reads in the order of DesertFox: letters (case-blind, so `t` before `T`), other plain keys, keys with a modifier, then groups. Each class goes by key.
const root_rank = (row: { key: string; is_group: boolean }): number => (row.is_group ? 3 : /^<[SACM]+-/.test(row.key) ? 2 : /^[a-zA-Z]$/.test(row.key) ? 0 : 1);
const by_code_point = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
function compare_root_rows(left: { key: string; is_group: boolean }, right: { key: string; is_group: boolean }): number {
    const rank = root_rank(left);
    if (rank !== root_rank(right)) return rank - root_rank(right);
    if (rank === 1 || rank === 2) return by_code_point(left.key, right.key);
    return by_code_point(left.key.toLowerCase(), right.key.toLowerCase()) || by_code_point(right.key, left.key);
}

/** The panel for a half-typed sequence, or null when no key can follow it. The title is the chain of group names. */
export function which_key_panel(root: TreeBranch, keys: readonly string[], settings: Pick<Settings, "which_key_border">): WhichKeyPanel | null {
    const branch = branch_at(root, keys);
    if (branch === null) return null;
    const rows = shown_children(branch).map(([token, child]) =>
        is_branch(child) ? { key: token_label(token), label: group_label(child), is_group: true } : { key: token_label(token), label: child.label ?? child.steps[0]?.invocation.id ?? "", is_group: false },
    );
    if (rows.length === 0) return null;
    if (keys.length === 0) rows.sort(compare_root_rows);
    return { title: title_chain(root, keys), rows, border: settings.which_key_border };
}

/** Whether the panel may open on its own after the delay. A sequence in `which_key_skip` waits for a key that leads on, and a panel already up redraws at once. */
export const may_open_by_itself = (settings: Pick<Settings, "which_key_delay_ms" | "which_key_skip">, keys: readonly string[], panel_is_up: boolean): boolean =>
    settings.which_key_delay_ms > 0 && (panel_is_up || !settings.which_key_skip.includes(keys.join("")));
