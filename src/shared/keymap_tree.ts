// Turns the keymap tree as data into the input of the vendored key matcher. The chrome runtime and the body script both walk a tree the background compiled, so they share this.

import { COMPILED_KEYMAP_VERSION } from "../../vendor/desertfox/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch } from "../../vendor/desertfox/prefix_tree.ts";
import { create_matcher } from "../../vendor/desertfox/keys/matcher.ts";

/** The one mode both sides match in. */
export const NORMAL_MODE = "normal";

export function read_root(tree: { version: number; root: unknown }): TreeBranch {
    if (tree.version !== COMPILED_KEYMAP_VERSION) throw new Error(`keymap version ${String(tree.version)} is not ${COMPILED_KEYMAP_VERSION}`);
    const root = tree.root as Partial<TreeBranch> | null;
    if (typeof root !== "object" || root === null || root.kind !== "branch" || typeof root.children !== "object" || root.children === null) {
        throw new Error("keymap root is not a branch");
    }
    return root as TreeBranch;
}

// The matcher reads only `modes`, so the rest of a compiled keymap is never built here.
const keymap_of = (root: TreeBranch): CompiledKeymap => ({ format_version: COMPILED_KEYMAP_VERSION, modes: { [NORMAL_MODE]: root } }) as CompiledKeymap;

export const matcher_for_tree = (tree: { version: number; root: unknown }) => create_matcher(keymap_of(read_root(tree)));

/** A plain printable key is one character. Named keys (Enter, Escape, arrows, Tab, Space) have a token in angle brackets, so they pass through. */
export const is_plain_printable = (token: string): boolean => [...token].length === 1;
