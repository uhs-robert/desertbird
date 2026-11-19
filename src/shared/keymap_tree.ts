// Turns the keymap tree as data into the input of the vendored key matcher. The chrome runtime and the body script both walk a tree the background compiled, so they share this.

import { COMPILED_KEYMAP_VERSION } from "../../vendor/desertfox/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch } from "../../vendor/desertfox/prefix_tree.ts";
import type { MatchResult } from "../../vendor/desertfox/keys/matcher.ts";
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

// The vendored matcher cannot step back, so Backspace on a half-typed sequence resets it and types the kept keys again, as DesertFox does in its key flow. It lives here, not in the vendored matcher, so the vendor copy stays a pin and both key runtimes share one copy. The answer is the pending result of the shorter prefix (an empty one when nothing is kept), so a caller cancels the key and reports the prefix with no code of its own.
export function matcher_for_tree(tree: { version: number; root: unknown }) {
    const inner = create_matcher(keymap_of(read_root(tree)));
    let last: MatchResult | undefined;
    const feed = (mode: string, token: string): MatchResult => {
        if (last?.kind_ !== "pending" || token !== "<Backspace>") return (last = inner.feed(mode, token));
        const kept = last.keys.slice(0, -1);
        inner.reset();
        last = undefined;
        for (const key of kept) last = inner.feed(mode, key);
        // Nothing kept: the answer is not remembered, so the next Backspace is an ordinary key.
        return last ?? ({ kind_: "pending", typed_: [], keys: [] } as unknown as MatchResult);
    };
    return { feed, reset: () => ((last = undefined), inner.reset()) };
}

/** A plain printable key is one character. Named keys (Enter, Escape, arrows, Tab, Space) have a token in angle brackets, so they pass through. */
export const is_plain_printable = (token: string): boolean => [...token].length === 1;
