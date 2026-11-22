import assert from "node:assert/strict";
import { test } from "node:test";
import { pick_in_window } from "../src/background/handlers/hint_window.ts";
import type { HintWindowApi } from "../src/background/handlers/hint_window.ts";
import { contrast_ratio, hint_label_colors, hint_label_style, resolve_theme } from "../src/background/theme/palette.ts";
import { themed_hints } from "../src/background/theme/themed_hints.ts";
import { OASIS_THEME_NAMES } from "../src/shared/theme_choice.ts";

test("the hint label is the brand color with the theme background as its letters", () => {
    const theme = resolve_theme("oasis_sol");
    assert.deepEqual(hint_label_colors(theme), { dark: { fill: theme.dark.primary, text: theme.dark.bg_core }, light: { fill: theme.light.primary, text: theme.light.bg_core } });
});

test("every Oasis theme gives a hint label whose letters can be read on its box", () => {
    for (const name of OASIS_THEME_NAMES) {
        const colors = hint_label_colors(resolve_theme(name));
        for (const scheme of [colors.dark, colors.light]) assert.ok(contrast_ratio(scheme.fill, scheme.text) >= 3, `${name} ${scheme.fill} on ${scheme.text}`);
    }
});

test("the themed hints fill in the colors of the setting at each pick, and pass the Enter on", async () => {
    const calls: unknown[] = [];
    let name = "oasis_sol";
    const hints = themed_hints({ sendEnter: async (args) => void calls.push(["enter", args]), pick: async (args) => (calls.push(["pick", args]), 3) }, async () => name);
    assert.equal(await hints!.pick({ windowId: 4 }), 3);
    name = "oasis_moonlight";
    await hints!.pick({ windowId: 4 });
    await hints!.sendEnter({ windowId: 4 });
    await hints!.pick({ windowId: 4, action: "yank" });
    assert.deepEqual(calls, [["pick", { windowId: 4, colors: hint_label_colors(resolve_theme("oasis_sol")) }], ["pick", { windowId: 4, colors: hint_label_colors(resolve_theme("oasis_moonlight")) }], ["enter", { windowId: 4 }], ["pick", { windowId: 4, action: "yank", colors: hint_label_colors(resolve_theme("oasis_moonlight")) }]]);
    calls.length = 0;
    await hints!.pick({ windowId: 4, tabId: 7, place: "message" });
    assert.deepEqual(calls, [["pick", { windowId: 4, place: "message", tabId: 7, colors: hint_label_colors(resolve_theme("oasis_moonlight")) }]], "a message pick carries the tab of the body that asked, or the parent answers 0");
    assert.equal(themed_hints(undefined, async () => name), undefined, "no Experiment, no hints");
});

test("the hint command refuses when nothing is labelled, and says nothing when something is", async () => {
    const api = (count: number): HintWindowApi => ({ hints: { sendEnter: async () => {}, pick: async () => count } });
    const scope = (count: number) => ({ api: api(count), window_id: 2 }) as never;
    await pick_in_window(scope(5), { action: "activate" });
    await assert.rejects(pick_in_window(scope(0), { action: "activate" }), /Nothing on screen/);
});

test("the message label style is literal colors for both schemes, with no custom property", () => {
    const colors = hint_label_colors(resolve_theme("oasis_sol"));
    const style = hint_label_style(colors);
    assert.ok(style.includes(`background: light-dark(${colors.light.fill}, ${colors.dark.fill}) !important`));
    assert.ok(style.includes(`color: light-dark(${colors.light.text}, ${colors.dark.text}) !important`));
    assert.ok(style.includes("color-scheme: light dark !important") && !style.includes("var("));
});

test("the hint command holds plain keys after it, is not replayed by `.`, and is typed as `hint`", async () => {
    const { hold_command_ids, registry, UNREPEATABLE_IDS } = await import("../src/background/commands/index.ts");
    assert.ok(hold_command_ids().includes("hint.window"), "f d d in one burst must not reach the key runtime before the labels take the keys");
    assert.ok(hold_command_ids().includes("cmdline.open"));
    assert.ok(UNREPEATABLE_IDS.has("hint.window"));
    assert.equal(registry.get("hint.window")?.name, "hint");
});
