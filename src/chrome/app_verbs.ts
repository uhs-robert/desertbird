// The `app` verbs that move the focus between panes, run a Thunderbird command and open a fixed page. Each table below is the whole set a verb can reach: the schema enum names the keys, and no caller passes a function name or an address.

import { focused_pane } from "./focus.ts";
import type { MainWindow, ExtensionContext } from "./platform.ts";
import { guard, open_main_windows, open_windows, tabmail_of } from "./platform.ts";
import { move_border, reset_sizes } from "./pane_resize.ts";
import type { ResizePane } from "./pane_resize.ts";
import { mail_pane_of } from "./view.ts";
import type { FolderTreeLike, ThreadVerbPane } from "./view.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE } from "../shared/protocol.ts";
import type { AppCommandArgs, AppOpenPageArgs, AppPaneFocusArgs, AppPaneResizeArgs } from "../shared/protocol.ts";

interface Controller {
    isCommandEnabled(name: string): boolean;
    doCommand(name: string): void;
}

interface AppWindow extends MainWindow {
    openAddonsMgr(view: string): void;
    openContentTab(url: string): void;
}

interface MessageBodyBrowser {
    focus(): void;
    contentDocument?: { documentElement?: { hasAttribute(name: string): boolean } | null } | null;
}

/** The members of `about:3pane` these verbs read. Its main window is `browsingContext.topChromeWindow`. */
interface AppPane extends ThreadVerbPane, ResizePane {
    folderTree: FolderTreeLike;
    messageBrowser: { contentWindow?: { getMessagePaneBrowser?(): MessageBodyBrowser } | null };
    paneLayout: ResizePane["paneLayout"] & { folderPaneVisible: boolean; messagePaneVisible: boolean };
    browsingContext: { topChromeWindow: AppWindow };
}

interface ControllerHolder {
    commandController?: Controller;
}

const MESSAGE_WINDOW_TYPE = "mail:messageWindow";

// `about:3pane`, `about:message` of a message tab or window: each controller acts on its own page's message.
const CONTROLLERS = { cmd_openConversation: (holder: ControllerHolder) => holder.commandController };

function controller_holder_of(context: ExtensionContext, window_id: number): ControllerHolder | null | undefined {
    const is_window = (candidate: MainWindow) => context.extension.windowManager.getWrapper(candidate)?.id === window_id;
    const message_window = open_windows(MESSAGE_WINDOW_TYPE).find(is_window) as (MainWindow & { messageBrowser?: { contentWindow?: ControllerHolder | null } }) | undefined;
    if (message_window) return message_window.messageBrowser?.contentWindow;
    const main_window = open_main_windows().find(is_window);
    return main_window && (tabmail_of(main_window)?.currentTabInfo?.chromeBrowser?.contentWindow as ControllerHolder | null | undefined);
}

const PAGES = {
    addons: (window: AppWindow) => window.openAddonsMgr("addons://list/extension"),
    themes: (window: AppWindow) => window.openAddonsMgr("addons://list/theme"),
    config: (window: AppWindow) => window.openContentTab("about:config"),
};

// The panes in their order on screen, which `focused_pane` counts by, each giving the element to focus. A pane gives none where keys would reach nothing: a collapsed pane hides its focus, and a message pane with no body script (no message, a thread summary) swallows every plain key.
const PANES = [
    (pane: AppPane) => pane.paneLayout.folderPaneVisible && pane.folderTree,
    (pane: AppPane) => pane.threadTree.table?.body,
    (pane: AppPane) => {
        const body = pane.messageBrowser.contentWindow?.getMessagePaneBrowser?.();
        return pane.paneLayout.messagePaneVisible && body?.contentDocument?.documentElement?.hasAttribute(BODY_SCRIPT_LIVE_ATTRIBUTE) && body;
    },
];

const PANE_NAMES = ["folders", "threads", "message"];

export function app_verbs(context: ExtensionContext) {
    const pane_of = (window_id: number) => mail_pane_of(context, window_id) as AppPane;
    return {
        paneFocus: guard("app.paneFocus", ({ windowId, pane }: AppPaneFocusArgs): boolean => {
            const about_3pane = pane_of(windowId);
            const focused = focused_pane(about_3pane.browsingContext.topChromeWindow.document);
            // Past either end the index finds no pane, so the focus stays.
            const element = PANES[pane === "left" ? focused - 1 : pane === "right" ? focused + 1 : PANE_NAMES.indexOf(pane)]?.(about_3pane);
            element && element.focus?.();
            return !!element;
        }),
        paneResize: guard("app.paneResize", ({ windowId, direction, steps }: AppPaneResizeArgs): boolean => {
            const about_3pane = pane_of(windowId);
            const pane = focused_pane(about_3pane.browsingContext.topChromeWindow.document);
            return direction === "reset" ? reset_sizes(about_3pane) : move_border(about_3pane, pane, direction, steps);
        }),
        appCommand: guard("app.appCommand", ({ windowId, name }: AppCommandArgs): boolean => {
            const holder = controller_holder_of(context, windowId);
            const controller = holder && CONTROLLERS[name](holder);
            if (!controller) throw new Error("the window shows no message");
            const enabled = controller.isCommandEnabled(name);
            if (enabled) controller.doCommand(name);
            return enabled;
        }),
        appOpenPage: guard("app.appOpenPage", ({ windowId, page }: AppOpenPageArgs): void => PAGES[page](pane_of(windowId).browsingContext.topChromeWindow)),
    };
}
