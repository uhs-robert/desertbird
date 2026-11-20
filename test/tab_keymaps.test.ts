import assert from "node:assert/strict";
import { test } from "node:test";
import type { TreeBranch, TreeNode } from "../vendor/desertfox/prefix_tree.ts";
import { GROUPS, registry } from "../src/background/commands/index.ts";
import { TAB_NEEDS, needing, tab_needs_of } from "../src/background/commands/define.ts";
import { compile_tab_keymap, default_keymap_of, page_message_tree } from "../src/background/commands/tab_keymaps.ts";

const root_of = (user?: Parameters<typeof compile_tab_keymap>[1]) => compile_tab_keymap("page", user).compiled.modes.normal as TreeBranch;
const own_root = (user?: Parameters<typeof compile_tab_keymap>[1]) => compile_tab_keymap("own", user).compiled.modes.normal as TreeBranch;
const message_root = (user?: Parameters<typeof compile_tab_keymap>[1]) => compile_tab_keymap("message", user).compiled.modes.normal as TreeBranch;

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
        [["j"], ["k"], ["<C-d>"], ["<C-u>"], ["g", "g"], ["G"], ["q"], ["<A-q>"], [":"], ["g", "?"], ["J"], ["K"], ["<A-j>"], ["<A-k>"], ["t", "n"], ["t", "p"], ["t", "0"], ["t", "T"], ["w", "m"], ["<C-j>"], ["g", "p", "a"], ["g", "p", "t"], ["g", "p", "c"]].map((tokens) => leaf_at(root, ...tokens)?.id),
        ["page.scroll_down", "page.scroll_up", "page.half_down", "page.half_up", "page.top", "page.bottom", "tab.close", "tab.close", "cmdline.open", "help.whichkey", "tab.next", "tab.prev", "tab.next", "tab.prev", "tab.next", "tab.prev", "tab.switch", "cmdline.open", undefined, undefined, "app.open_page", "app.open_page", "app.open_page"],
    );
    assert.deepEqual(leaf_at(root, "g", "p", "c")?.args, { page: "config" });
});

test("the page tree has one mail key (new message) and no close chord that must copy and cut", () => {
    const ids = ids_under(root_of());
    assert.ok(!ids.includes("tab.close_mail"));
    assert.deepEqual(ids.filter((id) => id.startsWith("msg.") || id.startsWith("motion.")), ["msg.new"]);
    assert.equal(leaf_at(root_of(), "<C-c>"), undefined);
    assert.equal(leaf_at(root_of(), "<C-x>"), undefined);
});

test("the page tree reads the same command table: the keys that gain a place are T, the help and options keys and c", () => {
    const root = root_of();
    assert.equal(leaf_at(root, "T")?.id, "cmdline.open");
    assert.deepEqual(leaf_at(root, "T")?.args, { text: "tab " });
    assert.equal(leaf_at(root, ",", "h")?.id, "help.open");
    assert.equal(leaf_at(root, ",", "s")?.id, "options.open");
    assert.equal(leaf_at(root, ",", "?")?.id, "help.whichkey");
    assert.equal(leaf_at(root, "c")?.id, "msg.new");
    assert.equal((root.children["g"] as TreeBranch).label, "Go");
    assert.equal((root.children[","] as TreeBranch).label, "DesertBird");
});

test("the page tree holds no command that needs a list, a message or a body, and no group left empty", () => {
    for (const id of ids_under(root_of())) assert.deepEqual(registry.get(id)?.needs?.filter((need) => (TAB_NEEDS as readonly string[]).includes(need)), ["tab"], id);
    for (const token of ["m", "d", "s", "F", "y", ";", "]", "[", "z", "o", "a", "r", "R", "f", "u", "n", "N", "/", "?", "H", "L", "M", "'", "v", "."]) assert.equal(root_of().children[token], undefined, token);
    const tabs_group = root_of().children["t"] as TreeBranch;
    assert.equal(tabs_group.label, "Tabs");
    assert.deepEqual(Object.keys(tabs_group.children).sort(), ["0", "T", "n", "p"]);
    assert.equal(root_of().children["w"], undefined);
});

test("every command names a tab need, so a new command cannot leak into a tab by forgetting one", () => {
    for (const [id, command] of Object.entries(Object.assign({}, ...Object.values(GROUPS).map((group) => group.commands))) as [string, { needs?: string[] }][]) {
        assert.ok(command.needs?.some((need) => (TAB_NEEDS as readonly string[]).includes(need)), id);
        assert.ok(registry.get(id), id);
    }
});

test("the message tree has the mail keys that need a message, the reading keys and no list key", () => {
    const root = message_root();
    assert.deepEqual(["a", "j", "/", "f", "H"].map((key) => leaf_at(root, key)?.id), ["msg.archive", "message.scroll_down", "cmdline.open", "hint.pick", "pane.focus"]);
    assert.deepEqual(leaf_at(root, "/")?.args, { text: "find " });
    for (const keys of [["m", "R"], ["F", "t"], ["F", "f"], ["s", "s"], [";", ";"], ["<C-x>"], ["<C-c>"], ["o"], ["s", "d"], ["]", "u"], ["z", "z"], ["."], ["?"], ["v"], ["h"], ["l"]]) assert.equal(leaf_at(root, ...keys)?.id, undefined, keys.join(" "));
});

