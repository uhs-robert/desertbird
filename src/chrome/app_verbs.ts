// The `keys` verbs that move the focus between panes, run a Thunderbird command and open a fixed page. Each table below is the whole set a verb can reach: the schema enum names the keys, and no caller passes a function name or an address.

import { focused_pane } from "./focus.ts";
import type { MainWindow, ExtensionContext } from "./platform.ts";
import { guard } from "./platform.ts";
import { mail_pane_of } from "./view.ts";
import type { ThreadVerbPane } from "./view.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE } from "../shared/protocol.ts";
import type { KeysAppCommandArgs, KeysAppOpenPageArgs, KeysPaneFocusArgs } from "../shared/protocol.ts";

interface Controller {
    isCommandEnabled(name: string): boolean;
    doCommand(name: string): void;
}

export interface FolderTreeLike {
    rowCount: number;
    selectedIndex: number;
    focus(): void;
}

interface AppWindow extends MainWindow {
    DefaultController: Controller;
    openAddonsMgr(view: string): void;
    openContentTab(url: string): void;
}

interface MessageBodyBrowser {
    focus(): void;
    contentDocument?: { documentElement?: { hasAttribute(name: string): boolean } | null } | null;
}

/** The members of `about:3pane` these verbs read. Its main window is `browsingContext.topChromeWindow`. */
interface AppPane extends ThreadVerbPane {
    folderTree: FolderTreeLike;
    messageBrowser: { contentWindow?: { getMessagePaneBrowser?(): MessageBodyBrowser } | null };
    paneLayout: { folderPaneVisible: boolean; messagePaneVisible: boolean };
    browsingContext: { topChromeWindow: AppWindow };
}

const CONTROLLERS = { cmd_undo: (pane: AppPane) => pane.browsingContext.topChromeWindow.DefaultController, cmd_openConversation: (pane: AppPane) => pane.commandController as Controller };

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
        paneFocus: guard("keys.paneFocus", ({ windowId, pane }: KeysPaneFocusArgs): boolean => {
            const about_3pane = pane_of(windowId);
            const focused = focused_pane(about_3pane.browsingContext.topChromeWindow.document);
            // Past either end the index finds no pane, so the focus stays.
            const element = PANES[pane === "left" ? focused - 1 : pane === "right" ? focused + 1 : PANE_NAMES.indexOf(pane)]?.(about_3pane);
            element && element.focus?.();
            return !!element;
        }),
        appCommand: guard("keys.appCommand", ({ windowId, name }: KeysAppCommandArgs): boolean => {
            const controller = CONTROLLERS[name](pane_of(windowId));
            const enabled = controller.isCommandEnabled(name);
            if (enabled) controller.doCommand(name);
            return enabled;
        }),
        appOpenPage: guard("keys.appOpenPage", ({ windowId, page }: KeysAppOpenPageArgs): void => PAGES[page](pane_of(windowId).browsingContext.topChromeWindow)),
    };
}
