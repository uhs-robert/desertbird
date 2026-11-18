import assert from "node:assert/strict";
import { test } from "node:test";
import type { TreeBranch, TreeNode } from "../vendor/desertfox/prefix_tree.ts";
import { runs_nothing, which_key_panel } from "../src/background/hud/which_key.ts";
import { parse_command_line } from "../vendor/desertfox/registry/command_line.ts";
import { GROUP_NAMES, compile_default_keymap, compile_message_keymap, registry } from "../src/background/commands/index.ts";
import { settings_with } from "./hud_fakes.ts";

const mail_root = compile_default_keymap().compiled.modes.normal as TreeBranch;
const message_root = compile_message_keymap().compiled.modes.normal as TreeBranch;

const node_at = (root: TreeBranch, keys: readonly string[]): TreeNode | undefined => {
    let node: TreeNode | undefined = root;
    for (const key of keys) node = node?.kind === "branch" ? node.children[key] : undefined;
    return node;
};
const command_at = (root: TreeBranch, keys: readonly string[]): { id: string; args?: Record<string, unknown> } | undefined => {
    const node = node_at(root, keys);
    return node?.kind === "leaf" ? node.steps[0]?.invocation : undefined;
};
const rows_of = (root: TreeBranch, keys: readonly string[]) => Object.fromEntries((which_key_panel(root, keys, settings_with({}))?.rows ?? []).map((row) => [row.key, row.label]));

// The message tree holds keys that complete a mail sequence and run nothing. They have no name and no row.

function each_branch(root: TreeBranch, path: string[] = []): { path: string[]; branch: TreeBranch }[] {
    return Object.entries(root.children).flatMap(([key, child]) => (child.kind === "branch" && !runs_nothing(child) ? [{ path: [...path, key], branch: child }, ...each_branch(child, [...path, key])] : []));
}

test("every group of both trees has a name, and the panel title is the chain of names", () => {
    for (const root of [mail_root, message_root]) {
        for (const { path, branch } of each_branch(root)) assert.equal(branch.label, GROUP_NAMES[path.join("")], path.join(""));
    }
    assert.deepEqual(which_key_panel(mail_root, [], settings_with({}))?.title, ["keys"]);
    assert.deepEqual(which_key_panel(mail_root, ["g", "p"], settings_with({}))?.title, ["+Go", "+Pages"]);
    assert.deepEqual(which_key_panel(mail_root, ["m", "z"], settings_with({}))?.title, ["+Message", "+Snooze"]);
});

test("the root lists each group by its name", () => {
    const root = rows_of(mail_root, []);
    const names = { g: "Go", m: "Message", F: "Filter", ",": "Sort", t: "Panes", z: "List view", y: "Copy", ";": "Hints", "]": "Next", "[": "Previous", M: "Set mark", "'": "Jump to mark", d: "Delete" };
    for (const [key, name] of Object.entries(names)) assert.equal(root[key], name, key);
});

test("the rows carry the short labels", () => {
    assert.deepEqual(rows_of(mail_root, ["g", "p"]), { a: "Add-ons", t: "Themes", c: "Config" });
    assert.deepEqual(rows_of(mail_root, ["F"]), { u: "Unread", r: "Reset", s: "Starred", a: "Attachments", f: "By text", t: "By tag" });
    assert.deepEqual(rows_of(mail_root, ["m", "f"]), { d: "In 1 day", t: "In 3 days", w: "In 1 week", c: "Cancel" });
    assert.deepEqual(rows_of(mail_root, ["y"]), { y: "Message", s: "Subject", f: "Sender", a: "Address", i: "Message ID" });
    assert.deepEqual(rows_of(mail_root, ["g", "r"])["1"], "Slot 1");
    assert.deepEqual(rows_of(mail_root, [";"]), { ";": "Hint command line", f: "Focus target", c: "Click target", y: "Copy target" });
    assert.deepEqual(rows_of(message_root, [";"]), { f: "Focus link", c: "Click link", y: "Copy link" });
    assert.equal(rows_of(mail_root, [])["H"], "Collapse folder or go to folders");
    assert.equal(rows_of(message_root, [])["H"], "Focus folder pane");
    assert.equal(rows_of(message_root, [])["/"], "Find in message");
});

