import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTING_DEFAULTS, SETTING_KINDS, setting_problem } from "../src/background/config/settings.ts";
import { contrast_ratio, mode_label_colors, resolve_theme } from "../src/background/theme/palette.ts";
import { publish_theme } from "../src/background/theme/publish.ts";
import { OASIS_THEME_NAMES, DEFAULT_THEME } from "../src/shared/theme_choice.ts";
import { THEME_STORAGE_KEY, theme_css } from "../src/shared/theme_css.ts";
import { ROLES } from "../vendor/desertfox/theme/roles.ts";

// The status bar of the default Thunderbird dark and light themes, read from the window of a measured run.
const STATUS_BAR = { dark: "#27272a", light: "#fafafa" } as const;
const READABLE = 4.5;

test("the theme setting offers the 16 Oasis themes and defaults to moonlight", () => {
    assert.equal(OASIS_THEME_NAMES.length, 16);
    assert.equal(SETTING_DEFAULTS.theme, "oasis_moonlight");
    assert.equal(DEFAULT_THEME, "oasis_moonlight");
    assert.deepEqual(SETTING_KINDS.theme, { kind: "choice", choices: OASIS_THEME_NAMES });
    assert.equal(setting_problem("theme", "oasis_sol"), undefined);
    assert.notEqual(setting_problem("theme", "dracula"), undefined, "a contributed theme is not offered");
    assert.notEqual(setting_problem("theme", "desktop"), undefined);
});

test("every Oasis theme: each mode color reads on the status bar of its scheme, and the badge text reads on every mode color", () => {
    for (const name of OASIS_THEME_NAMES) {
        const colors = mode_label_colors(resolve_theme(name));
        for (const scheme of ["dark", "light"] as const) {
            for (const mode of ["normal", "visual", "insert"] as const) {
                const color = colors[scheme][mode];
                assert.ok(contrast_ratio(color, STATUS_BAR[scheme]) >= READABLE, `${name} ${scheme} ${mode} ${color} on the status bar`);
                assert.ok(contrast_ratio(colors[scheme].on_badge, color) >= READABLE, `${name} ${scheme} ${mode} badge text`);
            }
        }
    }
});

test("the label colors are the mode roles of the matching set, as #rrggbb", () => {
    const theme = resolve_theme("oasis_desert");
    const colors = mode_label_colors(theme);
    assert.equal(colors.dark.normal, theme.dark.mode_normal);
    assert.equal(colors.light.visual, theme.light.mode_visual);
    for (const color of Object.values(colors.dark).concat(Object.values(colors.light))) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("an unknown theme name resolves to the default theme", () => {
    assert.deepEqual(resolve_theme("no_such_theme"), resolve_theme(DEFAULT_THEME));
    assert.deepEqual(resolve_theme("__proto__"), resolve_theme(DEFAULT_THEME));
});

test("theme_css puts dark in the base block and light under the light scheme, with every role as a token", () => {
    const css = theme_css(resolve_theme("oasis_moonlight"), ":root");
    const [base, light] = css.split("@media (prefers-color-scheme: light)");
    for (const role of ROLES) assert.match(base!, new RegExp(`--desertfox-${role.replaceAll("_", "-")}: #[0-9a-f]{6};`));
    assert.ok(light!.includes(resolve_theme("oasis_moonlight").light.bg_core));
    assert.ok(base!.includes(resolve_theme("oasis_moonlight").dark.bg_core));
});

function fake_storage(initial: Record<string, unknown> = {}) {
    const data = { ...initial };
    const writes: Record<string, unknown>[] = [];
    return { data, writes, get: async (key: string) => (key in data ? { [key]: data[key] } : {}), set: async (items: Record<string, unknown>) => void (writes.push(items), Object.assign(data, items)) };
}

test("publish_theme writes the resolved theme, and writes again only when it changed", async () => {
    const storage = fake_storage();
    await publish_theme(storage, "oasis_desert");
    assert.deepEqual(storage.data[THEME_STORAGE_KEY], resolve_theme("oasis_desert"));
    await publish_theme(storage, "oasis_desert");
    assert.equal(storage.writes.length, 1);
    await publish_theme(storage, "oasis_sol");
    assert.equal(storage.writes.length, 2);
    assert.deepEqual(storage.data[THEME_STORAGE_KEY], resolve_theme("oasis_sol"));
});
