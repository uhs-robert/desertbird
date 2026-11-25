import assert from "node:assert/strict";
import { test } from "node:test";
import { create_matcher } from "../vendor/desertfox/keys/matcher.ts";
import type { MatchResult } from "../vendor/desertfox/keys/matcher.ts";
import { DEFAULT_KEYMAP, compile_default_keymap } from "../src/background/commands/index.ts";
import { matcher_for_tree } from "../src/shared/keymap_tree.ts";
import { COMPILED_KEYMAP_VERSION } from "../vendor/desertfox/prefix_tree.ts";

const { compiled, warnings } = compile_default_keymap();

function type_keys(...tokens: string[]): MatchResult {
    const matcher = create_matcher(compiled);
    let result: MatchResult = { kind_: "no_match" };
    for (const token of tokens) result = matcher.feed("normal", token);
    return result;
}

function matched_step(...tokens: string[]) {
    const result = type_keys(...tokens);
    assert.equal(result.kind_, "match", `${tokens.join(" ")} must match`);
    if (result.kind_ !== "match") throw new Error("unreachable");
    return { step: result.leaf.steps[0], count: result.count };
}

test("the default keymap compiles without a warning", () => {
    assert.deepEqual(warnings, []);
});

test("each default key reaches its command with the side that runs it", () => {
    const expected: [string[], string, string][] = [
        [["j"], "motion.down", "chrome"],
        [["k"], "motion.up", "chrome"],
        [["g", "g"], "motion.top", "chrome"],
        [["G"], "motion.bottom", "chrome"],
        [["."], "repeat.last", "chrome"],
        [["a"], "msg.archive", "background"],
        [["d", "d"], "msg.delete", "background"],
        [["r"], "msg.reply", "background"],
        [["R"], "msg.reply", "background"],
        [["m", "r"], "msg.read", "background"],
        [["m", "u"], "msg.read", "background"],
        [["m", "R"], "folder.read_all", "background"],
        [["m", "s"], "msg.flag", "background"],
        [["m", "j"], "msg.junk", "background"],
        [["m", "z", "l"], "msg.snooze", "background"],
        [["m", "z", "w"], "msg.snooze", "background"],
        [["m", "f", "d"], "msg.remind", "background"],
        [["m", "f", "c"], "msg.remind_cancel", "background"],
        [["g", "F"], "msg.forward", "background"],
        [["g", "u"], "msg.unsubscribe", "background"],
        [["c"], "msg.new", "background"],
    ];
    for (const [tokens, id, runs_in] of expected) {
        const { step } = matched_step(...tokens);
        assert.equal(step?.invocation.id, id);
        assert.equal(step?.runs_in, runs_in);
    }
});

test("r carries the reply target", () => {
    assert.deepEqual(matched_step("r").step?.invocation.args, { to: "sender" });
});

test("a count prefix reaches the matcher", () => {
    const { step, count } = matched_step("3", "j");
    assert.equal(step?.invocation.id, "motion.down");
    assert.equal(count, 3);
});

test("a lone g is pending, and a reset forgets it", () => {
    const matcher = create_matcher(compiled);
    assert.equal(matcher.feed("normal", "g").kind_, "pending");
    matcher.reset();
    assert.equal(matcher.feed("normal", "g").kind_, "pending");
    assert.equal(matcher.feed("normal", "g").kind_, "match");
});

// The matcher gives a key that breaks a half-typed sequence one more try as a first key. So d then a never reaches msg.delete, and a then runs as the archive key.
test("d then a drops the stray d and reads a as a first key", () => {
    const { step } = matched_step("d", "a");
    assert.equal(step?.invocation.id, "msg.archive");
});

test("d then an unbound key matches nothing", () => {
    assert.equal(type_keys("d", "x").kind_, "no_match");
});

test("the tree survives the structured clone the Experiment boundary applies", () => {
    const root = compiled.modes.normal;
    assert.deepEqual(JSON.parse(JSON.stringify(root)), root);
});

// The phase 2 groups bind these chords. Until they land, the test adds each one to the default keymap as a motion, so the compile runs with the real command lookup.
test("the keymap compile accepts the bound chords and the matcher reads each one as a first key", () => {
    const chords = ["<C-o>", "<C-i>", "<C-l>", "<C-j>", "<C-k>", "<C-x>", "<C-c>", "<C-h>"];
    const default_normal = DEFAULT_KEYMAP.normal!;
    DEFAULT_KEYMAP.normal = { ...default_normal, ...Object.fromEntries(chords.map((chord) => [chord, { id: "motion.down" }])) };
    try {
        const result = compile_default_keymap();
        assert.deepEqual(result.warnings, []);
        const matcher = create_matcher(result.compiled);
        for (const chord of chords) assert.equal(matcher.feed("normal", chord).kind_, "match", chord);
    } finally {
        DEFAULT_KEYMAP.normal = default_normal;
    }
});

