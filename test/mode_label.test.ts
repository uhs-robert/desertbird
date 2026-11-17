import assert from "node:assert/strict";
import { test } from "node:test";
import { create_mode_label, label_look, label_shows } from "../src/chrome/mode_label.ts";
import type { LabelElement, StatusBarDocument } from "../src/chrome/mode_label.ts";

const DARK = { normal: "#aaaa11", visual: "#bb6622", insert: "#cc3333", on_badge: "#111111" };
const LIGHT = { normal: "#555500", visual: "#663300", insert: "#770000", on_badge: "#eeeeee" };
const COLORS = { dark: DARK, light: LIGHT };

class FakeLabel implements LabelElement {
    style = { cssText: "" };
    className = "";
    attributes: Record<string, string> = {};
    bar: FakeBar;
    constructor(bar: FakeBar) {
        this.bar = bar;
    }
    setAttribute(name: string, value: string) {
        this.attributes[name] = value;
    }
    remove() {
        this.bar.labels_in.splice(this.bar.labels_in.indexOf(this), 1);
    }
}

class FakeBar implements StatusBarDocument {
    labels_in: FakeLabel[] = [];
    has_status_bar = true;
    created = 0;
    labels = () => [...this.labels_in];
    create_label() {
        this.created++;
        return new FakeLabel(this);
    }
    insert_first(label: LabelElement) {
        if (this.has_status_bar) this.labels_in.unshift(label as FakeLabel);
        return this.has_status_bar;
    }
}

function setup() {
    const windows = new Map([[1, new FakeBar()], [2, new FakeBar()]]);
    const focus_listeners = new Map<FakeBar, Set<() => void>>();
    const typing = new Set<FakeBar>();
    const dark = new Set<FakeBar>();
    const scheme_listeners = new Map<FakeBar, Set<() => void>>();
    const loaded_listeners: (() => void)[] = [];
    const label = create_mode_label<FakeBar>({
        window_with_id: (id) => windows.get(id) ?? null,
        open_windows: () => [...windows.values()],
        status_bar_of: (bar) => bar,
        in_text_field: (bar) => typing.has(bar),
        on_loaded: (bar, listener) => bar.has_status_bar || loaded_listeners.push(listener),
        on_focus_change(bar, listener) {
            focus_listeners.set(bar, (focus_listeners.get(bar) ?? new Set()).add(listener));
            return () => void focus_listeners.get(bar)?.delete(listener);
        },
        is_dark: (bar) => dark.has(bar),
        on_scheme_change(bar, listener) {
            scheme_listeners.set(bar, (scheme_listeners.get(bar) ?? new Set()).add(listener));
            return () => void scheme_listeners.get(bar)?.delete(listener);
        },
    });
    /** Switches the Thunderbird scheme of the window and fires the change event. */
    const set_dark = (window_id: number, is_dark: boolean) => {
        const bar = windows.get(window_id)!;
        if (is_dark) dark.add(bar);
        else dark.delete(bar);
        for (const listener of [...(scheme_listeners.get(bar) ?? [])]) listener();
    };
    /** Moves focus into or out of a text field of the window and fires the focus event. */
    const move_focus = (window_id: number, into_text_field: boolean) => {
        const bar = windows.get(window_id)!;
        if (into_text_field) typing.add(bar);
        else typing.delete(bar);
        for (const listener of [...(focus_listeners.get(bar) ?? [])]) listener();
    };
    return { windows, label, move_focus, set_dark, scheme_listeners, loaded_listeners, listeners: (window_id: number) => focus_listeners.get(windows.get(window_id)!)?.size ?? 0 };
}
const always = { indicator: "always", style: "classic", colors: COLORS } as const;

test("the label text is the mode in each style", () => {
    assert.equal(label_look("normal", "classic", DARK).text, "-- NORMAL --");
    assert.equal(label_look("visual", "classic", DARK).text, "-- VISUAL --");
    assert.equal(label_look("insert", "badge", DARK).text, "INSERT");
});

