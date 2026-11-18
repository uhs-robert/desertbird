import assert from "node:assert/strict";
import { test } from "node:test";
import { branch_at, may_open_by_itself, which_key_panel } from "../src/background/hud/which_key.ts";
import { sample_root, settings_with } from "./hud_fakes.ts";

test("the panel lists the keys that follow the typed keys, leaves by label and groups by name or count", () => {
    const panel = which_key_panel(sample_root(), ["g"], settings_with({}));
    assert.deepEqual(panel?.rows, [
        { key: "g", label: "First row", is_group: false },
        { key: "u", label: "2 keys", is_group: true },
    ]);
    assert.equal(panel?.title, "g");
});

test("a group with a name shows the name", () => {
    const panel = which_key_panel({ kind: "branch", children: { g: sample_root().children["g"]! } }, [], settings_with({}));
    assert.deepEqual(panel?.rows, [{ key: "g", label: "Go", is_group: true }]);
});

test("the panel follows a longer sequence down the tree", () => {
    const panel = which_key_panel(sample_root(), ["g", "u"], settings_with({}));
    assert.deepEqual(panel?.rows.map((row) => row.key), ["a", "b"]);
    assert.equal(panel?.title, "g u");
});

test("typed keys that lead to a leaf or nowhere have no panel", () => {
    assert.equal(which_key_panel(sample_root(), ["j"], settings_with({})), null);
    assert.equal(which_key_panel(sample_root(), ["z"], settings_with({})), null);
    assert.equal(branch_at(sample_root(), ["g", "g"]), null);
});

test("the border comes from the setting", () => {
    for (const border of ["square", "round", "chamfer"] as const) assert.equal(which_key_panel(sample_root(), ["d"], settings_with({ which_key_border: border }))?.border, border);
});

test("a delay of zero turns the panel off", () => {
    assert.equal(may_open_by_itself(settings_with({ which_key_delay_ms: 0 }), ["g"], false), false);
    assert.equal(may_open_by_itself(settings_with({ which_key_delay_ms: 0 }), ["g"], true), false);
});

test("a sequence in the skip list opens no panel by itself, but a panel already up redraws", () => {
    const settings = settings_with({ which_key_skip: ["g", "gu"] });
    assert.equal(may_open_by_itself(settings, ["g"], false), false);
    assert.equal(may_open_by_itself(settings, ["g", "u"], false), false);
    assert.equal(may_open_by_itself(settings, ["g", "u"], true), true);
    assert.equal(may_open_by_itself(settings, ["d"], false), true);
});

test("a skip entry covers only its exact sequence", () => {
    assert.equal(may_open_by_itself(settings_with({ which_key_skip: ["g"] }), ["g", "u"], false), true);
});

test("the root list puts the groups first and lists every key, however many", () => {
    const children = Object.fromEntries(Array.from({ length: 40 }, (_, at) => [`k${at}`, { kind: "leaf" as const, label: `Key ${at}`, steps: [] }]));
    const root = { kind: "branch" as const, children: { ...children, ...sample_root().children } };
    const panel = which_key_panel(root, [], settings_with({}));
    assert.equal(panel?.rows.length, 43);
    assert.deepEqual(panel?.rows.slice(0, 2).map((row) => row.is_group), [true, true]);
    assert.equal(panel?.rows.slice(2).some((row) => row.is_group), false);
});
