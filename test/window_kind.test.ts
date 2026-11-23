import assert from "node:assert/strict";
import { test } from "node:test";
import { window_kind_of } from "../src/chrome/platform.ts";
import type { MainWindow } from "../src/chrome/platform.ts";

const window_of = (windowtype: string | null | undefined, has_get_attribute = true) => ({ document: { documentElement: has_get_attribute ? { hasAttribute: () => false, getAttribute: (name: string) => (name === "windowtype" ? (windowtype ?? null) : null) } : null } }) as unknown as MainWindow;

test("a window is a main window or a message window by its window type", () => {
    assert.equal(window_kind_of(window_of("mail:3pane")), "main");
    assert.equal(window_kind_of(window_of("mail:messageWindow")), "message");
});

test("a compose window, a window of another type and a window with no type are never a message window, though none has a tab bar", () => {
    for (const type of ["msgcompose", "mail:addressbook", "navigator:browser", "", null, undefined]) assert.equal(window_kind_of(window_of(type)), "other", String(type));
    assert.equal(window_kind_of(window_of("mail:messageWindow", false)), "other", "a window with no root element yet");
});
