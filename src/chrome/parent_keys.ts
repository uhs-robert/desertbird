// The parent script of the `keys` API. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `keys`: `getAPI(context)` returns `get_keys_api(context)` and `onShutdown` calls `shutdown()`.

import { in_reading_pane, is_typing, menu_is_open } from "./focus.ts";
import { guard, load_platform, open_main_windows, tabmail_of } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import { create_runtime } from "./runtime.ts";
import type { KeysInstallArgs, KeysEvent } from "../shared/protocol.ts";
import type { KeydownEvent, Runtime, WindowListener } from "./runtime.ts";
import { create_list_port, front_about_3pane, view_verbs } from "./view.ts";

const MAIN_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";
const WINDOW_LISTENER_ID = "desertbird@uhs-robert/keys";
// A window the extension does not track has no id. The background reads the window id for nothing but the command context, so the command still runs.
const NO_WINDOW_ID = -1;

// The invocation listeners belong to the event the background subscribes to.
const invocation_listeners = new Set<(invocation: KeysEvent) => void>();
let runtime: Runtime | null = null;

function ensure_runtime(context: ExtensionContext): Runtime {
    const mail_extension_id_of = (header: unknown): number | null => context.extension.messageManager.convert(header, { skipFolder: true })?.id ?? null;
    runtime ??= create_runtime<MainWindow>({
        register_window_listener(listener: WindowListener<MainWindow>) {
            load_platform().ExtensionSupport.registerWindowListener(WINDOW_LISTENER_ID, {
                chromeURLs: [MAIN_WINDOW_URL],
                onLoadWindow: listener.on_load_window,
                onUnloadWindow: listener.on_unload_window,
            });
        },
        unregister_window_listener: () => load_platform().ExtensionSupport.unregisterWindowListener(WINDOW_LISTENER_ID),
        open_windows: open_main_windows,
        list_port_of(window) {
            const about_3pane = front_about_3pane(tabmail_of(window));
            return about_3pane && create_list_port(about_3pane, mail_extension_id_of);
        },
        is_typing_target: (window: MainWindow, event: KeydownEvent) => is_typing(event, window.document),
        menu_is_open: (window: MainWindow) => menu_is_open(window.document),
        in_reading_pane: (window: MainWindow) => in_reading_pane(window.document),
        on_tab_select(window, listener) {
            // On the window and not on the tab strip: at startup the strip does not exist yet when the window is hooked (measured), and a capture listener on the window sees the event from any element below it.
            window.addEventListener("TabSelect", listener, true);
            return () => window.removeEventListener("TabSelect", listener, true);
        },
        now: () => Date.now(),
        on_window_blur(window, listener) {
            // The blur lands on the focused element when the whole window deactivates, so the target does not tell a window blur from a focus move inside it. Focus does.
            const on_blur = () => {
                if (!window.document.hasFocus()) listener();
            };
            window.addEventListener("blur", on_blur, true);
            return () => window.removeEventListener("blur", on_blur, true);
        },
        window_id_of: (window) => context.extension.windowManager.getWrapper(window)?.id ?? NO_WINDOW_ID,
        emit: (invocation) => {
            for (const listener of invocation_listeners) listener(invocation);
        },
    });
    return runtime;
}

export function get_keys_api(context: ExtensionContext) {
    return {
        keys: {
            install: guard("keys.install", ({ tree, holdCommands }: KeysInstallArgs): void => ensure_runtime(context).install(tree, holdCommands)),
            ...view_verbs(context),
            onInvocation: new (load_platform().ExtensionCommon.EventManager)({
                context,
                name: "keys.onInvocation",
                register: (fire) => {
                    const listener = (invocation: KeysEvent) => fire.async(invocation);
                    invocation_listeners.add(listener);
                    return () => invocation_listeners.delete(listener);
                },
            }).api(),
        },
    };
}

/** Removes every key listener and the window listener, drops the tree and the half-typed sequence, and forgets the event subscribers. */
export function shutdown(): void {
    runtime?.shutdown();
    runtime = null;
    invocation_listeners.clear();
}