test("each mode has its own color, and the badge fills with it while classic colors the text", () => {
    const colors = (["normal", "visual", "insert"] as const).map((mode) => label_look(mode, "classic", DARK).css.match(/color: (#[0-9a-f]{6})/)?.[1]);
    assert.deepEqual(colors, [DARK.normal, DARK.visual, DARK.insert]);
    const badge = label_look("visual", "badge", DARK).css;
    assert.match(badge, new RegExp(`background-color: ${DARK.visual}`));
    assert.match(badge, new RegExp(`; color: ${DARK.on_badge};`));
    assert.doesNotMatch(label_look("visual", "classic", DARK).css, /background-color/);
});

test("the label takes the scheme Thunderbird shows in its window, and redraws when that scheme changes", () => {
    const { windows, label, set_dark } = setup();
    label.set({ windowId: 1, mode: "normal", ...always });
    const [only] = windows.get(1)!.labels_in;
    assert.match(only!.style.cssText, new RegExp(`color: ${LIGHT.normal}`));
    set_dark(1, true);
    assert.match(only!.style.cssText, new RegExp(`color: ${DARK.normal}`));
    set_dark(1, false);
    assert.match(only!.style.cssText, new RegExp(`color: ${LIGHT.normal}`));
});

test("a color that is not #rrggbb is refused before it reaches a style", () => {
    const { label } = setup();
    const bad = { ...COLORS, dark: { ...DARK, normal: "red; position: fixed" } };
    assert.throws(() => label.set({ windowId: 1, mode: "normal", indicator: "always", style: "classic", colors: bad }), /normal color must be #rrggbb/);
    assert.throws(() => label.set({ windowId: 1, mode: "normal", indicator: "always", style: "classic" } as never), /must be #rrggbb/);
});

test("a first call puts one label at the start of the status bar, and later calls reuse it", () => {
    const { windows, label } = setup();
    label.set({ windowId: 1, mode: "normal", indicator: "always", style: "classic", colors: COLORS });
    label.set({ windowId: 1, mode: "visual", indicator: "always", style: "classic", colors: COLORS });
    const bar = windows.get(1)!;
    assert.equal(bar.labels_in.length, 1);
    assert.equal(bar.created, 1);
    assert.equal(bar.labels_in[0]!.attributes["value"], "-- VISUAL --");
    assert.equal(windows.get(2)!.labels_in.length, 0, "another window is untouched");
});

test("a style change restyles the same label", () => {
    const { windows, label } = setup();
    label.set({ windowId: 1, mode: "normal", indicator: "always", style: "classic", colors: COLORS });
    label.set({ windowId: 1, mode: "normal", indicator: "always", style: "badge", colors: COLORS });
    const [only] = windows.get(1)!.labels_in;
    assert.equal(windows.get(1)!.labels_in.length, 1);
    assert.equal(only!.attributes["value"], "NORMAL");
    assert.match(only!.style.cssText, /border-radius/);
});

test("the off indicator removes the label, and removing again is harmless", () => {
    const { windows, label } = setup();
    label.set({ windowId: 1, mode: "normal", indicator: "always", style: "classic", colors: COLORS });
    label.set({ windowId: 1, mode: "normal", indicator: "off", style: "classic", colors: COLORS });
    label.set({ windowId: 1, mode: "normal", indicator: "off", style: "classic", colors: COLORS });
    assert.equal(windows.get(1)!.labels_in.length, 0);
});

test("a label an earlier instance left behind is reused and its duplicates are removed, so a reload leaves one label", () => {
    const { windows, label } = setup();
    const bar = windows.get(1)!;
    bar.labels_in.push(new FakeLabel(bar), new FakeLabel(bar), new FakeLabel(bar));
    const old = bar.labels_in[0];
    label.set({ windowId: 1, mode: "visual", indicator: "always", style: "badge", colors: COLORS });
    assert.deepEqual(bar.labels_in, [old]);
    assert.equal(old!.attributes["value"], "VISUAL");
    assert.equal(bar.created, 0);
});

test("a window that opened before the add-on started gets its label on the first call", () => {
    const { windows, label } = setup();
    label.set({ windowId: 2, mode: "normal", indicator: "always", style: "classic", colors: COLORS });
    assert.equal(windows.get(2)!.labels_in.length, 1);
});

test("shutdown removes the label from every window, even one this instance never touched", () => {
    const { windows, label } = setup();
    for (const bar of windows.values()) bar.labels_in.push(new FakeLabel(bar), new FakeLabel(bar));
    label.shutdown();
    assert.deepEqual([...windows.values()].map((bar) => bar.labels_in.length), [0, 0]);
});

test("a window that has no status bar yet gets its label when it finishes loading", () => {
    const { windows, label, loaded_listeners } = setup();
    const bar = windows.get(1)!;
    bar.has_status_bar = false;
    label.set({ windowId: 1, mode: "normal", indicator: "always", style: "classic", colors: COLORS });
    assert.equal(bar.labels_in.length, 0);
    bar.has_status_bar = true;
    loaded_listeners.forEach((listener) => listener());
    assert.equal(bar.labels_in[0]!.attributes["value"], "-- NORMAL --");
});

test("a window that loads after the label was turned off gets none", () => {
    const { windows, label, loaded_listeners } = setup();
    const bar = windows.get(1)!;
    bar.has_status_bar = false;
    label.set({ windowId: 1, mode: "normal", indicator: "always", style: "classic", colors: COLORS });
    label.set({ windowId: 1, mode: "normal", indicator: "off", style: "classic", colors: COLORS });
    bar.has_status_bar = true;
    loaded_listeners.forEach((listener) => listener());
    assert.equal(bar.labels_in.length, 0);
});

test("a window with no id is refused with a message", () => {
    const { label } = setup();
    assert.throws(() => label.set({ windowId: 9, mode: "normal", indicator: "always", style: "classic", colors: COLORS }), /no main window has id 9/);
});

test("insert mode: the label reads INSERT while a text field has focus and goes back after", () => {
    const { windows, label, move_focus } = setup();
    label.set({ windowId: 1, mode: "normal", ...always });
    move_focus(1, true);
    assert.equal(windows.get(1)!.labels_in[0]!.attributes["value"], "-- INSERT --");
    move_focus(1, false);
    assert.equal(windows.get(1)!.labels_in[0]!.attributes["value"], "-- NORMAL --");
});

test("insert mode wins over visual, and visual shows again after the field", () => {
    const { windows, label, move_focus } = setup();
    label.set({ windowId: 1, mode: "visual", ...always });
    move_focus(1, true);
    assert.equal(windows.get(1)!.labels_in[0]!.attributes["value"], "-- INSERT --");
    move_focus(1, false);
    assert.equal(windows.get(1)!.labels_in[0]!.attributes["value"], "-- VISUAL --");
});

test("not_normal hides the label in normal mode and shows it for visual and for insert", () => {
    const { windows, label, move_focus } = setup();
    const not_normal = { indicator: "not_normal", style: "classic", colors: COLORS } as const;
    label.set({ windowId: 1, mode: "normal", ...not_normal });
    assert.equal(windows.get(1)!.labels_in.length, 0);
    move_focus(1, true);
    assert.equal(windows.get(1)!.labels_in[0]!.attributes["value"], "-- INSERT --");
    move_focus(1, false);
    assert.equal(windows.get(1)!.labels_in.length, 0);
    label.set({ windowId: 1, mode: "visual", ...not_normal });
    assert.equal(windows.get(1)!.labels_in[0]!.attributes["value"], "-- VISUAL --");
});

test("label_shows applies the indicator to the mode", () => {
    assert.equal(label_shows("always", "normal"), true);
    assert.equal(label_shows("not_normal", "normal"), false);
    assert.equal(label_shows("not_normal", "insert"), true);
    assert.equal(label_shows("off", "insert"), false);
});

test("the off indicator stops listening to focus, a second set adds no second listener, and shutdown stops all", () => {
    const { label, listeners, move_focus, windows, scheme_listeners } = setup();
    label.set({ windowId: 1, mode: "normal", ...always });
    label.set({ windowId: 1, mode: "visual", ...always });
    assert.equal(listeners(1), 1);
    label.set({ windowId: 1, mode: "visual", indicator: "off", style: "classic", colors: COLORS });
    assert.equal(listeners(1), 0);
    label.set({ windowId: 1, mode: "visual", ...always });
    label.set({ windowId: 2, mode: "visual", ...always });
    label.shutdown();
    assert.equal(listeners(1) + listeners(2), 0);
    assert.deepEqual([...scheme_listeners.values()].map((set) => set.size), [0, 0], "the scheme listeners stop too");
    move_focus(1, true);
    assert.equal(windows.get(1)!.labels_in.length, 0, "a focus move after shutdown draws nothing");
});

test("a call that skips the schema is checked too", () => {
    const { label } = setup();
    assert.throws(() => label.set({ windowId: -1, mode: "normal", indicator: "always", style: "classic", colors: COLORS }), /window id/);
    assert.throws(() => label.set({ windowId: 1, mode: "dizzy" as "normal", indicator: "always", style: "classic", colors: COLORS }), /unknown mode/);
    assert.throws(() => label.set({ windowId: 1, mode: "normal", indicator: "sometimes" as "always", style: "classic", colors: COLORS }), /unknown indicator/);
    assert.throws(() => label.set({ windowId: 1, mode: "normal", indicator: "always", style: "loud" as "classic", colors: COLORS }), /unknown style/);
});
