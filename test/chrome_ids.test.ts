import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { MOTION_IDS } from "../src/chrome/motions.ts";
import { run_scroll } from "../src/chrome/page_actions.ts";

// The runtime runs `repeat.last`, `visual.toggle`, `select.toggle` and `pane.resize_mode` itself, so they have no motion. The `page.*` commands have a reading action in the pages bundle instead, and the pages bundle runs `mode.insert` and `mode.escape` itself.
const chrome_ids = () => registry.list().filter((command) => command.runs_in === "chrome" && command.id !== "repeat.last" && command.id !== "visual.toggle" && command.id !== "select.toggle" && command.id !== "pane.resize_mode" && !command.id.startsWith("page.") && !command.id.startsWith("mode.")).map((command) => command.id).sort();

test("every chrome command in the registry has a motion", () => {
    assert.deepEqual(chrome_ids().filter((id) => !MOTION_IDS.includes(id as never)), []);
});

test("every motion has a chrome command in the registry", () => {
    assert.deepEqual([...MOTION_IDS].filter((id) => !chrome_ids().includes(id)), []);
});

test("every page command in the registry has a reading action, and so has each scroll of a message", () => {
    const page_ids = registry.list().filter((command) => command.id.startsWith("page.")).map((command) => command.id);
    assert.equal(page_ids.length, 10);
    for (const id of [...page_ids, "message.scroll_down", "message.scroll_up", "message.half_page_down", "message.half_page_up", "message.page_down", "message.page_up", "message.scroll_left", "message.scroll_right", "message.top", "message.bottom"]) assert.equal(run_scroll(id, null, 1), true, id);
    assert.equal(run_scroll("motion.down", null, 1), false);
});
