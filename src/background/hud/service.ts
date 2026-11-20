// The hud in the background: the which-key panel and the toasts of each main window, and the mode label of its status bar. The page draws the panel and the toasts. The label is drawn by the Experiment, which this side tells what to show. This side decides what shows and when, and mounts the page while something shows.

import type { Settings } from "../config/settings.ts";
import type { TreeBranch } from "../../../vendor/desertfox/prefix_tree.ts";
import type { HudRequest, HudState, KeysEvent, KeysMode, OverlayApi } from "../../shared/protocol.ts";
import { mode_label_colors, resolve_theme } from "../theme/palette.ts";
import { create_toasts } from "./toasts.ts";
import type { Timers, Toasts } from "./toasts.ts";
import { may_open_by_itself, which_key_panel } from "./which_key.ts";

export type WhichKeySource = "main" | "message" | "own" | "page";

export interface HudDeps {
    /** Absent when the Experiment failed to load. Nothing shows then, and `toast` reports that it showed nothing. */
    overlay: OverlayApi | undefined;
    /** The live settings. The config store refills on a storage change, so each call sees the current values. */
    read_settings(): Promise<Settings>;
    /** The root of the keys a panel lists: the mail window keys, or the keys of a message document. */
    read_root(source: WhichKeySource): Promise<TreeBranch>;
    /** Tells the hud page of the window to ask for its state again. */
    send_changed(window_id: number): void;
    timers: Timers;
}

export interface HudService {
    /** Answers the page's `hud.state`, or returns undefined for a message that is not one. */
    handle(message: unknown): Promise<HudState> | undefined;
    /** Feeds the `pending` and `mode` events of the key runtime. Other events are ignored. */
    on_keys_event(event: KeysEvent): Promise<void>;
    /** Feeds the typed prefix of a message document in the window. The panel lists the message keys, or the page keys when `source` is `own` (an options or help page). A window the hud does not track as a main window is ignored, so the panel shows in the mail tab and message tabs and not in a standalone message window. The newest report of either source wins. */
    on_body_pending(window_id: number, keys: string[], source: "message" | "own"): Promise<void>;
    /** Shows a toast in the window. Resolves to false when no toast can show (no window id, no Experiment, a zero time, or the page could not mount), so the caller falls back to a system notification. */
    toast(window_id: number, text: string, is_error: boolean): Promise<boolean>;
    /** The command line opened or closed in the window. Its box covers the bottom of the window, so the toasts move above it. */
    set_lifted(window_id: number, lifted: boolean): void;
    /** Shows the panel of the root keys in the window, with no typed prefix and no delay. It stays until the next key is reported, a tab change or a window blur. */
    show_root(window_id: number, source?: WhichKeySource): Promise<void>;
    /** Closes the which-key panel of every window, or of every window but one. A tab change or a window losing focus calls this. */
    close_which_key(except_window_id?: number): void;
    /** A main window exists. The mode label may need to show in it. */
    track(window_id: number): Promise<void>;
    /** The window is gone, or its hud left on its own. */
    forget(window_id: number): void;
    /** The settings changed: the mode settings may add, remove or restyle the label, and the border may change. */
    settings_changed(): Promise<void>;
    /** The mode the key runtime last reported for the window, `normal` before any report. */
    mode_of(window_id: number): KeysMode["mode"];
}

interface WindowHud {
    toasts: Toasts;
    /** The typed keys the panel lists the continuations of, or null when no panel shows. */
    which_key_keys: string[] | null;
    /** Whose keys the panel lists. The redraw reads the same tree the panel opened from. */
    which_key_source: WhichKeySource;
    /** Counts each key event. A slower answer from an earlier event finds a newer number and stops. */
    sequence: number;
    lifted: boolean;
    mode: KeysMode["mode"];
    delay_timer: unknown;
    mounted: boolean;
    /** Mount and unmount calls run one after another, so a quick show and hide cannot leave the page mounted. */
    queue: Promise<void>;
}

const is_integer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

