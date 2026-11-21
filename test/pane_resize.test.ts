import assert from "node:assert/strict";
import { test } from "node:test";
import { app_verbs } from "../src/chrome/app_verbs.ts";
import type { PaneResizeDirection } from "../src/shared/protocol.ts";
import { stub_platform } from "./chrome_stubs.ts";

interface Rect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

type Layout = "classic" | "wide" | "vertical" | "widethread" | "stacked" | "horizontal";

// A 1000 by 800 about:3pane. Each splitter is 4 pixels thick and its `resizeElement` is the pane it sizes, as the layouts of Thunderbird set them.
const LAYOUTS: Record<Layout, { boxes: Record<string, Rect>; splitters: Record<"folder" | "message", { box: Rect; direction: "horizontal" | "vertical"; resizes: string; attributes: Record<string, string> }> }> = {
    classic: {
        boxes: { folderPane: rect(0, 0, 200, 800), threadPane: rect(204, 0, 1000, 400), messagePane: rect(204, 404, 1000, 800) },
        splitters: {
            folder: { box: rect(200, 0, 204, 800), direction: "horizontal", resizes: "folderPane", attributes: { "collapse-width": "100" } },
            message: { box: rect(204, 400, 1000, 404), direction: "vertical", resizes: "messagePane", attributes: { "collapse-width": "200", "collapse-height": "100" } },
        },
    },
    vertical: {
        boxes: { folderPane: rect(0, 0, 200, 800), threadPane: rect(204, 0, 600, 800), messagePane: rect(604, 0, 1000, 800) },
        splitters: {
            folder: { box: rect(200, 0, 204, 800), direction: "horizontal", resizes: "folderPane", attributes: { "collapse-width": "100" } },
            message: { box: rect(600, 0, 604, 800), direction: "horizontal", resizes: "messagePane", attributes: { "collapse-width": "200", "collapse-height": "100" } },
        },
    },
    wide: {
        boxes: { folderPane: rect(0, 0, 200, 400), threadPane: rect(204, 0, 1000, 400), messagePane: rect(0, 404, 1000, 800) },
        splitters: {
            folder: { box: rect(200, 0, 204, 400), direction: "horizontal", resizes: "folderPane", attributes: { "collapse-width": "100" } },
            message: { box: rect(0, 400, 1000, 404), direction: "vertical", resizes: "messagePane", attributes: { "collapse-width": "200", "collapse-height": "100" } },
        },
    },
    widethread: {
        boxes: { threadPane: rect(0, 0, 1000, 400), folderPane: rect(0, 404, 200, 800), messagePane: rect(204, 404, 1000, 800) },
        splitters: {
            folder: { box: rect(200, 404, 204, 800), direction: "horizontal", resizes: "folderPane", attributes: { "collapse-width": "100" } },
            message: { box: rect(0, 400, 1000, 404), direction: "vertical", resizes: "messagePane", attributes: { "collapse-width": "200", "collapse-height": "100" } },
        },
    },
    stacked: {
        boxes: { folderPane: rect(0, 0, 496, 300), threadPane: rect(0, 304, 496, 800), messagePane: rect(500, 0, 1000, 800) },
        splitters: {
            folder: { box: rect(0, 300, 496, 304), direction: "vertical", resizes: "folderPane", attributes: { "collapse-height": "100" } },
            message: { box: rect(496, 0, 500, 800), direction: "horizontal", resizes: "messagePane", attributes: { "collapse-width": "200", "collapse-height": "100" } },
        },
    },
    horizontal: {
        boxes: { folderPane: rect(0, 0, 1000, 150), threadPane: rect(0, 154, 1000, 400), messagePane: rect(0, 404, 1000, 800) },
        splitters: {
            folder: { box: rect(0, 150, 1000, 154), direction: "vertical", resizes: "folderPane", attributes: { "collapse-height": "100" } },
            message: { box: rect(0, 400, 1000, 404), direction: "vertical", resizes: "messagePane", attributes: { "collapse-height": "100" } },
        },
    },
};

