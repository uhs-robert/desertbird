// Gives the keyboard to the page of a tab that just came to the front, so a page of a remote process gets its first keys with no click.
// The key runtime sees nothing of a remote page: with the focus on the window body, a plain key reaches no script and does nothing.

import { load_platform, tabmail_of } from "./platform.ts";
import type { MainWindow } from "./platform.ts";
import type { FocusNode } from "./focus.ts";

const MAIN_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";
const WINDOW_LISTENER_ID = "desertbird@uhs-robert/pagefocus";

// Nothing focused, the tab strip, or an add-on's toolbar popup (DesertBird's opens the options and help tabs while it still holds the focus, and closes right after). Any other element is the user's own choice (an input they clicked before switching back) and stays.
const YIELDS_FOCUS = new Set(["body", "tab", "tabs"]);
const yields_focus = (active: (FocusNode & { getAttribute?(name: string): string | null }) | null): boolean => !active || YIELDS_FOCUS.has(active.localName ?? "") || active.getAttribute?.("webextension-view-type") === "popup";

interface TimerWindow {
    setTimeout(run: () => void, ms: number): number;
}

/** Moves the focus into the front tab's browser when that browser is remote, the tab is a content tab and the focus is on nothing, the tab strip or an add-on's popup. */
export function focus_remote_tab(window: MainWindow): void {
    const active = window.document.activeElement;
    if (!yields_focus(active)) return;
    const tab = tabmail_of(window)?.currentTabInfo;
    if (tab?.mode.name === "contentTab" && tab.browser?.isRemoteBrowser) tab.browser.focus();
}

/** Hooks every main window, now and later. The focus moves after a tick, once Thunderbird has finished its own focus work for the new tab. Returns the function that unhooks them all. */
export function hook_page_focus(): () => void {
    const stops = new Map<MainWindow, () => void>();
    const hook = (window: MainWindow) => {
        const on_tab_select = () => void (window as unknown as TimerWindow).setTimeout(() => focus_remote_tab(window), 0);
        window.addEventListener("TabSelect", on_tab_select, true);
        stops.set(window, () => window.removeEventListener("TabSelect", on_tab_select, true));
    };
    const unhook = (window: MainWindow) => {
        stops.get(window)?.();
        stops.delete(window);
    };
    load_platform().ExtensionSupport.registerWindowListener(WINDOW_LISTENER_ID, {
        chromeURLs: [MAIN_WINDOW_URL],
        onLoadWindow: hook,
        onUnloadWindow: unhook,
    });
    return () => {
        load_platform().ExtensionSupport.unregisterWindowListener(WINDOW_LISTENER_ID);
        for (const window of [...stops.keys()]) unhook(window);
    };
}