export function create_hud_service(deps: HudDeps): HudService {
    const windows = new Map<number, WindowHud>();

    function hud_of(window_id: number): WindowHud {
        let hud = windows.get(window_id);
        if (hud === undefined) {
            hud = { toasts: create_toasts(deps.timers, () => void changed(window_id)), which_key_keys: null, which_key_source: "main", sequence: 0, lifted: false, mode: "normal", delay_timer: undefined, mounted: false, queue: Promise.resolve() };
            windows.set(window_id, hud);
        }
        return hud;
    }

    const needed = (hud: WindowHud): boolean => hud.which_key_keys !== null || hud.toasts.list().length > 0;

    // Tells the Experiment what the label of the window shows now. It runs on the window's queue, so the last mode and setting always win.
    function sync_label(window_id: number): Promise<void> {
        const hud = windows.get(window_id);
        if (hud === undefined || deps.overlay === undefined) return Promise.resolve();
        const overlay = deps.overlay;
        hud.queue = hud.queue.then(async () => {
            const settings = await deps.read_settings();
            await overlay.setModeLabel({ windowId: window_id, mode: hud.mode, indicator: settings.mode_indicator, style: settings.mode_indicator_style, colors: mode_label_colors(resolve_theme(settings.theme)) }).catch((error: unknown) => console.error("desertbird:", error));
        });
        return hud.queue;
    }

    // Mounts the page while something shows and removes it when nothing does, then tells a mounted page to redraw.
    function changed(window_id: number): Promise<void> {
        const hud = windows.get(window_id);
        if (hud === undefined || deps.overlay === undefined) return Promise.resolve();
        const overlay = deps.overlay;
        hud.queue = hud.queue.then(async () => {
            const wanted = needed(hud);
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

    async function on_pending(window_id: number, keys: string[], source: WhichKeySource): Promise<void> {
        // A window with no id has no hud to mount.
        if (window_id < 0) return;
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
        const root = await deps.read_root(source);
        if (sequence !== hud.sequence) return;
        if (which_key_panel(root, keys, settings) === null) return end_which_key(window_id, hud);
        const show = () => {
            hud.delay_timer = undefined;
            hud.which_key_keys = keys;
            hud.which_key_source = source;
            void changed(window_id);
        };
        if (panel_is_up) show();
        else hud.delay_timer = deps.timers.set(show, settings.which_key_delay_ms);
    }

    async function state_of(window_id: number): Promise<HudState> {
        const hud = hud_of(window_id);
        const settings = await deps.read_settings();
        const keys = hud.which_key_keys;
        const which_key = keys === null ? null : which_key_panel(await deps.read_root(hud.which_key_source), keys, settings);
        return { which_key, toasts: hud.toasts.list(), lifted: hud.lifted };
    }

    function read_request(message: unknown): HudRequest | undefined {
        const request = message as Partial<Record<string, unknown>> | null;
        return typeof request === "object" && request !== null && request["type"] === "hud.state" && is_integer(request["windowId"]) ? { type: "hud.state", windowId: request["windowId"] } : undefined;
    }

    async function show_root(window_id: number, source: WhichKeySource = "main"): Promise<void> {
        if (window_id < 0) return;
        // Any other window's panel is stale once this one shows.
        for (const [other_id, other] of windows) if (other_id !== window_id) void end_which_key(other_id, other);
        const hud = hud_of(window_id);
        hud.sequence++;
        deps.timers.clear(hud.delay_timer);
        hud.delay_timer = undefined;
        hud.which_key_keys = [];
        hud.which_key_source = source;
        await changed(window_id);
    }

    return {
        handle(message) {
            const request = read_request(message);
            return request === undefined ? undefined : state_of(request.windowId);
        },
        async on_keys_event(event) {
            if (event.command === "mode" && "mode" in event) {
                if (event.windowId < 0) return;
                const hud = hud_of(event.windowId);
                if (hud.mode === event.mode) return;
                hud.mode = event.mode;
                return sync_label(event.windowId);
            }
            if (event.command !== "pending" || !("keys" in event)) return;
            const source = event.source ?? "main";
            if (event.root) return show_root(event.windowId, source);
            await on_pending(event.windowId, event.keys, source);
        },
        // Only a tracked main window has a hud page to mount. A standalone message window is not one, so its reports are dropped.
        on_body_pending: async (window_id, keys, source) => (windows.has(window_id) ? on_pending(window_id, keys, source) : undefined),
        async toast(window_id, text, is_error) {
            if (deps.overlay === undefined || window_id < 0) return false;
            const settings = await deps.read_settings();
            const ms = is_error ? settings.toast_error_ms : settings.toast_ms;
            if (ms <= 0) return false;
            const hud = hud_of(window_id);
            const id = hud.toasts.show(text, is_error, ms);
            // The toast counts as shown only when the page is up to draw it. A failed mount hands the message back to the caller.
            await changed(window_id);
            if (hud.mounted) return true;
            hud.toasts.dismiss(id);
            return false;
        },
        set_lifted(window_id, lifted) {
            const hud = hud_of(window_id);
            hud.lifted = lifted;
            void changed(window_id);
        },
        show_root,
        close_which_key(except_window_id) {
            for (const [window_id, hud] of windows) if (window_id !== except_window_id) void end_which_key(window_id, hud);
        },
        async track(window_id) {
            hud_of(window_id);
            await Promise.all([changed(window_id), sync_label(window_id)]);
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
            await Promise.all([...windows.keys()].flatMap((window_id) => [changed(window_id), sync_label(window_id)]));
        },
        mode_of: (window_id) => windows.get(window_id)?.mode ?? "normal",
    };
}

/** The overlay API with a window's toasts lifted above the command line box when `lifts` is true, and set back down when `lifts` is false or the surface goes. Wraps the calls that open and close the surface, so the commands that use the overlay need no knowledge of the hud. The confirm prompt lifts, since it fills the whole box. The command line does not lift, since its panel is short and sits at the bottom. Its mounts still set the lift down, because a command line can replace a prompt. */
export function lifting_toasts(overlay: OverlayApi, hud: Pick<HudService, "set_lifted">, lifts: boolean): OverlayApi {
    return {
        ...overlay,
        async mount(args) {
            if (args.surface === "cmdline") hud.set_lifted(args.windowId, lifts);
            try {
                await overlay.mount(args);
            } catch (error) {
                if (args.surface === "cmdline") hud.set_lifted(args.windowId, false);
                throw error;
            }
        },
        async unmount(args) {
            if (args.surface === "cmdline") hud.set_lifted(args.windowId, false);
            await overlay.unmount(args);
        },
    };
}
