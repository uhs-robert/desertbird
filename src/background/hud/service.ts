// The hud in the background: the which-key panel, the toasts and the mode badge of each main window. The page only draws. This side decides what shows and when, and mounts the page while something shows.

import type { Settings } from "../../../vendor/desertfox/config.ts";
import type { TreeBranch } from "../../../vendor/desertfox/prefix_tree.ts";
import type { HudRequest, HudState, KeysEvent, OverlayApi } from "../../shared/protocol.ts";
import { create_toasts } from "./toasts.ts";
import type { Timers, Toasts } from "./toasts.ts";
import { may_open_by_itself, which_key_panel } from "./which_key.ts";

export interface HudDeps {
    /** Absent when the Experiment failed to load. Nothing shows then, and `toast` reports that it showed nothing. */
    overlay: OverlayApi | undefined;
    /** The live settings. The config store refills on a storage change, so each call sees the current values. */
    read_settings(): Promise<Settings>;
    read_root(): Promise<TreeBranch>;
    /** Tells the hud page of the window to ask for its state again. */
    send_changed(window_id: number): void;
    /** The mode of the window, for the badge. */
    mode_of(window_id: number): string;
    timers: Timers;
}

export interface HudService {
    /** Answers the page's `hud.state`, or returns undefined for a message that is not one. */
    handle(message: unknown): Promise<HudState> | undefined;
    /** Feeds the `keys.pending` events of the key runtime. Other events are ignored. */
    on_keys_event(event: KeysEvent): Promise<void>;
    /** Shows a toast in the window. Resolves to false when no toast can show (no window id, no Experiment, or a zero time), so the caller falls back to a system notification. */
    toast(window_id: number, text: string, is_error: boolean): Promise<boolean>;
    /** Closes the which-key panel of every window, or of every window but one. A tab change or a window losing focus calls this. */
    close_which_key(except_window_id?: number): void;
    /** A main window exists. The badge may need to show in it. */
    track(window_id: number): Promise<void>;
    /** The window is gone, or its hud left on its own. */
    forget(window_id: number): void;
    /** The settings changed: the mode setting may add or remove the badge, and the border may change. */
    settings_changed(): Promise<void>;
}

interface WindowHud {
    toasts: Toasts;
    /** The typed keys the panel lists the continuations of, or null when no panel shows. */
    which_key_keys: string[] | null;
    /** Counts each key event. A slower answer from an earlier event finds a newer number and stops. */
    sequence: number;
    delay_timer: unknown;
    mounted: boolean;
    /** Mount and unmount calls run one after another, so a quick show and hide cannot leave the page mounted. */
    queue: Promise<void>;
}

const is_integer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

export const NORMAL_MODE = "normal";

/** The badge text for a mode under the `mode_indicator` setting, or null for none. */
export function badge_for(mode_indicator: Settings["mode_indicator"], mode: string): string | null {
    if (mode_indicator === "off" || (mode_indicator === "not_normal" && mode === NORMAL_MODE)) return null;
    return mode.toUpperCase();
}

