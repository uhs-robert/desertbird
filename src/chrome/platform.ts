// The Thunderbird globals the Experiment parent reads, and the guard every verb runs through. Nothing here keeps state.
// Platform modules load through `ChromeUtils.importESModule` inside functions, never at the top, so node tests load the parents with stub globals.

import type { KeydownEvent, KeyTarget } from "./runtime.ts";
import type { FocusDocument } from "./focus.ts";
import type { TabmailLike } from "./view.ts";

declare const ChromeUtils: { importESModule(url: string): Record<string, any> };
declare const Services: { wm: { getEnumerator(type: string | null): Iterable<MainWindow> } };

export interface MainWindow extends KeyTarget {
    addEventListener(type: "keydown", listener: (event: KeydownEvent) => void, capture: boolean): void;
    addEventListener(type: "TabSelect", listener: () => void, capture: boolean): void;
    addEventListener(type: "unload" | "load", listener: () => void, options: { once: true }): void;
    addEventListener(type: "blur" | "focusin" | "focusout", listener: () => void, capture: boolean): void;
    removeEventListener(type: "keydown", listener: (event: KeydownEvent) => void, capture: boolean): void;
    removeEventListener(type: "TabSelect", listener: () => void, capture: boolean): void;
    removeEventListener(type: "unload", listener: () => void): void;
    removeEventListener(type: "blur" | "focusin" | "focusout", listener: () => void, capture: boolean): void;
    matchMedia(query: string): { matches: boolean; addEventListener(type: "change", listener: () => void): void; removeEventListener(type: "change", listener: () => void): void };
    document: FocusDocument & { getElementById(id: string): unknown; hasFocus(): boolean; readyState: string };
}

export interface ExtensionContext {
    extension: {
        windowManager: { getWrapper(window: MainWindow): { id: number } | null };
        /** Used by the folder pane verbs only. `get` is the folder of an account and path, as the `folders` API names them. */
        folderManager?: { get(account_id: string, path: string): { URI: string } | null };
        /** Present with the `messagesRead` permission. `convert` builds the whole MailExtension header of a message, `skipFolder` drops its folder part. */
        messageManager: { convert(header: unknown, options: { skipFolder: true }): { id: number } | null };
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
