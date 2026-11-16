// What both Experiment parents share: the Thunderbird globals they read and the verb guard. Each parent bundle holds its own copy of this file and of view.ts, so no state lives here.
// Platform modules load through `ChromeUtils.importESModule` inside functions, never at the top, so node tests load the parents with stub globals.

import type { KeyTarget } from "./runtime.ts";
import type { MessageHeaderLike, TabmailLike } from "./view.ts";

declare const ChromeUtils: { importESModule(url: string): Record<string, any>; now(): number };
declare const Services: { wm: { getEnumerator(type: string | null): Iterable<MainWindow>; getMostRecentWindow(type: string): MainWindow | null } };

export interface MainWindow extends KeyTarget {
    document: { getElementById(id: string): unknown; activeElement: unknown };
}

export interface ExtensionContext {
    extension: {
        messageManager: { convert(header: MessageHeaderLike): { id: number } };
        windowManager?: { getWrapper(window: MainWindow): { id: number } | null };
    };
}

export interface Platform {
    ExtensionCommon: { EventManager: new (options: { context: unknown; name: string; register: (fire: { async(value: unknown): void }) => () => void }) => { api(): unknown } };
    ExtensionSupport: { registerWindowListener(id: string, listener: object): void; unregisterWindowListener(id: string): void };
    ExtensionError: new (message: string) => Error;
}

export const MAIN_WINDOW_TYPE = "mail:3pane";

export function load_platform(): Platform {
    return {
        ExtensionCommon: ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs").ExtensionCommon,
        ExtensionSupport: ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs").ExtensionSupport,
        ExtensionError: ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs").ExtensionUtils.ExtensionError,
    };
}

export const open_main_windows = (): MainWindow[] => Array.from(Services.wm.getEnumerator(MAIN_WINDOW_TYPE));

export const most_recent_main_window = (): MainWindow | null => Services.wm.getMostRecentWindow(MAIN_WINDOW_TYPE);

export const tabmail_of = (window: MainWindow): TabmailLike | null => window.document.getElementById("tabmail") as TabmailLike | null;

// The default error of an Experiment verb hides the cause, so each verb rethrows an ExtensionError that carries the message.
export function guard<Args extends unknown[], Result>(name: string, verb: (...args: Args) => Result | Promise<Result>): (...args: Args) => Promise<Result> {
    return async (...args) => {
        try {
            return await verb(...args);
        } catch (error) {
            throw new (load_platform().ExtensionError)(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
}
