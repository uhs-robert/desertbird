// The mode label at the start of a main window's status bar. It holds no Thunderbird global: the parent hands in `ModeLabelDeps`, so node tests drive every path with fakes.

import { MODE_INDICATORS, MODE_LABEL_STYLES, MODE_NAMES } from "../shared/protocol.ts";
import type { ModeIndicator, ModeLabelStyle, ModeName, OverlaySetModeLabelArgs } from "../shared/protocol.ts";

export interface LabelElement {
    style: { cssText: string };
    className: string;
    setAttribute(name: string, value: string): void;
    remove(): void;
}

export interface StatusBarDocument {
    /** Every element with the label id. A reload that left an old label behind makes this more than one. */
    labels(): LabelElement[];
    /** The start of the status bar: `#statusTextBox`, else `#status-bar`. Null where the window has neither. */
    insert_first(label: LabelElement): boolean;
    create_label(): LabelElement;
}

export interface ModeLabelDeps<Window> {
    window_with_id(window_id: number): Window | null;
    open_windows(): Window[];
    status_bar_of(window: Window): StatusBarDocument;
    /** Whether focus sits in a text field of the window, which is insert mode. The key runtime does not track insert, so the label reads the focus itself. */
    in_text_field(window: Window): boolean;
    /** Calls `listener` when the window finishes loading, and never for a window that has already loaded. A window that opens after the add-on started may not have its status bar yet when the label is first asked for. */
    on_loaded(window: Window, listener: () => void): void;
    /** Calls `listener` when focus moves in the window. Returns the way to stop listening. */
    on_focus_change(window: Window, listener: () => void): () => void;
}

export interface ModeLabel {
    set(args: OverlaySetModeLabelArgs): void;
    /** Removes the label from every main window, whether or not this instance put it there, and stops listening to focus. */
    shutdown(): void;
}

/** Whether the indicator setting shows the label in the mode. */
export const label_shows = (indicator: ModeIndicator, mode: ModeName): boolean => indicator === "always" || (indicator === "not_normal" && mode !== "normal");

// Thunderbird's own colors, so the label follows the theme.
const MODE_COLORS: Record<ModeName, string> = {
    normal: "var(--color-yellow-50)",
    visual: "var(--color-orange-50)",
    insert: "var(--color-red-50)",
};

/** The text and the inline style of the label for a mode and a style. Black on the badge: it holds a contrast of at least 5 to 1 on all three colors. */
export function label_look(mode: ModeName, style: ModeLabelStyle): { text: string; css: string } {
    const name = mode.toUpperCase();
    if (style === "classic") return { text: `-- ${name} --`, css: `color: ${MODE_COLORS[mode]}; font-weight: bold; margin-inline: 6px;` };
    return { text: name, css: `background-color: ${MODE_COLORS[mode]}; color: black; font-weight: bold; padding: 0 8px; margin-inline: 6px; border-radius: 8px;` };
}

// The Experiment schema checks these values too. The check here keeps the label safe for a caller that skips the schema, such as a test.
function checked(args: OverlaySetModeLabelArgs): void {
    if (typeof args.windowId !== "number" || !Number.isInteger(args.windowId) || args.windowId < 0) throw new Error("windowId must be a window id");
    if (args.mode !== "normal" && args.mode !== "visual") throw new Error(`unknown mode ${String(args.mode)}`);
    if (!(MODE_INDICATORS as readonly unknown[]).includes(args.indicator)) throw new Error(`unknown indicator ${String(args.indicator)}`);
    if (!(MODE_LABEL_STYLES as readonly unknown[]).includes(args.style)) throw new Error(`unknown style ${String(args.style)}`);
}

interface Shown {
    args: OverlaySetModeLabelArgs;
    stop_listening(): void;
}

export function create_mode_label<Window>(deps: ModeLabelDeps<Window>): ModeLabel {
    const shown = new Map<Window, Shown>();

    // The one place that touches the status bar. It keeps the first label with the id, removes any other, and drops the label when the setting hides it.
    function draw(window: Window, args: OverlaySetModeLabelArgs): void {
        const bar = deps.status_bar_of(window);
        const [kept, ...duplicates] = bar.labels();
        duplicates.forEach((duplicate) => duplicate.remove());
        const mode: ModeName = deps.in_text_field(window) ? "insert" : args.mode;
        if (!label_shows(args.indicator, mode)) return kept?.remove();
        const look = label_look(mode, args.style);
        const label = kept ?? bar.create_label();
        label.className = "statusbarpanel";
        label.style.cssText = look.css;
        label.setAttribute("value", look.text);
        label.setAttribute("crop", "end");
        if (kept === undefined && !bar.insert_first(label)) deps.on_loaded(window, () => void (shown.has(window) && draw(window, shown.get(window)!.args)));
    }

    function forget(window: Window): void {
        shown.get(window)?.stop_listening();
        shown.delete(window);
    }

    return {
        set(args) {
            checked(args);
            const window = deps.window_with_id(args.windowId);
            if (window === null) throw new Error(`no main window has id ${args.windowId}`);
            // A closed window takes its listeners with it, so only the table entry is left to drop.
            const open = deps.open_windows();
            for (const each of [...shown.keys()]) if (!open.includes(each)) shown.delete(each);
            if (args.indicator === "off") {
                forget(window);
                return draw(window, args);
            }
            const entry: Shown = shown.get(window) ?? { args, stop_listening: deps.on_focus_change(window, () => draw(window, entry.args)) };
            entry.args = args;
            shown.set(window, entry);
            draw(window, args);
        },
        shutdown() {
            for (const window of [...shown.keys()]) forget(window);
            for (const window of deps.open_windows()) deps.status_bar_of(window).labels().forEach((label) => label.remove());
        },
    };
}