const PANE_ORDER = ["folders", "threads", "message"] as const;

interface Options {
    layout?: Layout;
    focus?: (typeof PANE_ORDER)[number];
    collapsed?: "folderPane" | "messagePane" | null;
    disabled_folder?: boolean;
    /** A splitter is 5 pixels thick and takes 1 pixel of layout, so it overlaps the pane next to its own by 4 pixels. */
    real_edges?: boolean;
    /** Whether the fake grid holds a request to the minimum. Thunderbird's grid takes a negative request as invalid, so a test of the request itself turns this off. */
    clamp?: boolean;
}

function mail_window({ layout = "classic", focus = "threads", collapsed = null, disabled_folder = false, real_edges = false, clamp = true }: Options = {}) {
    const spec = LAYOUTS[layout];
    const boxes = Object.fromEntries(Object.entries(spec.boxes).map(([id, box]) => [id, { ...box }]));
    const elements = Object.fromEntries(Object.keys(boxes).map((id) => [id, { getBoundingClientRect: () => (collapsed === id ? rect(0, 0, 0, 0) : boxes[id]!) }]));
    const events: string[] = [];
    const sizes: string[] = [];
    // The grid gives a pane what it asks for, at least 100 pixels, less what would leave the thread list under 100 pixels. The pane grows on its far edge and the thread list gives the room.
    const lay_out = (resizes: string, along_x: boolean, asked: number | null) => {
        if (asked === null) return;
        const [lo, hi] = along_x ? (["left", "right"] as const) : (["top", "bottom"] as const);
        const pane = boxes[resizes]!;
        const threads = boxes["threadPane"]!;
        const spare = threads[hi] - threads[lo] - 100;
        pane[hi] = pane[lo] + (clamp ? Math.max(100, Math.min(asked, pane[hi] - pane[lo] + spare)) : asked);
    };
    const splitter_of = (id: string, name: "folder" | "message") => {
        const entry = spec.splitters[name];
        const box = { ...entry.box };
        if (real_edges) {
            const along_x = entry.direction === "horizontal";
            const [lo, hi] = along_x ? (["left", "right"] as const) : (["top", "bottom"] as const);
            if (spec.boxes[entry.resizes]![lo] >= box[hi]) box[lo] -= 4;
            else box[hi] += 4;
        }
        const splitter = {
            id,
            resizeDirection: entry.direction,
            resizeElement: elements[entry.resizes]!,
            isCollapsed: collapsed === entry.resizes,
            isDisabled: name === "folder" && disabled_folder,
            _width: null as number | null,
            _height: null as number | null,
            get width() {
                return this._width;
            },
            set width(value: number | null) {
                this._width = value;
                lay_out(entry.resizes, true, value);
                sizes.push(`${name} width ${value}`);
            },
            get height() {
                return this._height;
            },
            set height(value: number | null) {
                this._height = value;
                lay_out(entry.resizes, false, value);
                sizes.push(`${name} height ${value}`);
            },
            getAttribute: (attribute: string) => entry.attributes[attribute] ?? null,
            getBoundingClientRect: () => box,
            dispatchEvent: (event: unknown) => (events.push(`${name} ${(event as { type: string }).type}`), true),
        };
        return splitter;
    };
    const about_3pane = {
        paneLayout: { folderPaneSplitter: splitter_of("folderPaneSplitter", "folder"), messagePaneSplitter: splitter_of("messagePaneSplitter", "message"), folderPaneVisible: collapsed !== "folderPane", messagePaneVisible: collapsed !== "messagePane" },
        document: { getElementById: (id: string) => elements[id] ?? null },
        CustomEvent: class {
            type: string;
            constructor(type: string) {
                this.type = type;
            }
        },
        browsingContext: { topChromeWindow: {} as unknown },
    };
    const node_of = { folders: { id: "folderTree" }, threads: { localName: "tbody" }, message: { id: "messageBrowser" } }[focus];
    const document = {
        activeElement: { localName: "browser", contentDocument: { activeElement: node_of } },
        getElementById: () => ({ currentTabInfo: { mode: { name: "mail3PaneTab" }, chromeBrowser: { contentWindow: about_3pane } } }),
        hasFocus: () => true,
    };
    about_3pane.browsingContext.topChromeWindow = { document };
    return { window: { document, addEventListener() {}, removeEventListener() {} }, events, sizes, splitters: about_3pane.paneLayout };
}

