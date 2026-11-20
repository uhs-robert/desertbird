// The which-key panel as data: what follows the keys typed so far. Pure functions over the compiled tree and the settings.

import { ANY_KEY, token_label } from "../../../vendor/desertfox/prefix_tree.ts";
import type { TreeBranch, TreeNode } from "../../../vendor/desertfox/prefix_tree.ts";
import type { Settings } from "../../../vendor/desertfox/config.ts";
import { WHICH_KEY_ROOT_TITLE } from "../../shared/protocol.ts";
import { warn_and_go } from "../../shared/swallow.ts";
import type { WhichKeyPanel } from "../../shared/protocol.ts";

const is_branch = (node: TreeNode | undefined): node is TreeBranch => node?.kind === "branch";

/** A leaf that runs nothing, or a branch that leads only to such leaves. The message tree holds them so that a mail sequence ends there and runs nothing (see `complete_mail_sequences` in `commands/tab_keymaps.ts`). They have no row, so a prefix that holds only them has no panel. */
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

// Ported from `compare_rows` in DesertFox `src/background/list_keys.ts`, which is not vendored because its file reads the DesertFox command table.
// Every panel reads in that order: letters (case-blind, so `t` before `T`), other plain keys, keys with a modifier, groups by name, Escape last.
type SortRow = { key: string; label: string; is_group: boolean };
function display_rank(row: SortRow): number {
    if (row.key === "<Escape>") return 4;
    if (row.is_group) return 3;
    if (/^<[SACM]+-/.test(row.key)) return 2;
    return /^[a-zA-Z]$/.test(row.key) ? 0 : 1;
}
const by_code_point = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
function compare_rows(left: SortRow, right: SortRow): number {
    const by_class = display_rank(left) - display_rank(right);
    if (by_class !== 0) return by_class;
    if (left.is_group) return by_code_point(left.label.toLowerCase(), right.label.toLowerCase());
    if (display_rank(left) !== 0) return by_code_point(left.key, right.key);
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
    rows.sort(compare_rows);
    return { title: title_chain(root, keys), rows, border: settings.which_key_border };
}

/** Whether the panel may open on its own after the delay. A sequence in `which_key_skip` waits for a key that leads on, and a panel already up redraws at once. */
export const may_open_by_itself = (settings: Pick<Settings, "which_key_delay_ms" | "which_key_skip">, keys: readonly string[], panel_is_up: boolean): boolean =>
    settings.which_key_delay_ms > 0 && (panel_is_up || !settings.which_key_skip.includes(keys.join("")));

/** Under `M` and `'` the panel lists the stored marks, slot key and folder path, in place of the capture row `<key>`. The reader runs only when the prefix holds a mark capture. A key bound by hand under the prefix (`Ma`) keeps its own row, and the marks fill the other keys. With no mark stored the capture row stays. DesertFox `with_page_marks` needs the capture to be the only child, splits page marks from global ones and hides the previous-position slot. Here a hand-bound key does not hide the marks, and folder marks are one global set with no such slot. */
export async function with_stored_marks(panel: WhichKeyPanel, root: TreeBranch, keys: readonly string[], read_marks: () => Promise<Readonly<Record<string, { path: string }>>>): Promise<WhichKeyPanel> {
    const capture = branch_at(root, keys)?.children[ANY_KEY];
    if (capture === undefined || is_branch(capture) || capture.steps.length === 0 || !capture.steps.every((step) => step.invocation.id === "mark.set" || step.invocation.id === "mark.jump")) return panel;
    const marks = await read_marks().catch(warn_and_go("hud.marks", {} as Record<string, { path: string }>));
    // A space slot is stored as the typed character, which a cell would draw blank.
    const mark_rows = Object.entries(marks).map(([slot, { path }]) => ({ key: slot === " " ? "<Space>" : slot, label: path, is_group: false }));
    if (mark_rows.length === 0) return panel;
    const bound_keys = new Set(panel.rows.map((row) => row.key));
    const rows = [...panel.rows.filter((row) => row.key !== token_label(ANY_KEY)), ...mark_rows.filter((row) => !bound_keys.has(row.key))];
    rows.sort(compare_rows);
    return { ...panel, rows };
}