test("the command line opener is unrepeatable", async () => {
    const { UNREPEATABLE_IDS } = await import("../src/background/commands/index.ts");
    assert.deepEqual([...UNREPEATABLE_IDS].sort(), ["cmdline.open", "hint.window", "msg.copy", "msg.move", "msg.remind", "msg.remind_cancel", "msg.reply_with", "msg.snooze", "msg.undo", "msg.unsubscribe", "notify.toggle", "search.open", "select.toggle"]);
});

test("mark_steps tags the steps of move and snooze, and not delete or archive, which u undoes", async () => {
    const { mark_steps } = await import("../src/background/config/keymap.ts");
    const step = (id: string) => ({ invocation: { id } });
    const root = {
        kind: "branch",
        children: {
            x: { kind: "leaf", steps: [step("msg.archive")] },
            d: { kind: "branch", children: { d: { kind: "leaf", steps: [step("msg.snooze")] } } },
            m: { kind: "leaf", steps: [step("msg.move")], otherwise: { kind: "leaf", steps: [step("msg.delete")] } },
            r: { kind: "leaf", steps: [step("msg.read")] },
        },
    };
    mark_steps(root);
    const flags = (node: { steps: object[] }) => node.steps.map((entry) => (entry as { repeatable?: boolean }).repeatable);
    assert.deepEqual(flags(root.children.x), [undefined]);
    assert.deepEqual(flags(root.children.d.children.d), [false]);
    assert.deepEqual(flags(root.children.m), [false]);
    assert.deepEqual(flags(root.children.m.otherwise), [undefined]);
    assert.deepEqual(flags(root.children.r), [undefined]);
});

test("mark_steps tags the steps of the commands that keep the selection, and not delete or archive", async () => {
    const { mark_steps } = await import("../src/background/config/keymap.ts");
    const { KEEPS_SELECTION_IDS } = await import("../src/background/commands/index.ts");
    assert.deepEqual([...KEEPS_SELECTION_IDS].sort(), ["msg.copy", "msg.flag", "msg.junk", "msg.read", "msg.tag"]);
    const step = (id: string) => ({ invocation: { id } });
    const root = { kind: "branch", children: { s: { kind: "leaf", steps: [step("msg.flag")] }, x: { kind: "leaf", steps: [step("msg.archive")] }, d: { kind: "leaf", steps: [step("msg.delete")] } } };
    mark_steps(root);
    const flags = (node: { steps: object[] }) => node.steps.map((entry) => (entry as { keeps_selection?: boolean }).keeps_selection);
    assert.deepEqual(flags(root.children.s), [true]);
    assert.deepEqual(flags(root.children.x), [undefined]);
    assert.deepEqual(flags(root.children.d), [undefined]);
});

test("matcher_for_tree: Backspace drops the last key of a sequence, and counts and registers stay", () => {
    const leaf = { kind: "leaf" as const, steps: [] };
    const root = { kind: "branch" as const, children: { g: { kind: "branch" as const, children: { u: { kind: "branch" as const, children: { l: leaf } } } }, d: leaf } };
    const matcher = matcher_for_tree({ version: COMPILED_KEYMAP_VERSION, root });
    const typed = (token: string) => {
        const result = matcher.feed("normal", token);
        return result.kind_ === "pending" ? result.typed_ : result.kind_;
    };
    assert.deepEqual([typed("g"), typed("u"), typed("<Backspace>")], [["g"], ["g", "u"], ["g"]]);
    assert.deepEqual([typed("u"), typed("l")], [["g", "u"], "match"]);
    assert.deepEqual([typed("2"), typed("g"), typed("<Backspace>"), typed("<Backspace>")], [[], ["g"], [], []]);
    assert.equal(typed("<Backspace>"), "no_match", "once Backspace has emptied the sequence, the next one is an ordinary key");
    assert.equal(typed("d"), "match", "a count dropped by Backspace does not leak");
    assert.equal(typed("<Backspace>"), "no_match", "no sequence, so Backspace is an ordinary key");
});

test("hint_key_sequences lists the keys bound to a pick in the mail tab tree, and not `; ;`, which opens the command line", async () => {
    const { compile_effective_keymap } = await import("../src/background/config/keymap.ts");
    const { hint_key_sequences } = await import("../src/shared/hint_hold.ts");
    const root = compile_effective_keymap({}).compiled.modes.normal as object;
    assert.deepEqual(hint_key_sequences(root).map((sequence) => sequence.join(" ")).sort(), ["; c", "; f", "; y", "f"]);
});