function verbs(window: unknown) {
    const platform = stub_platform([window]);
    const removed: string[] = [];
    (globalThis as unknown as { Services: object }).Services = { ...(globalThis as unknown as { Services: object }).Services, xulStore: { removeValue: (url: string, element: string, attribute: string) => removed.push(`${url} ${element} ${attribute}`) } };
    const app = app_verbs({ extension: { windowManager: { getWrapper: () => ({ id: 1 }) }, messageManager: { convert: () => null } } });
    return { resize: (direction: PaneResizeDirection, steps = 1) => app.paneResize({ windowId: 1, direction, steps }), removed, restore: platform.restore };
}

async function press(options: Options, direction: PaneResizeDirection, steps = 1) {
    const mail = mail_window(options);
    const { resize, removed, restore } = verbs(mail.window);
    const answer = await resize(direction, steps);
    restore();
    // A move sets a size, reads what the grid gave, and sets that. The last write of each property is the stored size.
    const sizes = [...new Map(mail.sizes.map((entry) => [entry.split(" ").slice(0, 2).join(" "), entry])).values()];
    return { answer, sizes, events: mail.events, removed };
}

// Each row: the layout, the focused pane, the key and what it does. A border moves by direction, so a pane on the right side grows when its border goes left.
const CELLS: [Layout, NonNullable<Options["focus"]>, PaneResizeDirection, string[]][] = [
    ["classic", "folders", "right", ["folder width 224"]],
    ["classic", "folders", "left", ["folder width 176"]],
    ["classic", "threads", "left", ["folder width 176"]],
    ["classic", "threads", "down", ["message height 372"]],
    ["classic", "threads", "up", ["message height 420"]],
    ["classic", "message", "up", ["message height 420"]],
    ["classic", "message", "down", ["message height 372"]],
    ["classic", "message", "left", ["folder width 176"]],
    ["classic", "message", "right", ["folder width 224"]],
    ["wide", "folders", "right", ["folder width 224"]],
    ["wide", "folders", "down", ["message height 372"]],
    ["wide", "folders", "up", ["message height 420"]],
    ["wide", "threads", "left", ["folder width 176"]],
    ["wide", "threads", "down", ["message height 372"]],
    ["wide", "message", "up", ["message height 420"]],
    ["widethread", "folders", "right", ["folder width 224"]],
    ["widethread", "folders", "down", ["message height 372"]],
    ["widethread", "threads", "up", ["message height 420"]],
    ["widethread", "message", "left", ["folder width 176"]],
    ["widethread", "message", "down", ["message height 372"]],
    ["stacked", "folders", "down", ["folder height 324"]],
    ["stacked", "folders", "right", ["message width 476"]],
    ["stacked", "threads", "down", ["folder height 324"]],
    ["stacked", "threads", "left", ["message width 524"]],
    ["stacked", "message", "right", ["message width 476"]],
    ["stacked", "message", "left", ["message width 524"]],
    ["vertical", "folders", "right", ["folder width 224"]],
    ["vertical", "threads", "right", ["message width 372"]],
    ["vertical", "threads", "left", ["message width 420"]],
    ["vertical", "message", "left", ["message width 420"]],
    ["vertical", "message", "right", ["message width 372"]],
    ["horizontal", "folders", "down", ["folder height 174"]],
    ["horizontal", "threads", "down", ["message height 372"]],
    ["horizontal", "message", "up", ["message height 420"]],
];

