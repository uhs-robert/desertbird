import assert from "node:assert/strict";
import { test } from "node:test";
import { create_matcher } from "../vendor/desertfox/keys/matcher.ts";
import { DEFAULT_KEYMAP, compile_default_keymap } from "../src/background/commands/index.ts";
import { compile_effective_keymap, effective_keymap } from "../src/background/config/keymap.ts";

function command_for(compiled: ReturnType<typeof compile_effective_keymap>["compiled"], ...tokens: string[]): string | undefined {
    const matcher = create_matcher(compiled);
    let result: ReturnType<typeof matcher.feed> = { kind_: "no_match" };
    for (const token of tokens) result = matcher.feed("normal", token);
    return result.kind_ === "match" ? result.leaf.steps[0]?.invocation.id : undefined;
}

test("with no user bindings the effective keymap is the default keymap and compiles to the same tree", () => {
    assert.equal(JSON.stringify(effective_keymap({})), JSON.stringify(DEFAULT_KEYMAP));
    assert.deepEqual(compile_effective_keymap({}).compiled.modes, compile_default_keymap().compiled.modes);
});

test("a user binding adds a key", () => {
    const { compiled, warnings } = compile_effective_keymap({ normal: { Z: { id: "msg.archive" } } });
    assert.deepEqual(warnings, []);
    assert.equal(command_for(compiled, "Z"), "msg.archive");
    assert.equal(command_for(compiled, "j"), "motion.down");
});

test("a user binding on plain s wins over the s X sort defaults: each is skipped with a warning and the keymap installs", () => {
    const { compiled, warnings } = compile_effective_keymap({ normal: { s: { id: "msg.archive" } } });
    assert.equal(command_for(compiled, "s"), "msg.archive");
    assert.ok(warnings.some((warning) => warning.includes('skipped "sd"')), warnings.join("; "));
    assert.equal(command_for(compiled, "j"), "motion.down");
    assert.equal(command_for(compiled, ",", "h"), "help.open");
});

test("a user binding on a default key replaces it", () => {
    const { compiled } = compile_effective_keymap({ normal: { x: { id: "msg.delete" } } });
    assert.equal(command_for(compiled, "x"), "msg.delete");
});

test("a null binding removes a default key", () => {
    const { compiled } = compile_effective_keymap({ normal: { x: null } });
    assert.equal(command_for(compiled, "x"), undefined);
    assert.equal(command_for(compiled, "j"), "motion.down");
});

test("a binding to an unknown command is skipped with a warning", () => {
    const { compiled, warnings } = compile_effective_keymap({ normal: { Z: { id: "no.such" } } });
    assert.equal(command_for(compiled, "Z"), undefined);
    assert.ok(warnings.some((warning) => warning.includes("unknown command")));
});
