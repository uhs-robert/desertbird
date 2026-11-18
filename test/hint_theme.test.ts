import assert from "node:assert/strict";
import { test } from "node:test";
import { pick_in_window } from "../src/background/handlers/hint_window.ts";
import type { HintWindowApi } from "../src/background/handlers/hint_window.ts";
import { create_message_style, message_style_css } from "../src/background/theme/message_style.ts";
import { contrast_ratio, hint_label_colors, resolve_theme } from "../src/background/theme/palette.ts";
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
    assert.deepEqual(calls, [["pick", { windowId: 4, colors: hint_label_colors(resolve_theme("oasis_sol")) }], ["pick", { windowId: 4, colors: hint_label_colors(resolve_theme("oasis_moonlight")) }], ["enter", { windowId: 4 }]]);
    assert.equal(themed_hints(undefined, async () => name), undefined, "no Experiment, no hints");
});

test("the hint command refuses when nothing is labelled, and says nothing when something is", async () => {
    const api = (count: number): HintWindowApi => ({ hints: { sendEnter: async () => {}, pick: async () => count } });
    const scope = (count: number) => ({ api: api(count), window_id: 2 }) as never;
    await pick_in_window(scope(5));
    await assert.rejects(pick_in_window(scope(0)), /Nothing on screen/);
});

test("the message style defines the two tokens of the label in both schemes", () => {
    const theme = resolve_theme("oasis_sol");
    const css = message_style_css(theme);
    assert.ok(css.includes(`--desertfox-primary: ${theme.dark.primary}`) && css.includes(`--desertfox-bg-core: ${theme.dark.bg_core}`));
    assert.ok(css.includes("@media (prefers-color-scheme: light)") && css.includes(`--desertfox-primary: ${theme.light.primary}`));
});

test("a new style sheet goes in before the old one comes out", async () => {
    const log: string[] = [];
    let count = 0;
    const apply = create_message_style({
        messageDisplayScripts: {
            register: async () => {
                const id = ++count;
                log.push(`register ${id}`);
                return { unregister: async () => void log.push(`unregister ${id}`) };
            },
        },
    });
    await apply(resolve_theme("oasis_sol"));
    await apply(resolve_theme("oasis_moonlight"));
    assert.deepEqual(log, ["register 1", "register 2", "unregister 1"]);
});
