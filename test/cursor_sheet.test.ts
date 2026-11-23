import assert from "node:assert/strict";
import { test } from "node:test";
import { stub_platform } from "./chrome_stubs.ts";

test("the overlay API registers the cursor sheet once for the thread list, and shutdown removes it", async () => {
    const stub = stub_platform();
    try {
        const overlay_parent = await import("../src/chrome/parent_overlay.ts");
        const context = { extension: { baseURI: { resolve: (path: string) => path } } };
        overlay_parent.get_overlay_api(context as never);
        overlay_parent.get_overlay_api(context as never);
        assert.equal(stub.sheets.length, 1);
        const css = decodeURIComponent(stub.sheets[0]!.replace(/^data:text\/css,/, ""));
        assert.match(css, /@-moz-document url\("about:3pane"\)/);
        assert.match(css, /\.current \{ outline: 2px solid CanvasText !important;/);
        overlay_parent.shutdown();
        assert.deepEqual(stub.sheets, []);
    } finally {
        stub.restore();
    }
});
