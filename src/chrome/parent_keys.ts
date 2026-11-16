// The parent script of the `keys` API. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `keys`: `getAPI(context)` returns `get_keys_api(context)` and `onShutdown` calls `shutdown()`.
// The `view` API has its own bundle (`parent_view.ts`): two entries that share one script left `view` unloaded.

import type { KeysInstallArgs } from "../shared/protocol.ts";
import { is_typing } from "./focus.ts";
import { guard, load_platform, open_main_windows, tabmail_of } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import { create_runtime } from "./runtime.ts";
import type { Invocation, KeydownEvent, Runtime, WindowListener } from "./runtime.ts";
import { create_view_port, front_about_3pane } from "./view.ts";

const MAIN_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";
const WINDOW_LISTENER_ID = "desertbird@uhs-robert/keys";
const NO_WINDOW_ID = -1;

// The invocation listeners belong to the event the background subscribes to.
const invocation_listeners = new Set<(invocation: Invocation) => void>();
let runtime: Runtime | null = null;

function ensure_runtime(context: ExtensionContext): Runtime {
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
        view_port_of(window) {
            const about_3pane = front_about_3pane(tabmail_of(window));
            return about_3pane && create_view_port(about_3pane);
        },
        is_typing_target: (window: MainWindow, event: KeydownEvent) => is_typing(event, window.document as Parameters<typeof is_typing>[1]),
        window_id_of: (window) => context.extension.windowManager?.getWrapper(window)?.id ?? NO_WINDOW_ID,
        emit: (invocation) => {
            for (const listener of invocation_listeners) listener(invocation);
        },
    });
    return runtime;
}

export function get_keys_api(context: ExtensionContext) {
    return {
        keys: {
            install: guard("keys.install", ({ tree }: KeysInstallArgs): void => ensure_runtime(context).install(tree)),
            onInvocation: new (load_platform().ExtensionCommon.EventManager)({
                context,
                name: "keys.onInvocation",
                register: (fire) => {
                    const listener = (invocation: Invocation) => fire.async(invocation);
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
