// Mounts and removes the overlay in a main window. It holds no Thunderbird global: the parent hands in `OverlayDeps`, so node tests drive every path with fakes.

import { OVERLAY_SURFACES } from "../shared/protocol.ts";
import type { OverlayMountArgs, OverlaySurface, OverlayUnmountArgs } from "../shared/protocol.ts";

export interface OverlayDeps<Window> {
    /** The main window the MailExtension window id names, or null. */
    window_with_id(window_id: number): Window | null;
    /** Puts the surface in the window and gives it the focus. Returns the way to remove it. */
    create(window: Window, surface: OverlaySurface, window_id: number, click_through: boolean): () => void;
    /** Focuses the thread list of the front tab. Does nothing when that tab is not the mail tab. */
    focus_thread_list(window: Window): void;
    /** Notes what has the focus now. The returned function gives it back and answers false when that element is gone or cannot take the focus, so the host falls back to the thread list. */
    capture_focus(window: Window): () => boolean;
    /** Calls `listener` when the front tab of the window changes. Returns the way to stop listening. */
    on_tab_select(window: Window, listener: () => void): () => void;
    /** Calls `listener` when the window closes. Returns the way to stop listening. */
    on_window_unload(window: Window, listener: () => void): () => void;
    /** Calls `listener` when an Escape key needs the host to close the overlay: the page has no title, or did not answer in time (see `on_escape_key`). Returns the way to stop listening. */
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
    /** Gives the focus back to what had it when the surface mounted. */
    restore_focus(): void;
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

    // The surface left on its own. The focus moves only when the window lives on and the surface held the keyboard. After a tab change the captured element sits in the hidden tab, so the focus goes to the new front tab's thread list instead.
    function close_by_itself(window: Window, entry: Mounted, why: "window_closed" | "tab_changed" | "escape"): void {
        if (mounted.get(window)?.get(entry.surface) !== entry) return;
        take_down(window, entry);
        if (takes_keyboard(entry.surface)) {
            if (why === "escape") entry.restore_focus();
            if (why === "tab_changed") deps.focus_thread_list(window);
        }
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
            // Read before the mount moves the focus to the surface.
            const give_back = takes_keyboard(surface) ? deps.capture_focus(window) : () => true;
            const remove = deps.create(window, surface, window_id, args.clickThrough === true);
            const restore_focus = () => {
                if (!give_back()) deps.focus_thread_list(window);
            };
            const entry: Mounted = { window_id, surface, remove, restore_focus, stop_listening: () => {} };
            const stops = [deps.on_window_unload(window, () => close_by_itself(window, entry, "window_closed"))];
            if (takes_keyboard(surface)) {
                stops.push(deps.on_tab_select(window, () => close_by_itself(window, entry, "tab_changed")));
                // A loaded page decides its own Escape. This is the way out when the page never loaded, hangs or has no background to answer it.
                stops.push(deps.on_escape(window, () => close_by_itself(window, entry, "escape")));
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
                if (takes_keyboard(entry.surface)) entry.restore_focus();
            }
        },
        shutdown() {
            for (const [window, of_window] of [...mounted]) for (const entry of [...of_window.values()]) take_down(window, entry);
        },
    };
}

/** How long a loaded page has to answer an Escape before the host closes the overlay itself. */
export const ESCAPE_ANSWER_MS = 300;

/**
 * What the host does on an Escape keydown. A page that has loaded decides the key: it answers by changing its title, as the command line does when the first Escape only closes its list. When the title is empty (the page never loaded) the host closes at once, and when it does not change in time (the page hangs) the host closes after the wait.
 */
export function on_escape_key(read_title: () => string, wait: (run: () => void, ms: number) => void, close: () => void): void {
    const before = read_title();
    if (before === "") close();
    else wait(() => (read_title() === before ? close() : undefined), ESCAPE_ANSWER_MS);
}

// The browser element fires the first name where Thunderbird has renamed the second.
const TITLE_EVENTS = ["pagetitlechanged", "DOMTitleChanged"];

/** How long the host waits for the ready title. It stays under the hold of the key runtime (1500 ms), so a page that never says it is ready still ends up a typing target before the hold ends and the line takes its keys. */
export const READY_FAILSAFE_MS = 1400;

interface ReadyBrowser {
    id: string;
    contentTitle?: string;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

/**
 * Gives the browser its final id when the page sets `ready_title`, or after `READY_FAILSAFE_MS` when it never does (an event this Thunderbird names differently, a page that failed before it set the title). An empty title is the markup's own, and any other title is not the page's word, so neither counts.
 */
export function claim_id_when_page_ready(browser: ReadyBrowser, final_id: string, ready_title: string, wait: (run: () => void, ms: number) => void): void {
    let claimed = false;
    const claim = () => {
        if (claimed) return;
        claimed = true;
        browser.id = final_id;
        for (const type of TITLE_EVENTS) browser.removeEventListener(type, on_title);
    };
    const on_title = () => {
        if (browser.contentTitle === ready_title) claim();
    };
    for (const type of TITLE_EVENTS) browser.addEventListener(type, on_title);
    wait(claim, READY_FAILSAFE_MS);
}
