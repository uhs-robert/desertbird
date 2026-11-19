import assert from "node:assert/strict";
import { test } from "node:test";
import type { TreeBranch, TreeNode } from "../vendor/desertfox/prefix_tree.ts";
import { compile_page_keymap, page_keymap } from "../src/background/commands/page_keymap.ts";
import { PAGE_KEYS } from "../src/background/commands/page.ts";

const root_of = (user?: Parameters<typeof compile_page_keymap>[0]) => compile_page_keymap(user).compiled.modes.normal as TreeBranch;

function ids_under(node: TreeNode | undefined): string[] {
    if (node === undefined) return [];
    if (node.kind === "leaf") return node.steps.map((step) => step.invocation.id);
    return Object.values(node.children).flatMap(ids_under);
}

function leaf_at(root: TreeBranch, ...tokens: string[]): { id: string; args?: unknown } | undefined {
    let node: TreeNode | undefined = root;
    for (const token of tokens) node = node?.kind === "branch" ? node.children[token] : undefined;
    return node?.kind === "leaf" ? (node.steps[0]?.invocation as { id: string; args?: unknown }) : undefined;
}

test("the default page tree holds the reading keys, the tab keys, the command line, the key list and the page chords", () => {
    const root = root_of();
    assert.deepEqual(
        [["j"], ["k"], ["<C-d>"], ["<C-u>"], ["g", "g"], ["G"], ["q"], ["<A-q>"], [":"], ["g", "?"], ["<C-j>"], ["<C-k>"], ["g", "p", "a"], ["g", "p", "t"], ["g", "p", "c"]].map((tokens) => leaf_at(root, ...tokens)?.id),
        ["page.scroll_down", "page.scroll_up", "page.half_down", "page.half_up", "page.top", "page.bottom", "tab.close", "tab.close", "cmdline.open", "help.whichkey", "tab.next", "tab.prev", "app.open_page", "app.open_page", "app.open_page"],
    );
    assert.deepEqual(leaf_at(root, "g", "p", "c")?.args, { page: "config" });
});

test("the page tree has no mail key and no close chord that must copy and cut", () => {
    const ids = ids_under(root_of());
    assert.ok(!ids.includes("tab.close_mail"));
    assert.ok(!ids.some((id) => id.startsWith("msg.") || id.startsWith("motion.")));
    assert.equal(leaf_at(root_of(), "<C-c>"), undefined);
    assert.equal(leaf_at(root_of(), "<C-x>"), undefined);
});

test("the page keys are the ones of PAGE_KEYS, and the which-key names are carried", () => {
    assert.deepEqual(Object.keys(page_keymap().normal ?? {}).sort(), Object.keys(PAGE_KEYS).sort());
    assert.equal((root_of().children["g"] as TreeBranch).label, "Go");
});

test("a user binding of a page command moves the key, and a null removes one", () => {
    const root = root_of({ z: { id: "page.scroll_down" }, x: { id: "tab.close" }, j: null });
    assert.equal(leaf_at(root, "z")?.id, "page.scroll_down");
    assert.equal(leaf_at(root, "x")?.id, "tab.close");
    assert.equal(leaf_at(root, "j"), undefined);
    assert.equal(leaf_at(root, "k")?.id, "page.scroll_up");
});

test("a user binding of a mail command, of tab.close_mail, or of the line with typed text stays out", () => {
    const root = root_of({ x: { id: "msg.archive" }, y: { id: "tab.close_mail" }, w: { id: "cmdline.open", args: { text: "tag " } }, v: { id: "motion.down" } });
    for (const key of ["x", "y", "w", "v"]) assert.equal(leaf_at(root, key), undefined, key);
});

test("a user binding of app.open_page keeps its page argument", () => {
    const root = root_of({ P: { id: "app.open_page", args: { page: "themes" } } });
    assert.deepEqual(leaf_at(root, "P")?.args, { page: "themes" });
});

test("a user key that extends a default page key drops that key", () => {
    const root = root_of({ ggz: { id: "page.top" } });
    assert.equal(leaf_at(root, "g", "g"), undefined);
    assert.equal(leaf_at(root, "g", "g", "z")?.id, "page.top");
});
