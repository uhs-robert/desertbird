import assert from "node:assert/strict";
import { test } from "node:test";
import { check_hint } from "../../tools/owner_test/hints.ts";
import { SETTING_NAMES } from "../../src/background/config/settings.ts";

test("a valid hint passes for each kind of setting", () => {
  for (const hint of ["toast_ms 3000", "layout_fallback true", "which_key_border round", "which_key_skip a, b", "statusbar_widgets folder", "cmdline_prompt $"]) assert.equal(check_hint(hint).ok, true, hint);
});

test("an unknown name, a missing value and a bad value fail at once with the reason", () => {
  assert.match(JSON.stringify(check_hint("bogus 1")), /no setting named bogus/);
  assert.match(JSON.stringify(check_hint("toast_ms")), /expected a number/);
  assert.match(JSON.stringify(check_hint("toast_ms soon")), /expected a number/);
  assert.match(JSON.stringify(check_hint("which_key_border triangle")), /expected one of square, round, chamfer/);
  assert.match(JSON.stringify(check_hint("layout_fallback maybe")), /true or false/);
  assert.equal(check_hint("").ok, false);
});

test("the names come from the settings table, so a new setting is accepted with no edit here", () => {
  for (const name of SETTING_NAMES) assert.match(JSON.stringify(check_hint(`${name} x`)), /^(?!.*no setting named)/, name);
});

test("the old DesertFox form with :set is a typo here, because there is no :set command", () => {
  assert.equal(check_hint(":set toast_ms 3000").ok, false);
});

test("the value keeps its spaces, so a line setting is counted as the options page counts it", () => {
  assert.equal(check_hint("cmdline_prompt 12345678 ").ok, false, "nine characters with the trailing space");
  assert.equal(check_hint("cmdline_prompt 12345678").ok, true);
  assert.equal(check_hint("cmdline_prompt $ ").ok, true);
  assert.equal(check_hint("  toast_ms 3000").ok, true, "leading spaces before the name are dropped");
  assert.equal(check_hint("toast_ms   ").ok, false, "a blank number is no number");
  assert.equal(check_hint("cmdline_prompt   ").ok, true, "a prompt of spaces is valid for the options page");
  assert.equal(check_hint("which_key_skip ").ok, true, "an empty list is valid for the options page");
});