test("the moved keys run their commands, and the old keys are free", () => {
    assert.deepEqual(command_at(mail_root, ["g", "p", "a"]), { id: "app.open_page", args: { page: "addons" } });
    assert.deepEqual(command_at(mail_root, ["g", "p", "t"]), { id: "app.open_page", args: { page: "themes" } });
    assert.deepEqual(command_at(mail_root, ["g", "p", "c"]), { id: "app.open_page", args: { page: "config" } });
    assert.deepEqual(command_at(mail_root, ["F", "a"]), { id: "filter.set", args: { state: "attachment" } });
    assert.deepEqual(command_at(mail_root, ["F", "r"]), { id: "filter.set", args: { state: "all" } });
    assert.equal(command_at(mail_root, ["a"])?.id, "msg.archive");
    assert.equal(command_at(mail_root, ["x"])?.id, "msg.archive");
    for (const keys of [["g", "x"], ["g", "T"], ["g", "c"], ["g", "o"], ["F", "A"], ["<C-h>"]]) assert.equal(node_at(mail_root, keys), undefined, keys.join(" "));
    assert.equal(command_at(mail_root, ["g", "e"])?.args?.["pane"], "threads");
});

test("the keys that act on the displayed message resolve in the message tree", () => {
    assert.equal(command_at(message_root, ["u"])?.id, "msg.undo");
    assert.equal(command_at(message_root, ["g", "u"])?.id, "msg.unsubscribe");
    assert.equal(command_at(message_root, ["g", "a"])?.id, "msg.save_attachments");
    assert.equal(command_at(message_root, ["g", "C"])?.id, "thread.open_conversation");
    for (let slot = 1; slot <= 9; slot++) assert.deepEqual(command_at(message_root, ["g", "r", String(slot)]), { id: "msg.reply_with", args: { slot } });
    assert.equal(command_at(message_root, ["a"])?.id, "msg.archive");
});

test("which-key in a message shows no row and no panel for a mail sequence that runs nothing there", () => {
    for (const keys of [["]"], ["F"], ["g", "p"], [";", ";"]]) assert.equal(which_key_panel(message_root, keys, settings_with({})), null, keys.join(" "));
    for (const key of ["]", "F", ","]) assert.equal(rows_of(message_root, [])[key], undefined, key);
    assert.equal(rows_of(message_root, ["g"])["p"], undefined);
    assert.deepEqual(rows_of(message_root, [";"]), { f: "Focus link", c: "Click link", y: "Copy link" });
});

test("; ; opens the command line on hint in the mail tree only, and its first word is a known command that parses", () => {
    const binding = command_at(mail_root, [";", ";"]);
    assert.deepEqual(binding, { id: "cmdline.open", args: { text: "hint " } });
    const typed = `${String(binding?.args?.["text"])}--yank`;
    assert.deepEqual(parse_command_line(registry, typed), { kind: "invocation", invocation: { id: "hint.window", args: { action: "yank" } } });
    assert.deepEqual(node_at(message_root, [";", ";"]), { kind: "leaf", steps: [] }, "in a message ; ; ends and runs nothing");
});

test("every row has a label and none is long", () => {
    for (const root of [mail_root, message_root]) {
        for (const { path, branch } of [{ path: [] as string[], branch: root }, ...each_branch(root)]) {
            for (const [key, child] of Object.entries(branch.children)) {
                if (child.kind !== "leaf" || runs_nothing(child)) continue;
                const label = child.label ?? "";
                assert.ok(label.length > 0 && label.length <= 34, `${path.join("")}${key}: ${label}`);
            }
        }
    }
});