export function create_hud_service(deps: HudDeps): HudService {
    const windows = new Map<number, WindowHud>();

    function hud_of(window_id: number): WindowHud {
        let hud = windows.get(window_id);
        if (hud === undefined) {
            hud = { toasts: create_toasts(deps.timers, () => void changed(window_id)), which_key_keys: null, sequence: 0, delay_timer: undefined, mounted: false, queue: Promise.resolve() };
            windows.set(window_id, hud);
        }
        return hud;
    }

    async function needed(window_id: number, hud: WindowHud): Promise<boolean> {
        if (hud.which_key_keys !== null || hud.toasts.list().length > 0) return true;
        return badge_for((await deps.read_settings()).mode_indicator, deps.mode_of(window_id)) !== null;
    }

    // Mounts the page while something shows and removes it when nothing does, then tells a mounted page to redraw.
    function changed(window_id: number): Promise<void> {
        const hud = windows.get(window_id);
        if (hud === undefined || deps.overlay === undefined) return Promise.resolve();
        const overlay = deps.overlay;
        hud.queue = hud.queue.then(async () => {
            const wanted = await needed(window_id, hud);
            if (wanted && !hud.mounted) {
                hud.mounted = true;
                await overlay.mount({ windowId: window_id, surface: "hud" }).catch((error: unknown) => {
                    hud.mounted = false;
                    console.error("desertbird:", error);
                });
            } else if (!wanted && hud.mounted) {
                hud.mounted = false;
                await overlay.unmount({ windowId: window_id, surface: "hud" }).catch(console.error);
            } else if (wanted) {
                deps.send_changed(window_id);
            }
        });
        return hud.queue;
    }

    function end_which_key(window_id: number, hud: WindowHud): Promise<void> {
        hud.sequence++;
        deps.timers.clear(hud.delay_timer);
        hud.delay_timer = undefined;
        if (hud.which_key_keys === null) return Promise.resolve();
        hud.which_key_keys = null;
        return changed(window_id);
    }

    async function on_pending(window_id: number, keys: string[]): Promise<void> {
        // The sequence moved to this window, so another window's panel is stale.
        for (const [other_id, other] of windows) if (other_id !== window_id) void end_which_key(other_id, other);
        const hud = hud_of(window_id);
        if (keys.length === 0) return end_which_key(window_id, hud);
        const sequence = ++hud.sequence;
        deps.timers.clear(hud.delay_timer);
        hud.delay_timer = undefined;
        const settings = await deps.read_settings();
        if (sequence !== hud.sequence) return;
        const panel_is_up = hud.which_key_keys !== null;
        if (!may_open_by_itself(settings, keys, panel_is_up)) return panel_is_up ? end_which_key(window_id, hud) : undefined;
        const root = await deps.read_root();
        if (sequence !== hud.sequence) return;
        if (which_key_panel(root, keys, settings) === null) return end_which_key(window_id, hud);
        const show = () => {
            hud.delay_timer = undefined;
            hud.which_key_keys = keys;
            void changed(window_id);
        };
        if (panel_is_up) show();
        else hud.delay_timer = deps.timers.set(show, settings.which_key_delay_ms);
    }

    async function state_of(window_id: number): Promise<HudState> {
        const hud = hud_of(window_id);
        const settings = await deps.read_settings();
        const keys = hud.which_key_keys;
        const which_key = keys === null ? null : which_key_panel(await deps.read_root(), keys, settings);
        return { which_key, toasts: hud.toasts.list(), badge: badge_for(settings.mode_indicator, deps.mode_of(window_id)) };
    }

    function read_request(message: unknown): HudRequest | undefined {
        const request = message as Partial<Record<string, unknown>> | null;
        return typeof request === "object" && request !== null && request["type"] === "hud.state" && is_integer(request["windowId"]) ? { type: "hud.state", windowId: request["windowId"] } : undefined;
    }

    return {
        handle(message) {
            const request = read_request(message);
            return request === undefined ? undefined : state_of(request.windowId);
        },
        async on_keys_event(event) {
            if (event.command !== "keys.pending" || !("keys" in event)) return;
            await on_pending(event.windowId, event.keys);
        },
        async toast(window_id, text, is_error) {
            if (deps.overlay === undefined || window_id < 0) return false;
            const settings = await deps.read_settings();
            const ms = is_error ? settings.toast_error_ms : settings.toast_ms;
            if (ms <= 0) return false;
            hud_of(window_id).toasts.show(text, is_error, ms);
            return true;
        },
        close_which_key(except_window_id) {
            for (const [window_id, hud] of windows) if (window_id !== except_window_id) void end_which_key(window_id, hud);
        },
        async track(window_id) {
            hud_of(window_id);
            await changed(window_id);
        },
        forget(window_id) {
            const hud = windows.get(window_id);
            if (hud === undefined) return;
            // The window leaves the table first, so the change `clear` reports finds nothing to mount.
            windows.delete(window_id);
            deps.timers.clear(hud.delay_timer);
            hud.toasts.clear();
        },
        async settings_changed() {
            await Promise.all([...windows.keys()].map((window_id) => changed(window_id)));
        },
    };
}
