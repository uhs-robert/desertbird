import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { POPUP_KEYS, action_for_key, next_index } from "../src/popup/keys.ts";

const plain = (key: string) => ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false });

test("each popup button has a key, no key repeats, and the key cap shows it", () => {
    const html = readFileSync(new URL("../src/popup/popup.html", import.meta.url), "utf8");
    const buttons = [...html.matchAll(/data-command="([^"]+)"><span>[^<]+<\/span><kbd>([^<]+)<\/kbd>/g)].map((match) => ({ command: match[1], key: match[2] }));
    assert.deepEqual(buttons, POPUP_KEYS.map(({ command, key }) => ({ command, key })));
    assert.equal(new Set(POPUP_KEYS.map(({ key }) => key)).size, POPUP_KEYS.length);
});

test("o and h press Options and Help, j k and the arrows move, other keys do nothing", () => {
    assert.deepEqual(action_for_key(plain("o")), { kind: "press", command: "options.open" });
    assert.deepEqual(action_for_key(plain("h")), { kind: "press", command: "help.open" });
    for (const key of ["j", "ArrowDown"]) assert.deepEqual(action_for_key(plain(key)), { kind: "move", step: 1 });
    for (const key of ["k", "ArrowUp"]) assert.deepEqual(action_for_key(plain(key)), { kind: "move", step: -1 });
    for (const key of ["Enter", " ", "Escape", "Tab", "x"]) assert.deepEqual(action_for_key(plain(key)), { kind: "none" });
});

test("a chord or a held key does nothing", () => {
    for (const flag of ["ctrlKey", "altKey", "metaKey", "repeat"]) assert.deepEqual(action_for_key({ ...plain("o"), [flag]: true }), { kind: "none" });
});

test("moving stops at both ends and starts at the first item when none has focus", () => {
    assert.equal(next_index(0, 1, 2), 1);
    assert.equal(next_index(1, 1, 2), 1);
    assert.equal(next_index(0, -1, 2), 0);
    assert.equal(next_index(-1, 1, 2), 0);
    assert.equal(next_index(-1, -1, 2), 0);
});
