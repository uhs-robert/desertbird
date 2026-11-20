import assert from "node:assert/strict";
import { test } from "node:test";
import { ANY_KEY } from "../vendor/desertfox/prefix_tree.ts";
import type { TreeBranch, TreeNode } from "../vendor/desertfox/prefix_tree.ts";
import { RuntimeRefusal } from "../vendor/desertfox/command.ts";
import { compile_default_keymap } from "../src/background/commands/index.ts";
import { compile_tab_keymap, message_background_commands } from "../src/background/commands/tab_keymaps.ts";
import { clamp_zoom, zoom_by, zoom_set } from "../src/background/handlers/zoom.ts";
import { get_zoom_api } from "../src/chrome/parent_zoom.ts";
import type { ZoomApi } from "../src/shared/protocol.ts";
import { stub_platform } from "./chrome_stubs.ts";

// A window whose `getBrowser()` answers `browser`, with a ZoomManager that keeps one level per browser, as Thunderbird's does.
function zoom_window(browser: object | null) {
    const levels = new Map<object, number>();
    return {
        levels,
        window: {
            getBrowser: () => browser,
            ZoomManager: {
                getZoomForBrowser: (target: object) => levels.get(target) ?? 1,
                setZoomForBrowser: (target: object, level: number) => void levels.set(target, level),
            },
        },
    };
}

function api_for(windows: Map<number, object>) {
    const platform = stub_platform([...windows.values()]);
    const ids = new Map([...windows].map(([id, window]) => [window, id]));
    const api = get_zoom_api({ extension: { windowManager: { getWrapper: (window: unknown) => ({ id: ids.get(window as object)! }) }, messageManager: { convert: () => null } } } as never);
    return { ...api.zoom, restore: platform.restore };
}

test("the verbs read and set the zoom of the browser the window shows", async () => {
    const pane = {};
    const { window, levels } = zoom_window(pane);
    const { get, set, restore } = api_for(new Map([[3, window]]));
    assert.equal(await get({ windowId: 3 }), 1);
    assert.equal(await set({ windowId: 3, level: 1.5 }), true);
    assert.equal(levels.get(pane), 1.5);
    assert.equal(await get({ windowId: 3 }), 1.5);
    restore();
});

test("a window with no browser to zoom answers null and false and sets nothing", async () => {
    const { window, levels } = zoom_window(null);
    const { get, set, restore } = api_for(new Map([[3, window]]));
    assert.equal(await get({ windowId: 3 }), null);
    assert.equal(await set({ windowId: 3, level: 2 }), false);
    assert.equal(levels.size, 0);
    restore();
});

test("an unknown window id fails with the verb name", async () => {
    const { get, restore } = api_for(new Map([[3, zoom_window({}).window]]));
    await assert.rejects(get({ windowId: 9 }), /zoom\.get: no main or message window/);
    restore();
});

function scope_with(level: number | null, settable = true, count = 1) {
    const sets: number[] = [];
    const zoom: ZoomApi = {
        get: async () => level,
        set: async ({ level: to }) => (settable ? (sets.push(to), true) : false),
    };
    return { sets, scope: { api: { zoom }, window_id: 3, message_ids: [], count } };
}

test("zoom.by adds the step, a count multiplies it, and the level stays rounded within 0.3 and 5", async () => {
    for (const [from, delta, count, to] of [[1, 0.1, 1, 1.1], [1.1, 0.1, 1, 1.2], [1, 0.1, 3, 1.3], [1, -0.5, 1, 0.5], [0.4, -0.5, 1, 0.3], [4.8, 0.5, 1, 5]] as const) {
        const { sets, scope } = scope_with(from, true, count);
        await zoom_by(scope, { delta });
        assert.deepEqual(sets, [to], `${from} ${delta} x${count}`);
    }
});

test("zoom.set clamps the level, and both refuse where there is nothing to zoom", async () => {
    const { sets, scope } = scope_with(1);
    await zoom_set(scope, { level: 9 });
    assert.deepEqual(sets, [5]);
    await assert.rejects(zoom_by(scope_with(null).scope, { delta: 0.1 }), (error) => error instanceof RuntimeRefusal && /nothing to zoom/.test(error.message));
    await assert.rejects(zoom_set(scope_with(1, false).scope, { level: 1 }), RuntimeRefusal);
    assert.equal(clamp_zoom(1 + 0.1 + 0.1), 1.2);
});

