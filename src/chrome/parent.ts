// The Experiment's parent side. The build wraps this file in an IIFE and adds a footer that defines the two ExtensionAPI classes (`keys` and `view`):
// each class's `getAPI(context)` returns `get_keys_api(context)` or `get_view_api(context)`, and every `onShutdown` calls `shutdown()`.
// Platform modules load through `ChromeUtils.importESModule` inside functions, never at the top, so node tests can load this file with stub globals.

import type { KeysInstallArgs, ViewRow, ViewRowsArgs, ViewSelectArgs } from "../shared/protocol.ts";
import { create_runtime } from "./runtime.ts";
import type { Invocation, KeyTarget, Runtime, WindowListener } from "./runtime.ts";
import { create_view_port, front_about_3pane, primary_about_3pane, read_rows, select_range } from "./view.ts";
import type { About3PaneLike, MessageHeaderLike, TabmailLike } from "./view.ts";

declare const ChromeUtils: { importESModule(url: string): Record<string, any>; now(): number };
declare const Services: { wm: { getEnumerator(type: string | null): Iterable<MainWindow>; getMostRecentWindow(type: string): MainWindow | null } };

interface MainWindow extends KeyTarget {
    document: { getElementById(id: string): unknown };
}

interface ExtensionContext {
    extension: {
        messageManager: { convert(header: MessageHeaderLike): { id: number } };
        windowManager?: { getWrapper(window: MainWindow): { id: number } | null };
    };
}

const MAIN_WINDOW_TYPE = "mail:3pane";
const MAIN_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";
const WINDOW_LISTENER_ID = "desertbird@uhs-robert/keys";
// Elements whose keys the user types text into, or that hold another page (the overlay and the message body). A key there is not a command.
const TYPING_ELEMENTS = new Set(["input", "textarea", "select", "browser", "search-textbox", "menulist"]);
const NO_WINDOW_ID = -1;

interface Platform {
    ExtensionCommon: { EventManager: new (options: { context: unknown; name: string; register: (fire: { async(value: unknown): void }) => () => void }) => { api(): unknown } };
    ExtensionSupport: { registerWindowListener(id: string, listener: object): void; unregisterWindowListener(id: string): void };
    ExtensionError: new (message: string) => Error;
}

function load_platform(): Platform {
    return {
        ExtensionCommon: ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs").ExtensionCommon,
        ExtensionSupport: ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs").ExtensionSupport,
        ExtensionError: ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs").ExtensionUtils.ExtensionError,
    };
}

// One runtime serves every ExtensionAPI context. The invocation listeners belong to the event the background subscribes to.
const invocation_listeners = new Set<(invocation: Invocation) => void>();
let runtime: Runtime | null = null;

const tabmail_of = (window: MainWindow): TabmailLike | null => window.document.getElementById("tabmail") as TabmailLike | null;

function is_typing_target(target: unknown): boolean {
    const element = target as { localName?: string; isContentEditable?: boolean } | null;
    return element?.isContentEditable === true || TYPING_ELEMENTS.has(element?.localName ?? "");
}

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
        open_windows: () => Array.from(Services.wm.getEnumerator(MAIN_WINDOW_TYPE)),
        view_port_of(window) {
            const about_3pane = front_about_3pane(tabmail_of(window));
            return about_3pane && create_view_port(about_3pane);
        },
        is_typing_target,
        window_id_of: (window) => context.extension.windowManager?.getWrapper(window)?.id ?? NO_WINDOW_ID,
        emit: (invocation) => {
            for (const listener of invocation_listeners) listener(invocation);
        },
    });
    return runtime;
}

// The default error of an Experiment verb hides the cause, so each verb rethrows an ExtensionError that carries the message.
function guard<Args extends unknown[], Result>(name: string, verb: (...args: Args) => Result | Promise<Result>): (...args: Args) => Promise<Result> {
    return async (...args) => {
        try {
            return await verb(...args);
        } catch (error) {
            throw new (load_platform().ExtensionError)(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
}

function main_about_3pane(): About3PaneLike {
    const window = Services.wm.getMostRecentWindow(MAIN_WINDOW_TYPE);
    const about_3pane = window && primary_about_3pane(tabmail_of(window));
    if (!about_3pane) throw new Error("no mail window");
    return about_3pane;
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

export function get_view_api(context: ExtensionContext) {
    return {
        view: {
            rows: guard("view.rows", ({ first, last }: ViewRowsArgs): ViewRow[] => read_rows(main_about_3pane(), first, last, (header) => context.extension.messageManager.convert(header).id)),
            select: guard("view.select", ({ anchor, end }: ViewSelectArgs): void => select_range(main_about_3pane(), anchor, end)),
        },
    };
}

/** Removes every key listener and the window listener, drops the tree and the half-typed sequence, and forgets the event subscribers. */
export function shutdown(): void {
    runtime?.shutdown();
    runtime = null;
    invocation_listeners.clear();
}
