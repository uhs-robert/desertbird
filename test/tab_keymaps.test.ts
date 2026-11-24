import assert from "node:assert/strict";
import { test } from "node:test";
import type { TreeBranch, TreeNode } from "../vendor/desertfox/prefix_tree.ts";
import { GROUPS, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import { TAB_NEEDS, needing, tab_needs_of } from "../src/background/commands/define.ts";
import { compile_effective_keymap, sanitize_user_keymap } from "../src/background/config/keymap.ts";
import { TAB_KINDS, compile_tab_keymap, compile_typing_keymap, default_keymap_of, default_menu_keymap, effective_menu_keymap, menu_key_table, offered_in, page_message_tree } from "../src/background/commands/tab_keymaps.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";

const root_of = (user?: Parameters<typeof compile_tab_keymap>[1]) => compile_tab_keymap("page", user).compiled.modes.normal as TreeBranch;
const own_root = (user?: Parameters<typeof compile_tab_keymap>[1]) => compile_tab_keymap("own", user).compiled.modes.normal as TreeBranch;
const message_root = (user?: Parameters<typeof compile_tab_keymap>[1]) => compile_tab_keymap("message", user).compiled.modes.normal as TreeBranch;
const window_root = (user?: Parameters<typeof compile_tab_keymap>[1]) => compile_tab_keymap("window", user).compiled.modes.normal as TreeBranch;

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
    assert.deepEqual(["h", "l", "<C-f>", "<C-b>"].map((key) => leaf_at(root, key)?.id), ["page.scroll_left", "page.scroll_right", "page.page_down", "page.page_up"]);
});

test("the page tree has the last tab, last used tab and move keys, and tm and tM type tab.move", () => {
    const root = root_of();
    assert.deepEqual(leaf_at(root, "t", "$"), { id: "tab.goto", args: { index: -1 } });
    assert.equal(leaf_at(root, "t", "l")?.id, "tab.alternate");
    assert.deepEqual(leaf_at(root, "t", "m")?.args, { text: "tab.move " });
    assert.deepEqual(leaf_at(root, "t", "M")?.args, { text: "tab.move --offset=" });
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
    for (const id of ids_under(root_of())) assert.ok(["tab", "line", "page", "typing", "close", "main"].includes(registry.get(id)?.needs?.find((need) => (TAB_NEEDS as readonly string[]).includes(need)) ?? ""), id);
    for (const token of ["m", "d", "s", "F", "y", "]", "[", "o", "a", "r", "R", "u", "n", "N", "/", "?", "H", "L", "M", "'", "v", "."]) assert.equal(root_of().children[token], undefined, token);
    const tabs_group = root_of().children["t"] as TreeBranch;
    assert.equal(tabs_group.label, "Tabs");
    assert.deepEqual(Object.keys(tabs_group.children).sort(), ["$", "0", "M", "T", "l", "m", "n", "p"]);
    assert.equal(root_of().children["w"], undefined);
    const zoom_group = root_of().children["z"] as TreeBranch;
    assert.equal(zoom_group.label, "Zoom and scroll");
    assert.deepEqual(Object.keys(zoom_group.children).sort(), ["+", "-", "=", "I", "O", "i", "m", "o", "r"]);
});

test("the page tree labels the tab with the window hint command, and its actions and command line come with it. A message document and an own page keep their own hints", () => {
    const root = root_of();
    assert.deepEqual([["f"], [";", "f"], [";", "c"], [";", "y"]].map((keys) => [leaf_at(root, ...keys)?.id, leaf_at(root, ...keys)?.args]), [["hint.window", undefined], ["hint.window", { action: "focus" }], ["hint.window", { action: "activate" }], ["hint.window", { action: "yank" }]]);
    assert.deepEqual(leaf_at(root, ";", ";")?.args, { text: "hint " });
    for (const other of [own_root(), message_root()]) assert.ok(!ids_under(other).includes("hint.window"));
});

