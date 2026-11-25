import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/overlay/hud.css", import.meta.url), "utf8");

test("a toast is drawn as in DesertFox: the theme radius, a frame in the color of its kind and a 4 px left bar", () => {
    assert.match(css, /#toasts > div \{[^}]*border: 1px solid var\(--info_edge\)[^}]*border-left-width: 4px[^}]*border-radius: var\(--desertfox-radius, 6px\)/);
    assert.match(css, /#toasts > div\.error \{ border-color: var\(--error_edge\)/);
    assert.match(css, /--info_edge: var\(--desertfox-info,/);
    assert.match(css, /--error_edge: var\(--desertfox-error,/);
});
