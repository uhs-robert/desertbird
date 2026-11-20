import assert from "node:assert/strict";
import { test } from "node:test";
import type { TreeBranch } from "../vendor/desertfox/prefix_tree.ts";
import { which_key_panel, with_stored_marks } from "../src/background/hud/which_key.ts";
import { compile_default_keymap } from "../src/background/commands/index.ts";
import { create_hud_service } from "../src/background/hud/service.ts";
import { fake_timers, settle, settings_with } from "./hud_fakes.ts";

const mail_root = compile_default_keymap().compiled.modes.normal as TreeBranch;
const marks = { b: { path: "/Archive/2024" }, a: { path: "/INBOX" } };
const panel_of = (keys: string[], stored: Record<string, { path: string }>) => with_stored_marks(which_key_panel(mail_root, keys, settings_with({}))!, mail_root, keys, stored);

test("the capture row under M and ' becomes one row per stored mark with the folder path, in key order", () => {
    for (const prefix of ["M", "'"]) {
        const rows = panel_of([prefix], marks).rows;
        assert.deepEqual(rows.map((row) => [row.key, row.label]), [["a", "/INBOX"], ["b", "/Archive/2024"]], prefix);
    }
});

test("with no stored mark the capture row stays, and other prefixes are untouched", () => {
    assert.deepEqual(panel_of(["M"], {}), which_key_panel(mail_root, ["M"], settings_with({})));
    assert.deepEqual(panel_of(["g"], marks), which_key_panel(mail_root, ["g"], settings_with({})));
});

async function rows_under_m(read_marks: () => Promise<Record<string, { path: string }>>): Promise<string[]> {
    const timers = fake_timers();
    const hud = create_hud_service({
        overlay: { mount: async () => {}, unmount: async () => {}, setModeLabel: async () => {}, onClosed: { addListener: () => {}, removeListener: () => {} } },
        read_settings: async () => settings_with({ which_key_delay_ms: 100 }),
        read_root: async () => mail_root,
        read_marks,
        send_changed: () => {},
        timers,
    });
    await hud.on_keys_event({ command: "pending", keys: ["M"], windowId: 1 });
    timers.advance(100);
    await settle();
    return ((await hud.handle({ type: "hud.state", windowId: 1 }))!.which_key?.rows ?? []).map((row) => row.key);
}

test("the hud state lists the marks under M", async () => {
    assert.deepEqual(await rows_under_m(async () => marks), ["a", "b"]);
});

test("a failed read of the marks leaves the capture row", async () => {
    assert.equal((await rows_under_m(() => Promise.reject(new Error("no storage")))).length, 1);
});
