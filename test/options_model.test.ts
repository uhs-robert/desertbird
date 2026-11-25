import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTING_DEFAULTS as DEFAULT_SETTINGS } from "../src/background/config/settings.ts";
import { build_user_keymap, default_menu_rows, default_rows, edits_from_user_keymap, menu_edits_from_user_keymap, overrides_from_texts, parse_setting_text, setting_to_text } from "../src/options/model.ts";
import { DEFAULT_KEYMAP } from "../src/background/commands/index.ts";
import { SETTING_NAMES } from "../src/background/config/settings.ts";
import type { SettingName } from "../src/background/config/settings.ts";

const default_texts = () => Object.fromEntries(SETTING_NAMES.map((name) => [name, setting_to_text(name, DEFAULT_SETTINGS[name])])) as Record<SettingName, string>;

test("form text parses by kind", () => {
    assert.deepEqual(parse_setting_text("toast_ms", " 2500 "), { value: 2500 });
    assert.deepEqual(parse_setting_text("layout_fallback", "false"), { value: false });
    assert.deepEqual(parse_setting_text("which_key_skip", "a, b"), { value: ["a", "b"] });
    assert.deepEqual(parse_setting_text("which_key_skip", ""), { value: [] });
    assert.deepEqual(parse_setting_text("mode_indicator", "off"), { value: "off" });
    assert.deepEqual(parse_setting_text("mode_indicator_style", "badge"), { value: "badge" });
});

test("bad form text is an error", () => {
    for (const [name, text] of [["toast_ms", "soon"], ["toast_ms", ""], ["toast_ms", "-1"], ["layout_fallback", "maybe"], ["mode_indicator", "sometimes"], ["mode_indicator_style", "pill"]] as [SettingName, string][]) {
        assert.ok("error" in parse_setting_text(name, text), `${name} ${text}`);
    }
});

test("a form equal to the defaults has no overrides, and a changed field is one", () => {
    assert.deepEqual(overrides_from_texts(default_texts(), DEFAULT_SETTINGS), { overrides: {}, errors: {} });
    const result = overrides_from_texts({ ...default_texts(), toast_ms: "600", which_key_skip: "gg" }, DEFAULT_SETTINGS);
    assert.deepEqual(result.overrides, { toast_ms: 600, which_key_skip: ["gg"] });
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

test("a user key that makes a default key skip does not block the save, and the message stays", () => {
    const built = build_user_keymap({ removed: [], rows: [{ keys: "g", command: "msg.archive", args: "" }] });
    assert.ok("blocked" in built);
    if ("blocked" in built) {
        assert.equal(built.blocked, false);
        assert.ok(built.messages.some((message) => message.includes("skipped")));
    }
});

test("a custom prompt keeps its leading and trailing spaces, and a list setting is still trimmed", () => {
    assert.deepEqual(parse_setting_text("cmdline_prompt", " $ "), { value: " $ " });
    assert.deepEqual(parse_setting_text("cmdline_prompt", ""), { error: "expected 1 to 8 characters" });
    assert.deepEqual(parse_setting_text("which_key_skip", " gu , x "), { value: ["gu", "x"] });
    assert.deepEqual(parse_setting_text("statusbar_widgets", " position , folder "), { value: ["position", "folder"] });
    assert.deepEqual(parse_setting_text("statusbar_widgets", ""), { value: [] });
    assert.deepEqual(parse_setting_text("statusbar_widgets", "folder, url"), { error: "expected a list of folder, position" });
    assert.equal(setting_to_text("statusbar_widgets", ["folder", "position"]), "folder, position");
});

const no_edits = { removed: [], rows: [] };

test("the default menu rows list j, k, h and l apart from the thread list rows", () => {
    assert.deepEqual(default_menu_rows().map((row) => [row.keys, row.command]), [["j", "menu.down"], ["k", "menu.up"], ["h", "menu.left"], ["l", "menu.right"]]);
    assert.equal(default_rows().some((row) => row.command.startsWith("menu.")), false);
});

test("menu edits round-trip through the menu section and leave the list keys alone", () => {
    const menu_edits = { removed: ["j"], rows: [{ keys: "n", command: "menu.down", args: "" }] };
    const built = build_user_keymap(no_edits, {}, menu_edits);
    assert.ok("user_keymap" in built && !built.blocked);
    if ("user_keymap" in built) {
        assert.deepEqual(menu_edits_from_user_keymap(built.user_keymap), menu_edits);
        assert.deepEqual(built.user_keymap.normal, {});
    }
});

test("menu.left and menu.right rows are rebindable and save into the menu section", () => {
    const menu_edits = { removed: ["h", "l"], rows: [{ keys: "a", command: "menu.left", args: "" }, { keys: "d", command: "menu.right", args: "" }] };
    const built = build_user_keymap(no_edits, {}, menu_edits);
    assert.ok("user_keymap" in built && !built.blocked);
    if ("user_keymap" in built) {
        assert.deepEqual(built.user_keymap.menu, { h: null, l: null, a: { id: "menu.left" }, d: { id: "menu.right" } });
        assert.deepEqual(menu_edits_from_user_keymap(built.user_keymap), menu_edits);
    }
});

test("a menu key that is not one typed character, or not a menu command, is an error, and a menu command in the key bindings is too", () => {
    for (const row of [{ keys: "gn", command: "menu.down", args: "" }, { keys: "<C-n>", command: "menu.down", args: "" }, { keys: "\u{1F600}", command: "menu.down", args: "" }, { keys: "n", command: "msg.archive", args: "" }, { keys: "", command: "menu.up", args: "" }]) {
        assert.ok("error" in build_user_keymap(no_edits, {}, { removed: [], rows: [row] }), JSON.stringify(row));
    }
    assert.ok("error" in build_user_keymap({ removed: [], rows: [{ keys: "n", command: "menu.down", args: "" }] }));
});

test("toast times are whole numbers from 500 to 30000, which_key_skip holds key sequences and hint_letters holds distinct letters", () => {
    for (const [name, text] of [["toast_ms", "1"], ["toast_ms", "1e9"], ["toast_error_ms", "499"], ["toast_ms", "600.5"], ["which_key_skip", "g,,u"], ["hint_letters", "a"], ["hint_letters", "aab"], ["hint_letters", "aA"], ["hint_letters", "ab/"]] as [SettingName, string][]) {
        assert.ok("error" in parse_setting_text(name, text), `${name} ${text}`);
    }
    for (const [name, text, value] of [["toast_ms", "500", 500], ["toast_error_ms", "30000", 30000], ["which_key_skip", "gu, <C-w>", ["gu", "<C-w>"]], ["hint_letters", "jfkdls", "jfkdls"]] as [SettingName, string, unknown][]) {
        assert.deepEqual(parse_setting_text(name, text), { value }, `${name} ${text}`);
    }
});
