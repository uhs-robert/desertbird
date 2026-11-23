import assert from "node:assert/strict";
import { test } from "node:test";
import type { TreeBranch } from "../vendor/desertfox/prefix_tree.ts";
import { which_key_panel, with_stored_marks } from "../src/background/hud/which_key.ts";
import { DEFAULT_KEYMAP, compile_bindings, compile_default_keymap } from "../src/background/commands/index.ts";
import { create_hud_service } from "../src/background/hud/service.ts";
import { fake_timers, settle, settings_with } from "./hud_fakes.ts";

const mail_root = compile_default_keymap().compiled.modes.normal as TreeBranch;
const marks = { b: { path: "/Archive/2024" }, a: { path: "/INBOX" } };
const panel_of = (keys: string[], stored: Record<string, { path: string }>, root = mail_root) => with_stored_marks(which_key_panel(root, keys, settings_with({}))!, root, keys, async () => stored);
const cells = (panel: { rows: { key: string; label: string }[] }) => panel.rows.map((row) => [row.key, row.label]);

test("the capture row under M and ' becomes one row per stored mark with the folder path, in key order", async () => {
    for (const prefix of ["M", "'"]) assert.deepEqual(cells(await panel_of([prefix], marks)), [["a", "/INBOX"], ["b", "/Archive/2024"]], prefix);
});

test("with no stored mark the capture row stays, and other prefixes never read the marks", async () => {
    assert.deepEqual(await panel_of(["M"], {}), which_key_panel(mail_root, ["M"], settings_with({})));
    const panel = which_key_panel(mail_root, ["g"], settings_with({}))!;
    assert.equal(await with_stored_marks(panel, mail_root, ["g"], () => Promise.reject(new Error("read"))), panel);
});

test("a mark key moved to another key lists the marks under it", async () => {
    const { compiled } = compile_bindings({ ...DEFAULT_KEYMAP, normal: { ...DEFAULT_KEYMAP.normal, M: null, m: { id: "mark.set" } } }, {}, DEFAULT_KEYMAP);
    const root = compiled.modes.normal as TreeBranch;
    assert.deepEqual(cells(await panel_of(["m"], marks, root)), [["a", "/INBOX"], ["b", "/Archive/2024"]]);
});

test("a key bound by hand under M keeps its row and the marks fill the other keys", async () => {
    const { compiled } = compile_bindings({ ...DEFAULT_KEYMAP, normal: { ...DEFAULT_KEYMAP.normal, Ma: { id: "mark.set", args: { slot: "a" } } } }, {}, DEFAULT_KEYMAP);
    const root = compiled.modes.normal as TreeBranch;
    const own = which_key_panel(root, ["M"], settings_with({}))!.rows.find((row) => row.key === "a")!;
    const rows = (await panel_of(["M"], marks, root)).rows;
    assert.deepEqual(rows.map((row) => row.key), ["a", "b"]);
    assert.equal(rows[0]!.label, own.label);
    assert.equal(rows[1]!.label, "/Archive/2024");
});

test("a mark stored under Space shows as <Space>", async () => {
    assert.deepEqual(cells(await panel_of(["'"], { " ": { path: "/Sent" } })), [["<Space>", "/Sent"]]);
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
    await hud.track(1);
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