test("a zoom-out step below the floor and a zoom-in step above the ceiling leave the level as it is", async () => {
    for (const [from, delta] of [[0.2, -0.1], [0.2, -0.5], [6, 0.1], [6, 0.5]] as const) {
        const { sets, scope } = scope_with(from);
        await zoom_by(scope, { delta });
        assert.deepEqual(sets, [], `${from} ${delta}`);
    }
    const { sets, scope } = scope_with(0.2);
    await zoom_by(scope, { delta: 0.1 });
    assert.deepEqual(sets, [0.3]);
});

test("two zoom steps fired together both count", async () => {
    let level = 1;
    // The Experiment answers after a turn of the event loop, as a real call does, so two unqueued steps would both read 1.
    const later = <T>(value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), 5));
    const zoom: ZoomApi = { get: () => later(() => level), set: ({ level: to }) => later(() => ((level = to), true)) };
    const scope = { api: { zoom }, window_id: 4, message_ids: [], count: 1 };
    await Promise.all([zoom_by(scope, { delta: 0.1 }), zoom_by(scope, { delta: 0.1 })]);
    assert.equal(level, 1.2);
});

test("a refused step does not stop the next one", async () => {
    const { scope } = scope_with(null);
    const refused = zoom_by({ ...scope, window_id: 5 }, { delta: 0.1 });
    const { sets, scope: next } = scope_with(1);
    const followed = zoom_by({ ...next, window_id: 5 }, { delta: 0.1 });
    await assert.rejects(refused, RuntimeRefusal);
    await followed;
    assert.deepEqual(sets, [1.1]);
});

function leaf_at(root: TreeBranch, ...tokens: string[]): { id: string; args?: unknown } | undefined {
    let node: TreeNode | undefined = root;
    for (const token of tokens) node = node?.kind === "branch" ? node.children[token] : undefined;
    return node?.kind === "leaf" ? (node.steps[0]?.invocation as { id: string; args?: unknown }) : undefined;
}

const ZOOM_KEYS: [string, string, Record<string, number>][] = [
    ["i", "zoom.by", { delta: 0.1 }],
    ["+", "zoom.by", { delta: 0.1 }],
    ["o", "zoom.by", { delta: -0.1 }],
    ["-", "zoom.by", { delta: -0.1 }],
    ["m", "zoom.by", { delta: 0.5 }],
    ["r", "zoom.by", { delta: -0.5 }],
    ["=", "zoom.set", { level: 1 }],
    ["I", "zoom.set", { level: 3 }],
    ["O", "zoom.set", { level: 0.3 }],
];

test("every tree binds the zoom keys, and the mail tab keeps zM and zR as thread folds", () => {
    const mail = compile_default_keymap().compiled.modes.normal as TreeBranch;
    const trees = { mail, message: compile_tab_keymap("message").compiled.modes.normal as TreeBranch, own: compile_tab_keymap("own").compiled.modes.normal as TreeBranch, page: compile_tab_keymap("page").compiled.modes.normal as TreeBranch };
    for (const [name, root] of Object.entries(trees)) for (const [key, id, args] of ZOOM_KEYS) assert.deepEqual(leaf_at(root, "z", key), { id, args }, `${name} z${key}`);
    assert.equal(leaf_at(mail, "z", "M")?.id, "thread.fold_all");
    assert.equal(leaf_at(mail, "z", "R")?.id, "thread.fold_all");
});

test("an unbound key after z runs nothing in a body tree, beside the zoom keys", () => {
    for (const kind of ["message", "own"] as const) {
        const zoom_branch = (compile_tab_keymap(kind).compiled.modes.normal as TreeBranch).children["z"] as TreeBranch;
        assert.deepEqual(zoom_branch.children[ANY_KEY], { kind: "leaf", steps: [] }, kind);
    }
});

test("a message document and an own page may ask the background for both zoom commands", () => {
    const allowed = message_background_commands();
    assert.ok(allowed.has("zoom.by") && allowed.has("zoom.set"));
});