test("every command names a tab need, so a new command cannot leak into a tab by forgetting one", () => {
    for (const [id, command] of Object.entries(Object.assign({}, ...Object.values(GROUPS).map((group) => group.commands))) as [string, { needs?: string[] }][]) {
        assert.ok(command.needs?.some((need) => (TAB_NEEDS as readonly string[]).includes(need)), id);
        assert.ok(registry.get(id), id);
    }
});

test("the message tree has the mail keys that need a message, the reading keys and no list key", () => {
    const root = message_root();
    assert.deepEqual(["a", "j", "/", "f", "H"].map((key) => leaf_at(root, key)?.id), ["msg.archive", "message.scroll_down", "cmdline.open", "hint.pick", "pane.left"]);
    assert.deepEqual(leaf_at(root, "/")?.args, { text: "find " });
    for (const keys of [["m", "R"], ["F", "t"], ["F", "f"], ["s", "s"], [";", ";"], ["<C-x>"], ["<C-c>"], ["o"], ["s", "d"], ["]", "u"], ["z", "z"], ["."], ["?"], ["v"]]) assert.equal(leaf_at(root, ...keys)?.id, undefined, keys.join(" "));
    // `h` and `l` fold a thread in the mail tab and scroll sideways here, where no list exists.
    assert.deepEqual(["h", "l", "<C-f>", "<C-b>"].map((key) => leaf_at(root, key)?.id), ["message.scroll_left", "message.scroll_right", "message.page_down", "message.page_up"]);
});

