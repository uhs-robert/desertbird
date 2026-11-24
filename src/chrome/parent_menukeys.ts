// The parent script of the `menukeys` API: j and k (or the keys the user binds to `menu.down` and `menu.up`) move the selection of an open native menu or popup, in every window. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `menukeys`: `getAPI(context)` returns `get_menukeys_api(context)` and `onShutdown` calls `shutdown()`.
// Thunderbird loads it at startup with the first install, which the background makes before the other key installs, so its listener is the first on each window root.

import { create_menu_runtime } from "./menu_keys.ts";
import type { MenuNode, MenuRoot, MenuRuntime } from "./menu_keys.ts";
import type { MenukeysInstallArgs } from "../shared/protocol.ts";

declare const ChromeUtils: { importESModule(url: string): { ExtensionSupport: { registerWindowListener(id: string, listener: object): void; unregisterWindowListener(id: string): void } } };

const WINDOW_LISTENER_ID = "desertbird@uhs-robert/menukeys";

interface MenuWindow extends MenuRoot {
    windowRoot?: MenuRoot;
    document: { activeElement: MenuNode | null };
}

let runtime: MenuRuntime | null = null;

// Imported at the call and not at the top, so node tests load this file with a stub global.
const extension_support = () => ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs").ExtensionSupport;

// No `chromeURLs`: the listener hooks every chrome window, dialogs included.
function ensure_runtime(): MenuRuntime {
    runtime ??= create_menu_runtime<MenuWindow>({
        register_window_listener(listener) {
            extension_support().registerWindowListener(WINDOW_LISTENER_ID, { onLoadWindow: listener.on_load_window, onUnloadWindow: listener.on_unload_window });
        },
        unregister_window_listener: () => extension_support().unregisterWindowListener(WINDOW_LISTENER_ID),
        root_of: (window) => window.windowRoot ?? window,
        focused_of: (window) => window.document.activeElement,
    });
    return runtime;
}

export function get_menukeys_api() {
    return { menukeys: { install: async ({ keys }: MenukeysInstallArgs): Promise<void> => ensure_runtime().install(keys) } };
}

/** Removes the listeners from every window and the window listener. */
export function shutdown(): void {
    runtime?.shutdown();
    runtime = null;
}
