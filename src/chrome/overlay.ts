// Mounts and removes the overlay in a main window. It holds no Thunderbird global: the parent hands in `OverlayDeps`, so node tests drive every path with fakes.

import { OVERLAY_SURFACES } from "../shared/protocol.ts";
import type { OverlayMountArgs, OverlaySurface, OverlayUnmountArgs } from "../shared/protocol.ts";

export interface OverlayDeps<Window> {
    /** The main window the MailExtension window id names, or null. */
    window_with_id(window_id: number): Window | null;
    /** Puts the surface in the window and gives it the focus. Returns the way to remove it. */
    create(window: Window, surface: OverlaySurface, window_id: number): () => void;
    /** Focuses the thread list of the front tab. Does nothing when that tab is not the mail tab. */
    focus_thread_list(window: Window): void;
    /** Calls `listener` when the front tab of the window changes. Returns the way to stop listening. */
    on_tab_select(window: Window, listener: () => void): () => void;
    /** Calls `listener` when the window closes. Returns the way to stop listening. */
    on_window_unload(window: Window, listener: () => void): () => void;
    /** Calls `listener` on each Escape key of the window. Returns the way to stop listening. */
    on_escape(window: Window, listener: () => void): () => void;
    emit_closed(window_id: number, surface: OverlaySurface): void;
}

export interface OverlayHost {
    mount(args: OverlayMountArgs): void;
    unmount(args: OverlayUnmountArgs): void;
    shutdown(): void;
}

interface Mounted {
    window_id: number;
    surface: OverlaySurface;
    remove(): void;
    stop_listening(): void;
}

// The command line takes the keyboard, so it leaves on Escape or a tab change and gives the focus back. The hud never takes it, so neither of those removes it and its removal moves no focus.
const takes_keyboard = (surface: OverlaySurface): boolean => surface === "cmdline";

const is_surface = (value: unknown): value is OverlaySurface => (OVERLAY_SURFACES as readonly unknown[]).includes(value);

// The Experiment schema checks these types too. The check here keeps the host safe for a caller that skips the schema, such as a test.
function checked_window_id(args: { windowId: unknown }): number {
    if (typeof args.windowId !== "number" || !Number.isInteger(args.windowId) || args.windowId < 0) throw new Error("windowId must be a window id");
    return args.windowId;
}

export function create_overlay_host<Window extends object>(deps: OverlayDeps<Window>): OverlayHost {
    const mounted = new Map<Window, Map<OverlaySurface, Mounted>>();

    function take_down(window: Window, entry: Mounted): void {
        entry.stop_listening();
        entry.remove();
        const of_window = mounted.get(window);
        of_window?.delete(entry.surface);
        if (of_window?.size === 0) mounted.delete(window);
    }

    // The surface left on its own. The focus goes back to the list only when the window lives on and the surface held the keyboard: a tab change leaves it to the tab.
    function close_by_itself(window: Window, entry: Mounted, window_is_closing: boolean): void {
        if (mounted.get(window)?.get(entry.surface) !== entry) return;
        take_down(window, entry);
        if (!window_is_closing && takes_keyboard(entry.surface)) deps.focus_thread_list(window);
        deps.emit_closed(entry.window_id, entry.surface);
    }

    return {
        mount(args) {
            const window_id = checked_window_id(args);
            if (!is_surface(args.surface)) throw new Error(`unknown surface ${String(args.surface)}`);
            const window = deps.window_with_id(window_id);
            if (window === null) throw new Error(`no main window has id ${window_id}`);
            // A second mount replaces the first, so the page starts clean and one window never holds two of a surface.
            const earlier = mounted.get(window)?.get(args.surface);
            if (earlier) take_down(window, earlier);
            const surface = args.surface;
            const remove = deps.create(window, surface, window_id);
            const entry: Mounted = { window_id, surface, remove, stop_listening: () => {} };
            const stops = [deps.on_window_unload(window, () => close_by_itself(window, entry, true))];
            if (takes_keyboard(surface)) {
                stops.push(deps.on_tab_select(window, () => close_by_itself(window, entry, false)));
                // The page closes itself on Escape. This is the way out when the page never loaded and nothing answers the key.
                stops.push(deps.on_escape(window, () => close_by_itself(window, entry, false)));
            }
            entry.stop_listening = () => stops.forEach((stop) => stop());
            if (!mounted.has(window)) mounted.set(window, new Map());
            mounted.get(window)?.set(surface, entry);
        },
        unmount(args) {
            const window_id = checked_window_id(args);
            if (!is_surface(args.surface)) throw new Error(`unknown surface ${String(args.surface)}`);
            for (const [window, of_window] of [...mounted]) {
                const entry = of_window.get(args.surface);
                if (entry?.window_id !== window_id) continue;
                take_down(window, entry);
                if (takes_keyboard(entry.surface)) deps.focus_thread_list(window);
            }
        },
        shutdown() {
            for (const [window, of_window] of [...mounted]) for (const entry of [...of_window.values()]) take_down(window, entry);
        },
    };
}
