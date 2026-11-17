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
    emit_closed(window_id: number): void;
}

export interface OverlayHost {
    mount(args: OverlayMountArgs): void;
    unmount(args: OverlayUnmountArgs): void;
    shutdown(): void;
}

interface Mounted {
    window_id: number;
    remove(): void;
    stop_listening(): void;
}

const is_surface = (value: unknown): value is OverlaySurface => (OVERLAY_SURFACES as readonly unknown[]).includes(value);

// The Experiment schema checks these types too. The check here keeps the host safe for a caller that skips the schema, such as a test.
function checked_window_id(args: { windowId: unknown }): number {
    if (typeof args.windowId !== "number" || !Number.isInteger(args.windowId) || args.windowId < 0) throw new Error("windowId must be a window id");
    return args.windowId;
}

export function create_overlay_host<Window extends object>(deps: OverlayDeps<Window>): OverlayHost {
    const mounted = new Map<Window, Mounted>();

    function take_down(window: Window, entry: Mounted): void {
        entry.stop_listening();
        entry.remove();
        mounted.delete(window);
    }

    // The overlay left on its own. The focus goes back to the list only when the window lives on: a tab change leaves it to the tab.
    function close_by_itself(window: Window, entry: Mounted, window_is_closing: boolean): void {
        if (mounted.get(window) !== entry) return;
        take_down(window, entry);
        if (!window_is_closing) deps.focus_thread_list(window);
        deps.emit_closed(entry.window_id);
    }

    return {
        mount(args) {
            const window_id = checked_window_id(args);
            if (!is_surface(args.surface)) throw new Error(`unknown surface ${String(args.surface)}`);
            const window = deps.window_with_id(window_id);
            if (window === null) throw new Error(`no main window has id ${window_id}`);
            // A second mount replaces the first, so the page starts clean and one window never holds two overlays.
            const earlier = mounted.get(window);
            if (earlier) take_down(window, earlier);
            const remove = deps.create(window, args.surface, window_id);
            const entry: Mounted = { window_id, remove, stop_listening: () => {} };
            const stop_tab = deps.on_tab_select(window, () => close_by_itself(window, entry, false));
            const stop_unload = deps.on_window_unload(window, () => close_by_itself(window, entry, true));
            entry.stop_listening = () => {
                stop_tab();
                stop_unload();
            };
            mounted.set(window, entry);
        },
        unmount(args) {
            const window_id = checked_window_id(args);
            for (const [window, entry] of mounted) {
                if (entry.window_id !== window_id) continue;
                take_down(window, entry);
                deps.focus_thread_list(window);
            }
        },
        shutdown() {
            for (const [window, entry] of [...mounted]) take_down(window, entry);
        },
    };
}
