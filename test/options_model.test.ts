import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../vendor/desertfox/config.ts";
import { build_user_keymap, default_rows, edits_from_user_keymap, overrides_from_texts, parse_setting_text, setting_to_text } from "../src/options/model.ts";
import { DEFAULT_KEYMAP } from "../src/background/commands/index.ts";
import { SETTING_NAMES } from "../src/background/config/settings.ts";
import type { SettingName } from "../src/background/config/settings.ts";

const default_texts = () => Object.fromEntries(SETTING_NAMES.map((name) => [name, setting_to_text(name, DEFAULT_SETTINGS[name])])) as Record<SettingName, string>;

test("form text parses by kind", () => {
    assert.deepEqual(parse_setting_text("toast_ms", " 250 "), { value: 250 });
    assert.deepEqual(parse_setting_text("layout_fallback", "false"), { value: false });
    assert.deepEqual(parse_setting_text("which_key_skip", "a, b"), { value: ["a", "b"] });
    assert.deepEqual(parse_setting_text("which_key_skip", ""), { value: [] });
    assert.deepEqual(parse_setting_text("mode_indicator", "off"), { value: "off" });
});

test("bad form text is an error", () => {
    for (const [name, text] of [["toast_ms", "soon"], ["toast_ms", ""], ["toast_ms", "-1"], ["layout_fallback", "maybe"], ["mode_indicator", "sometimes"]] as [SettingName, string][]) {
        assert.ok("error" in parse_setting_text(name, text), `${name} ${text}`);
    }
});

test("a form equal to the defaults has no overrides, and a changed field is one", () => {
    assert.deepEqual(overrides_from_texts(default_texts(), DEFAULT_SETTINGS), { overrides: {}, errors: {} });
    const result = overrides_from_texts({ ...default_texts(), toast_ms: "10", which_key_skip: "gg" }, DEFAULT_SETTINGS);
    assert.deepEqual(result.overrides, { toast_ms: 10, which_key_skip: ["gg"] });
});

test("the default rows list every default key with its command", () => {
    const rows = default_rows();
    assert.equal(rows.length, Object.keys(DEFAULT_KEYMAP.normal ?? {}).length);
    assert.deepEqual(rows.find((row) => row.keys === "j"), { keys: "j", command: "motion.down", args: "" });
});

test("edits round-trip through the user keymap", () => {
    const edits = { removed: ["x"], rows: [{ keys: "Z", command: "msg.reply", args: '{"to":"sender"}' }] };
    const built = build_user_keymap(edits);
    assert.ok("user_keymap" in built && !built.blocked);
    if ("user_keymap" in built) assert.deepEqual(edits_from_user_keymap(built.user_keymap), edits);
});

test("a row with missing keys or bad args is an error", () => {
    assert.ok("error" in build_user_keymap({ removed: [], rows: [{ keys: "", command: "msg.reply", args: "" }] }));
    assert.ok("error" in build_user_keymap({ removed: [], rows: [{ keys: "Z", command: "msg.reply", args: "{" }] }));
    assert.ok("error" in build_user_keymap({ removed: [], rows: [{ keys: "Z", command: "msg.reply", args: "[1]" }] }));
});

test("a binding the compiler skips blocks the save", () => {
    const built = build_user_keymap({ removed: [], rows: [{ keys: "Z", command: "no.such", args: "" }] });
    assert.ok("blocked" in built && built.blocked);
});
