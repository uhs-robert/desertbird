// Gives the keyboard to the page of a tab that just came to the front, so a page of a remote process gets its first keys with no click.
// The key runtime sees nothing of a remote page: with the focus on the window body, a plain key reaches no script and does nothing.

import { load_platform, tabmail_of } from "./platform.ts";
import type { MainWindow } from "./platform.ts";
import { innermost_focus } from "./focus.ts";
import type { FocusNode } from "./focus.ts";
import { MAIL_TAB_MODE } from "./view.ts";

const MAIN_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";
const WINDOW_LISTENER_ID = "desertbird@uhs-robert/pagefocus";

// Nothing focused, the tab strip, or an add-on's toolbar popup (DesertBird's opens the options and help tabs while it still holds the focus, and closes right after). Any other element is the user's own choice (an input they clicked before switching back) and stays.
const YIELDS_FOCUS = new Set(["body", "tab", "tabs"]);
const yields_focus = (active: (FocusNode & { getAttribute?(name: string): string | null }) | null): boolean => !active || YIELDS_FOCUS.has(active.localName ?? "") || active.getAttribute?.("webextension-view-type") === "popup";

interface TimerWindow {
    setTimeout(run: () => void, ms: number): number;
    clearTimeout(id: number): void;
    performance: { now(): number };
}

interface StartupPane {
    document: { readyState: string };
    folderTree?: { focus(): void };
    threadTree?: { table?: { body?: unknown } };
    paneLayout?: { folderPaneVisible: boolean };
}

// A window older than this at hook time is not a launch: the add-on was reloaded or installed in a running session, and the focus is the user's. A window that has not found its mail tab ready by then is given up.
const STARTUP_WINDOW_MS = 30_000;
const STARTUP_POLL_MS = 100;

// Only the first main window of the add-on's run gets the startup focus. A later window (open in new window) opens on a deliberate target. The flag lives as long as the module, so a reload that finds a window already open claims it too, and then its age check refuses.
let startup_focus_claimed = false;

/** One look at the window: "wait" while the mail tab is not ready, "done" once the focus moved or must stay. The focus moves only when the front tab is a mail tab with a visible folder pane and the focus is still untouched. */
export function focus_folder_pane_when_ready(window: MainWindow): "wait" | "done" {
    const tab = tabmail_of(window)?.currentTabInfo;
    if (!tab) return "wait";
    if (tab.mode.name !== MAIL_TAB_MODE) return "done";
    const pane = tab.chromeBrowser?.contentWindow as StartupPane | null | undefined;
    const thread_body = pane?.threadTree?.table?.body;
    if (!pane || pane.document.readyState !== "complete" || !pane.folderTree || !pane.paneLayout || !thread_body) return "wait";
    const active = innermost_focus(window.document);
    // Thunderbird 153 sets no focus of its own at load, so nothing or the body is the usual start. The thread list body counts too, for a restored tab that has already focused it. Anything else is the user's.
    if (pane.paneLayout.folderPaneVisible && (active === thread_body || yields_focus(active as never))) pane.folderTree.focus();
    return "done";
}

function focus_folder_pane_at_startup(window: MainWindow): () => void {
    const timers = window as unknown as TimerWindow;
    if (startup_focus_claimed) return () => {};
    startup_focus_claimed = true;
    let timer = 0;
    let stopped = false;
    const step = () => {
        if (stopped || timers.performance.now() > STARTUP_WINDOW_MS) return;
        if (focus_folder_pane_when_ready(window) === "wait") timer = timers.setTimeout(step, STARTUP_POLL_MS);
    };
    step();
    return () => {
        stopped = true;
        timers.clearTimeout(timer);
    };
}

/** Moves the focus into the front tab's browser when that browser is remote, the tab is a content tab and the focus is on nothing, the tab strip or an add-on's popup. */
export function focus_remote_tab(window: MainWindow): void {
    const active = window.document.activeElement;
    if (!yields_focus(active)) return;
    const tab = tabmail_of(window)?.currentTabInfo;
    if (tab?.mode.name === "contentTab" && tab.browser?.isRemoteBrowser) tab.browser.focus();
}

/** Hooks every main window, now and later. The focus moves after a tick, once Thunderbird has finished its own focus work for the new tab. The first main window also gets the folder pane focus at startup. Returns the function that unhooks them all. */
export function hook_page_focus(): () => void {
    const stops = new Map<MainWindow, () => void>();
    const hook = (window: MainWindow) => {
        const on_tab_select = () => void (window as unknown as TimerWindow).setTimeout(() => focus_remote_tab(window), 0);
        window.addEventListener("TabSelect", on_tab_select, true);
        const stop_startup = focus_folder_pane_at_startup(window);
        stops.set(window, () => {
            stop_startup();
            window.removeEventListener("TabSelect", on_tab_select, true);
        });
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