test("the own page tree is the page tree plus find and hints, with the reading keys of the body script", () => {
    const root = own_root();
    assert.deepEqual(["j", "k", "<C-d>", "gg"].map((key) => (key === "gg" ? leaf_at(root, "g", "g") : leaf_at(root, key))?.id), ["message.scroll_down", "message.scroll_up", "message.half_page_down", "message.top"]);
    assert.deepEqual(["/", "n", "N", "f"].map((key) => leaf_at(root, key)?.id), ["cmdline.open", "message.find_next", "message.find_prev", "hint.pick"]);
    assert.deepEqual([[";", "f"], [";", "c"], [";", "y"]].map((keys) => leaf_at(root, ...keys)?.id), ["hint.pick", "hint.pick", "hint.pick"]);
    for (const keys of [["T"], ["q"], [":"], ["c"], [",", "h"], ["g", "p", "a"]]) assert.ok(leaf_at(root, ...keys), keys.join(" "));
    for (const keys of [["a"], ["d", "d"], ["r"], ["m", "t"], ["u"], ["g", "C"], ["g", "f"], ["H"], ["<A-l>"], ["y", "y"]]) assert.equal(leaf_at(root, ...keys)?.id, undefined, keys.join(" "));
});

test("a user binding of a page command moves the key, and a null removes one", () => {
    const root = root_of({ z: { id: "page.scroll_down" }, x: { id: "tab.close" }, j: null });
    assert.equal(leaf_at(root, "z")?.id, "page.scroll_down");
    assert.equal(leaf_at(root, "x")?.id, "tab.close");
    assert.equal(leaf_at(root, "j"), undefined);
    assert.equal(leaf_at(root, "k")?.id, "page.scroll_up");
});

test("a user binding reaches every tab its command can run in, and no other", () => {
    const user = { x: { id: "tab.next" }, w: { id: "cmdline.open", args: { text: "tag " } }, v: { id: "motion.down" }, y: { id: "tab.close_mail" }, ";": null };
    assert.equal(leaf_at(root_of(user), "x")?.id, "tab.next");
    assert.equal(leaf_at(own_root(user), "x")?.id, "tab.next");
    assert.equal(leaf_at(message_root(user), "x")?.id, "tab.next");
    for (const key of ["w", "v", "y"]) assert.equal(leaf_at(root_of(user), key), undefined, key);
    for (const key of ["w", "v", "y"]) assert.equal(leaf_at(own_root(user), key), undefined, key);
    assert.equal(leaf_at(message_root(user), "w")?.id, "cmdline.open");
    assert.equal(leaf_at(message_root(user), "v"), undefined);
    assert.equal(leaf_at(message_root(user), "y"), undefined);
});

test("a user binding of a command that needs a message reaches a message document and no page tab", () => {
    const user = { x: { id: "msg.archive" } };
    assert.equal(leaf_at(message_root(user), "x")?.id, "msg.archive");
    assert.equal(leaf_at(root_of(user), "x"), undefined);
    assert.equal(leaf_at(own_root(user), "x"), undefined);
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

test("the message tree for a message tab keeps the message keys and drops the key that opens the find line", () => {
    const full = { version: 1, root: JSON.parse(JSON.stringify(compile_tab_keymap("message").compiled.modes.normal)) };
    const kept = page_message_tree(full as never).root as unknown as TreeBranch;
    assert.equal(leaf_at(full.root as TreeBranch, "/")?.id, "cmdline.open");
    assert.equal(leaf_at(kept, "/"), undefined);
    assert.equal(leaf_at(kept, "j")?.id, "message.scroll_down");
    assert.equal(leaf_at(kept, "d", "d")?.id, "msg.delete");
    assert.deepEqual(leaf_at(full.root as TreeBranch, "j"), leaf_at(kept, "j"));
});

test("a group need joins the capability needs of a command and does not replace them", () => {
    const grouped = needing("message", { a: { bridge: false, runs_in: "background", label: "A", intent: "A.", needs: ["hints.pick"], run: async () => {} }, b: { bridge: false, runs_in: "background", label: "B", intent: "B.", needs: ["tab", "app.paneFocus"], run: async () => {} } });
    assert.deepEqual(grouped["a"]?.needs, ["message", "hints.pick"]);
    assert.deepEqual(grouped["b"]?.needs, ["tab", "app.paneFocus"], "a command with a tab need of its own keeps its needs as written");
    assert.ok(registry.get("hint.window")?.needs?.includes("hints.pick"));
    assert.ok(registry.get("folder.collapse")?.needs?.includes("app.paneFocus"));
    assert.deepEqual(tab_needs_of(registry.get("folder.collapse")!), ["list"], "a capability need is no tab need");
    assert.ok(registry.get("msg.reply")?.needs?.includes("message"));
});
