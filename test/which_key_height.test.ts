import assert from "node:assert/strict";
import { test } from "node:test";
import { choose_columns } from "../vendor/desertfox/whichkey_layout.ts";
import { height_for_column_chooser } from "../src/overlay/which_key_height.ts";

// The hud box is 520 px high (`src/chrome/parent_overlay.ts`), so the body cap is 422 px and 16 rows fit.
const HUD_BOX_HEIGHT_PX = 520;

test("16 rows stay in one column and 17 rows split", () => {
    const height = height_for_column_chooser(HUD_BOX_HEIGHT_PX);
    assert.equal(choose_columns(16, height), 1);
    assert.equal(choose_columns(17, height), 2);
});

test("the root key list of 56 rows takes 4 columns of 14", () => {
    assert.equal(choose_columns(56, height_for_column_chooser(HUD_BOX_HEIGHT_PX)), 4);
});
