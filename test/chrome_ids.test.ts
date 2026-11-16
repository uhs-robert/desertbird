import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/registry.ts";
import { MOTION_IDS } from "../src/chrome/motions.ts";

const chrome_ids = () => registry.list().filter((command) => command.runs_in === "chrome").map((command) => command.id).sort();

test("every chrome command in the registry has a motion", () => {
    assert.deepEqual(chrome_ids().filter((id) => !MOTION_IDS.includes(id as never)), []);
});

test("every motion has a chrome command in the registry", () => {
    assert.deepEqual([...MOTION_IDS].filter((id) => !chrome_ids().includes(id)), []);
});