test("each key moves the border of the focused pane by direction, in each layout, with splitters that overlap their neighbor as they do on screen", async () => {
    for (const real_edges of [false, true]) {
        for (const [layout, focus, direction, sizes] of CELLS) {
            const result = await press({ layout, focus, real_edges }, direction);
            assert.equal(result.answer, true, `${layout} ${focus} ${direction} ${real_edges}`);
            assert.deepEqual(result.sizes, sizes, `${layout} ${focus} ${direction} ${real_edges}`);
        }
    }
});

test("a move fires splitter-resized once on the splitter, which is what stores the size", async () => {
    const result = await press({}, "right");
    assert.deepEqual(result.events, ["folder splitter-resized"]);
});

test("a count multiplies the step", async () => {
    assert.deepEqual((await press({ focus: "folders" }, "right", 3)).sizes, ["folder width 272"]);
});

test("an axis with no border for the pane refuses and changes nothing", async () => {
    for (const real_edges of [false, true]) for (const [layout, focus, direction] of [["classic", "folders", "down"], ["widethread", "threads", "left"], ["widethread", "threads", "right"], ["wide", "message", "left"], ["stacked", "message", "up"], ["vertical", "threads", "down"], ["vertical", "message", "up"], ["horizontal", "folders", "right"], ["horizontal", "message", "left"]] as const) {
        const result = await press({ layout, focus, real_edges }, direction);
        assert.equal(result.answer, false, `${layout} ${focus} ${direction} ${real_edges}`);
        assert.deepEqual([result.sizes, result.events], [[], []], `${layout} ${focus} ${direction} ${real_edges}`);
    }
});

test("a count larger than the pane never writes a negative size", async () => {
    const result = await press({ focus: "folders", clamp: false }, "left", 20);
    assert.deepEqual(result.sizes, ["folder width 0"]);
});

test("a pane stops at the grid minimum and stores that size, so a key never collapses it", async () => {
    const shrunk = await press({ focus: "folders" }, "left", 100);
    assert.deepEqual(shrunk.sizes, ["folder width 100"]);
    const message_shrunk = await press({ focus: "message" }, "down", 100);
    assert.deepEqual(message_shrunk.sizes, ["message height 100"]);
});

test("a pane asks for more than the grid gives and stores what the grid gave, and the stop answers true", async () => {
    const grown = await press({ focus: "folders" }, "right", 100);
    assert.deepEqual(grown.sizes, [`folder width ${200 + 796 - 100}`]);
    const message = await press({ focus: "message" }, "up", 100);
    assert.equal(message.answer, true);
    assert.deepEqual(message.sizes, [`message height ${396 + 400 - 100}`]);
});

test("a collapsed pane, or a disabled splitter, refuses and changes nothing", async () => {
    for (const options of [{ focus: "folders", collapsed: "folderPane" }, { focus: "message", collapsed: "messagePane" }, { focus: "folders", disabled_folder: true }, { focus: "threads", collapsed: "folderPane" }] as const) {
        const result = await press(options, options.focus === "message" ? "up" : "right");
        assert.equal(result.answer, false, JSON.stringify(options));
        assert.deepEqual([result.sizes, result.events], [[], []], JSON.stringify(options));
    }
});

test("reset empties both splitters and removes the stored sizes without firing splitter-resized", async () => {
    const result = await press({}, "reset");
    assert.equal(result.answer, true);
    assert.deepEqual([...result.sizes].sort(), ["folder height null", "folder width null", "message height null", "message width null"]);
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.removed, [
        "chrome://messenger/content/messenger.xhtml folderPaneBox width",
        "chrome://messenger/content/messenger.xhtml folderPaneBox height",
        "chrome://messenger/content/messenger.xhtml messagepaneboxwrapper width",
        "chrome://messenger/content/messenger.xhtml messagepaneboxwrapper height",
    ]);
});

test("reset with a pane collapsed still only clears values", async () => {
    const result = await press({ collapsed: "messagePane" }, "reset");
    assert.equal(result.answer, true);
    assert.deepEqual(result.events, []);
});