test("H, L, A-h, A-l, w h and w l step the pane relatively in the mail and message trees, beside the fixed g f, g e, g m jumps", () => {
    for (const root of [compile_default_keymap().compiled.modes.normal as TreeBranch, message_root()]) {
        assert.deepEqual([["w", "h"], ["w", "l"], ["<A-h>"], ["<A-l>"], ["H"], ["L"]].map((keys) => leaf_at(root, ...keys)?.id), ["pane.left", "pane.right", "pane.left", "pane.right", "pane.left", "pane.right"]);
    }
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

test("the message tree for a message tab sends every hint pick to the background as hint.window with the key's action, a user key's too", () => {
    const tree_with = (user?: Parameters<typeof compile_tab_keymap>[1]) => page_message_tree({ version: 1, root: JSON.parse(JSON.stringify(message_root(user))) } as never).root as unknown as TreeBranch;
    const step_at = (root: TreeBranch, ...tokens: string[]) => {
        let node: TreeNode | undefined = root;
        for (const token of tokens) node = node?.kind === "branch" ? node.children[token] : undefined;
        return node?.kind === "leaf" ? node.steps : undefined;
    };
    const kept = tree_with({ F: { id: "hint.pick", args: { action: "yank" } } });
    assert.deepEqual([["f"], [";", "f"], [";", "c"], [";", "y"], ["F"]].map((tokens) => step_at(kept, ...tokens)?.map((step) => [step.invocation.id, step.invocation.args, step.runs_in])), [
        [["hint.window", undefined, "background"]],
        [["hint.window", { action: "focus" }, "background"]],
        [["hint.window", { action: "activate" }, "background"]],
        [["hint.window", { action: "yank" }, "background"]],
        [["hint.window", { action: "yank" }, "background"]],
    ]);
    assert.ok(!ids_under(kept).includes("hint.pick"), "no pick is left for the chrome, where it does nothing");
    assert.equal(leaf_at(message_root(), "f")?.id, "hint.pick", "the body keeps its own pick");
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

const typing_root = (user?: Parameters<typeof compile_typing_keymap>[0]) => compile_typing_keymap(user).compiled.modes.normal as TreeBranch;

test("the typing tree holds Escape, its Ctrl+[ alias and the Alt tab keys, and no plain key", () => {
    const root = typing_root();
    assert.deepEqual(Object.keys(root.children).sort(), ["<A-j>", "<A-k>", "<C-[>", "<Escape>"]);
    assert.deepEqual(["<Escape>", "<C-[>", "<A-j>", "<A-k>"].map((key) => leaf_at(root, key)?.id), ["mode.escape", "mode.escape", "tab.next", "tab.prev"]);
});

test("a user key joins the typing tree only as one key for a command the layer names, and a null unbinds", () => {
    const root = typing_root({ "<A-l>": { id: "tab.next" }, "<C-q>": { id: "tab.close" }, "<C-g><C-g>": { id: "mode.escape" }, "<A-k>": null });
    assert.equal(leaf_at(root, "<A-l>")?.id, "tab.next");
    assert.equal(leaf_at(root, "<C-q>"), undefined);
    assert.equal(root.children["<C-g>"], undefined);
    assert.equal(root.children["<A-k>"], undefined);
    assert.equal(leaf_at(root, "<Escape>")?.id, "mode.escape");
});

test("the menu key table holds j and k by default, and j and k still move the list in the mail tab", () => {
    assert.deepEqual(menu_key_table(), { j: "down", k: "up" });
    assert.deepEqual(Object.keys(default_menu_keymap().normal ?? {}), ["j", "k"]);
    assert.equal(leaf_at(compile_default_keymap().compiled.modes.normal as TreeBranch, "j")?.id, "motion.down");
});

test("a user menu key joins the table only as one typed character for a menu command", () => {
    const table = menu_key_table({ n: { id: "menu.down" }, "<C-n>": { id: "menu.down" }, "g n": { id: "menu.up" }, x: { id: "msg.archive" }, p: { id: "menu.up" }, "\u{1F600}": { id: "menu.down" } });
    assert.deepEqual(table, { j: "down", k: "up", n: "down", p: "up" });
});

test("a null in the menu section unbinds the menu key alone, and the list key keeps its motion", () => {
    assert.deepEqual(menu_key_table({ j: null }), { k: "up" });
    assert.deepEqual(menu_key_table({ j: { id: "menu.up" } }), { j: "up", k: "up" });
    assert.equal(leaf_at(compile_effective_keymap({ normal: {}, menu: { j: null } }).compiled.modes.normal as TreeBranch, "j")?.id, "motion.down");
});

test("the effective menu keymap lists the user's keys for help", () => {
    assert.deepEqual(Object.keys(effective_menu_keymap({ n: { id: "menu.down" } }).normal ?? {}), ["j", "k", "n"]);
});

test("a user key for a menu command never replaces a mail-tab key, and no tab tree takes it", () => {
    // The stored `normal` section drops a menu command, so the default n (next unread) stays.
    const user = sanitize_user_keymap({ normal: { n: { id: "menu.down" } }, menu: { n: { id: "menu.down" } } });
    assert.deepEqual(user.normal, {});
    const mail = compile_effective_keymap(user).compiled.modes.normal as TreeBranch;
    assert.equal(leaf_at(mail, "n")?.id, leaf_at(compile_default_keymap().compiled.modes.normal as TreeBranch, "n")?.id);
    assert.equal(ids_under(mail).some((id) => id.startsWith("menu.")), false);
    for (const kind of ["message", "window", "own", "page", "compose"] as const) {
        assert.equal(ids_under(compile_tab_keymap(kind, user.normal).compiled.modes.normal as TreeBranch).some((id) => id.startsWith("menu.")), false, kind);
        assert.equal(offered_in(kind, registry.get("menu.down")!), false, kind);
    }
});

test("the stored menu section keeps menu commands only", () => {
    assert.deepEqual(sanitize_user_keymap({ menu: { n: { id: "menu.down" }, x: { id: "msg.archive" }, j: null } }).menu, { n: { id: "menu.down" }, j: null });
});

test("i is bound in every tab tree and in the mail tab, and the typing layer stays out of the normal trees", () => {
    for (const root of [root_of(), own_root(), message_root(), window_root(), compile_default_keymap().compiled.modes.normal as TreeBranch]) assert.equal(leaf_at(root, "i")?.id, "mode.insert");
    for (const root of [root_of(), own_root(), message_root(), window_root()]) assert.equal(ids_under(root).includes("mode.escape"), false, "the typing layer stays out of the normal trees");
});

test("the message, own and window kinds offer the typing need, and the compose window still takes no insert key", () => {
    for (const kind of ["message", "own", "window", "page"] as const) assert.ok((TAB_KINDS[kind] as readonly string[]).includes("typing"), kind);
    assert.equal(leaf_at(compile_tab_keymap("compose").compiled.modes.normal as TreeBranch, "i"), undefined);
});

test("the message window tree holds the reading keys, the hint picks, the mail actions, the command line with tag, move and copy, q, zoom, new message, help, options and the Thunderbird pages, the find keys, and no tab, pane, folder or list key", () => {
    const root = window_root();
    assert.deepEqual(
        [["j"], ["<C-d>"], ["g", "g"], ["G"], ["f"], [";", "y"], ["m", "s"], ["m", "r"], ["a"], ["d", "d"], ["r"], ["R"], ["g", "F"], ["y", "y"], ["u"], ["q"], ["<A-q>"]].map((tokens) => leaf_at(root, ...tokens)?.id),
        ["message.scroll_down", "message.half_page_down", "message.top", "message.bottom", "hint.pick", "hint.pick", "msg.flag", "msg.read", "msg.archive", "msg.delete", "msg.reply", "msg.reply", "msg.forward", "msg.yank", "msg.undo", "tab.close", "tab.close"],
    );
    assert.deepEqual(
        [["z", "i"], ["z", "o"], ["z", "="], ["c"], ["g", "?"], [",", "h"], [",", "?"], [",", "s"], ["g", "p", "a"], ["g", "p", "t"], ["g", "p", "c"]].map((tokens) => leaf_at(root, ...tokens)?.id),
        ["zoom.by", "zoom.by", "zoom.set", "msg.new", "help.open", "help.open", "help.open", "options.open", "app.open_page", "app.open_page", "app.open_page"],
    );
    const ids = new Set(ids_under(root));
    for (const id of ids) assert.ok(!/^(tab\.(?!close$)|pane\.|folder\.|jump\.|mark\.|motion\.|view\.|thread\.(?!open_conversation$)|step\.(?!message$)|search\.|help\.whichkey$)/.test(id), id);
    assert.deepEqual(
        [[":"], ["m", "t"], ["m", "m"], ["m", "c"]].map((tokens) => [leaf_at(root, ...tokens)?.id, leaf_at(root, ...tokens)?.args]),
        [["cmdline.open", undefined], ["cmdline.open", { text: "tag " }], ["cmdline.open", { text: "move " }], ["cmdline.open", { text: "copy " }]],
    );
    assert.deepEqual(
        [["/"], ["n"], ["N"]].map((tokens) => [leaf_at(root, ...tokens)?.id, leaf_at(root, ...tokens)?.args]),
        [["cmdline.open", { text: "find " }], ["message.find_next", undefined], ["message.find_prev", undefined]],
    );
    // The keys that open the line on a command the window cannot run stay out.
    for (const token of ["<A-j>", "<A-k>", "H", "L", "T", "o"]) assert.equal(root.children[token], undefined, token);
    // `J`, `K`, `] u` and `[ u` step the window's message, where the mail tab's `J` and `K` switch tab and `] u` steps its list.
    assert.deepEqual(
        [["J"], ["K"], ["]", "u"], ["[", "u"]].map((tokens) => [leaf_at(root, ...tokens)?.id, leaf_at(root, ...tokens)?.args]),
        [["step.message", { direction: "next", unread: false }], ["step.message", { direction: "previous", unread: false }], ["step.message", { direction: "next", unread: true }], ["step.message", { direction: "previous", unread: true }]],
    );
    assert.equal(leaf_at(root, "]", "U")?.id ?? "none", "none", "the all-folders step stays unbound");
    for (const tokens of [["t", "m"], ["t", "T"], ["F", "f"], ["s", "s"], [";", ";"]]) assert.equal(leaf_at(root, ...tokens)?.id ?? "none", "none", tokens.join(""));
    // A mail sequence the tree lacks ends in a leaf that runs nothing, so its tail never runs on its own.
    for (const tokens of [["t", "0"], ["g", "f"], ["z", "a"]]) assert.deepEqual(leaf_at(root, ...tokens), undefined, tokens.join(""));
    assert.deepEqual(((root.children["g"] as TreeBranch).children["f"] as { steps: unknown[] }).steps, []);
});

test("a user key reaches the message window only when its command can run there", () => {
    const root = window_root({ X: { id: "msg.flag" }, Y: { id: "tab.next" }, Z: { id: "pane.focus", args: { pane: "folders" } }, W: { id: "cmdline.open", args: { text: "tag " } }, V: { id: "cmdline.open", args: { text: "sort " } }, U: { id: "cmdline.open", args: { text: "find " } } });
    for (const token of ["X", "W", "U"]) assert.ok(leaf_at(root, token), token);
    for (const token of ["Y", "Z", "V"]) assert.equal(root.children[token], undefined, token);
});

test("the message window header tree cuts the find line key, as the message tab does", () => {
    const tree = page_message_tree({ version: COMPILED_KEYMAP_VERSION, root: JSON.parse(JSON.stringify(window_root())) });
    assert.equal((tree.root as TreeBranch).children["/"], undefined);
    assert.equal(leaf_at(window_root(), "/")?.id, "cmdline.open");
});

test("the message window header tree sends hint picks to the background, as the message tab header does", () => {
    const tree = page_message_tree({ version: COMPILED_KEYMAP_VERSION, root: JSON.parse(JSON.stringify(window_root())) });
    const root = tree.root as TreeBranch;
    assert.equal(leaf_at(root, "f")?.id, "hint.window");
    assert.equal(leaf_at(root, "m", "s")?.id, "msg.flag");
});

test("the message tab trees keep their tab, pane and command line keys", () => {
    const root = message_root();
    assert.deepEqual([["J"], ["H"], [":"], ["m", "t"], ["g", "f"], ["q"]].map((tokens) => leaf_at(root, ...tokens)?.id), ["tab.next", "pane.left", "cmdline.open", "cmdline.open", "pane.focus", "tab.close"]);
});

test("a kind offers a command when it offers every need of it, which is what the command line of a message window lists and runs", () => {
    const offered = (id: string) => offered_in("window", registry.get(id) ?? {});
    for (const id of ["msg.tag", "msg.move", "msg.copy", "msg.flag", "msg.archive", "tab.close", "cmdline.open", "help.open", "zoom.by", "message.scroll_down"]) assert.equal(offered(id), true, id);
    for (const id of ["sort.set", "folder.open", "tab.switch", "filter.set", "motion.down", "step.unread", "pane.focus"]) assert.equal(offered(id), false, id);
    for (const id of ["search.message", "message.find_next", "message.find_prev"]) for (const kind of ["message", "window"] as const) assert.equal(offered_in(kind, registry.get(id) ?? {}), true, `${id} in ${kind}`);
});

test("`, m` opens the context menu in every tab kind and the mail tab, and the command needs the context Experiment and no command line name", () => {
    assert.equal(leaf_at(compile_default_keymap().compiled.modes.normal as TreeBranch, ",", "m")?.id, "context.menu");
    for (const kind of Object.keys(TAB_KINDS) as (keyof typeof TAB_KINDS)[]) assert.equal(leaf_at(compile_tab_keymap(kind).compiled.modes.normal as TreeBranch, ",", "m")?.id, "context.menu", kind);
    const command = registry.get("context.menu")!;
    assert.deepEqual(command.needs, ["main", "context.open"]);
    assert.equal(command.name, undefined);
    assert.equal(registry.list().some((each) => each.name === "context"), false);
});
