// The parent script of the `zoom` API: read and set the zoom of what a window shows. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `zoom`. Thunderbird loads it when the first call arrives, so the key script, which loads at startup, carries none of it.
// `getBrowser()` is the browser Thunderbird's own View > Zoom acts on: the message pane in the mail tab, a message tab and a message window, the page of the address book, settings and content tabs. It is null in calendar, tasks and a mail tab that shows no message (measured in Thunderbird and Betterbird 153).

import { guard, open_windows } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import type { ZoomGetArgs, ZoomSetArgs } from "../shared/protocol.ts";

// ZoomManager reads the browser itself, so this code needs no member of it.
type ZoomBrowser = object;

interface ZoomWindow extends MainWindow {
    getBrowser?(): ZoomBrowser | null;
    ZoomManager: { getZoomForBrowser(browser: ZoomBrowser): number; setZoomForBrowser(browser: ZoomBrowser, level: number): void };
}

const WINDOW_TYPES = ["mail:3pane", "mail:messageWindow"];

export function get_zoom_api(context: ExtensionContext) {
    function zoomable(window_id: number): { window: ZoomWindow; browser: ZoomBrowser } | null {
        const window = WINDOW_TYPES.flatMap(open_windows).find((candidate) => context.extension.windowManager.getWrapper(candidate)?.id === window_id) as ZoomWindow | undefined;
        if (!window) throw new Error("no main or message window has that id");
        const browser = window.getBrowser?.();
        return browser ? { window, browser } : null;
    }
    return {
        zoom: {
            get: guard("zoom.get", ({ windowId }: ZoomGetArgs): number | null => {
                const target = zoomable(windowId);
                return target && target.window.ZoomManager.getZoomForBrowser(target.browser);
            }),
            set: guard("zoom.set", ({ windowId, level }: ZoomSetArgs): boolean => {
                const target = zoomable(windowId);
                target?.window.ZoomManager.setZoomForBrowser(target.browser, level);
                return target !== null;
            }),
        },
    };
}

/** Holds no state, so there is nothing to remove. */
export function shutdown(): void {}
