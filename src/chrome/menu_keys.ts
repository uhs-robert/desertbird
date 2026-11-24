// The keys that move the selection of an open Thunderbird menu or popup, in every window. It holds no Thunderbird global: the parent hands in a `MenuDeps`, so node tests drive every path with fakes.
// The arrow goes out as a chrome `KeyboardEvent` dispatched at once at the open popup (in a panel, at the focused element inside it, or at the panel itself when the focus is outside it). The popup manager listens on the popup's own document, so an event at the key's target does not reach a popup that sits in another document (measured, docs/thunderbird-behavior.md, "Arrow keys into native menus").

import type { WindowListener } from "./runtime.ts";
import type { MenuDirection, MenuKey } from "../shared/protocol.ts";

// The app menu's key navigation ignores an event with no `code` (measured), and a menupopup ignores the lack.
const ARROWS: Record<MenuDirection, [key: string, key_code: number]> = { down: ["ArrowDown", 40], up: ["ArrowUp", 38] };
// A popup shows from the moment it opens until it closes, and only `state` tells.
const SHOWN_STATES = new Set(["showing", "open"]);

export interface MenuNode {
    localName: string;
    state?: string;
    isConnected?: boolean;
    getAttribute?(name: string): string | null;
    contains?(node: MenuNode | null): boolean;
    /** `ownerGlobal` is not reachable from an Experiment script (measured: undefined), so the window comes from the document. Its `defaultView` is null once the document is gone. */
    ownerDocument?: { defaultView: { KeyboardEvent: new (type: string, init: object) => unknown } | null } | null;
    dispatchEvent(event: unknown): boolean;
}

/** A key or popup event as the window root sees it. A popup event names the popup in `originalTarget`, also when it comes from a sub-document such as `about:3pane`. */
export interface MenuEvent {
    type: string;
    key?: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    isComposing?: boolean;
    target?: unknown;
    originalTarget?: unknown;
    preventDefault(): void;
    stopImmediatePropagation(): void;
}

export interface MenuRoot {
    addEventListener(type: "keydown" | "popupshown" | "popuphidden", listener: (event: MenuEvent) => void, capture: boolean): void;
    removeEventListener(type: "keydown" | "popupshown" | "popuphidden", listener: (event: MenuEvent) => void, capture: boolean): void;
}

export interface MenuDeps<Window> {
    /** Calls `on_load_window` for each window already open and for each one opened later, dialogs included. */
    register_window_listener(listener: WindowListener<Window>): void;
    unregister_window_listener(): void;
    /** Where the listeners go: above the window, so they see a key before Thunderbird's handlers and the other runtimes do. */
    root_of(window: Window): MenuRoot;
    /** The focused element of the window's own document. */
    focused_of(window: Window): MenuNode | null;
}

export interface MenuRuntime {
    /** Replaces the key table. The first call starts the window listener, and later calls add none. */
    install(keys: MenuKey[]): void;
    shutdown(): void;
}

export function create_menu_runtime<Window>(deps: MenuDeps<Window>): MenuRuntime {
    let table = new Map<string, MenuDirection>();
    let listening = false;
    // The replay flag: the arrow is dispatched inside the key's own handler, so one flag marks it for every window.
    let sending = false;
    const unhooks = new Map<Window, () => void>();

    function hook(window: Window): void {
        if (unhooks.has(window)) return;
        const root = deps.root_of(window);
        // Shown popups in the order they opened, so the last one still open is the innermost submenu.
        const popups = new Set<MenuNode>();
        const on_popup = (event: MenuEvent) => {
            const popup = (event.originalTarget ?? event.target) as MenuNode;
            for (const stale of popups) if (!stale.isConnected) popups.delete(stale);
            popups.delete(popup);
            if (event.type === "popupshown" && (popup.localName === "menupopup" || popup.localName === "panel")) popups.add(popup);
        };
        const on_key = (event: MenuEvent) => {
            const direction = table.get(event.key ?? "");
            if (!direction || sending || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
            const open = [...popups].filter((popup) => popup.isConnected && SHOWN_STATES.has(popup.state ?? "") && popup.getAttribute?.("ignorekeys") !== "true").at(-1);
            // A panel takes the key at the focused element inside it (the keyboard-opened app menu), or at itself when the focus stayed outside (the click-opened one). An add-on's popup holds a `browser` that takes the key itself.
            const focused = deps.focused_of(window);
            const inside = open?.localName === "panel" && open.contains?.(focused) ? focused : null;
            const target = inside?.localName === "browser" ? null : (inside ?? open);
            const make = target?.ownerDocument?.defaultView?.KeyboardEvent;
            if (!target || !make) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            sending = true;
            try {
                for (const type of ["keydown", "keyup"]) target.dispatchEvent(new make(type, { key: ARROWS[direction][0], code: ARROWS[direction][0], keyCode: ARROWS[direction][1], bubbles: true, cancelable: true }));
            } finally {
                sending = false;
            }
        };
        const listeners = [["popupshown", on_popup], ["popuphidden", on_popup], ["keydown", on_key]] as const;
        for (const [type, listener] of listeners) root.addEventListener(type, listener, true);
        unhooks.set(window, () => listeners.forEach(([type, listener]) => root.removeEventListener(type, listener, true)));
    }

    function unhook(window: Window): void {
        unhooks.get(window)?.();
        unhooks.delete(window);
    }

    return {
        install(keys) {
            table = new Map(keys.map((each) => [each.key, each.direction]));
            if (listening) return;
            deps.register_window_listener({ on_load_window: hook, on_unload_window: unhook });
            listening = true;
        },
        shutdown() {
            for (const window of [...unhooks.keys()]) unhook(window);
            if (listening) deps.unregister_window_listener();
            listening = false;
            table.clear();
        },
    };
}
