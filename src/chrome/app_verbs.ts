// The `keys` verbs that move the focus between panes, open or close a folder row, run a Thunderbird command and open a fixed page. Each table below is the whole set a verb can reach: the schema enum names the keys, and no caller passes a function name or an address.

import { focus_chain } from "./focus.ts";
import type { MainWindow, ExtensionContext } from "./platform.ts";
import { guard } from "./platform.ts";
import { mail_pane_of } from "./view.ts";
import type { ThreadVerbPane } from "./view.ts";
import type { KeysAppCommandArgs, KeysAppOpenPageArgs, KeysFolderTreeExpandArgs, KeysPaneFocusArgs } from "../shared/protocol.ts";

interface Controller {
    isCommandEnabled(name: string): boolean;
    doCommand(name: string): void;
}

interface FolderTreeLike {
    selectedRow: unknown;
    expandRow(row: unknown): void;
    collapseRow(row: unknown): void;
    focus(): void;
}

interface AppWindow extends MainWindow {
    DefaultController: Controller;
    openAddonsMgr(view: string): void;
    openContentTab(url: string): void;
}

/** The members of `about:3pane` these verbs read. Its main window is `browsingContext.topChromeWindow`. */
interface AppPane extends ThreadVerbPane {
    folderTree: FolderTreeLike;
    messageBrowser: { contentWindow?: { getMessagePaneBrowser?(): { focus(): void } } | null };
    browsingContext: { topChromeWindow: AppWindow };
}

const CONTROLLERS = { cmd_undo: (pane: AppPane) => pane.browsingContext.topChromeWindow.DefaultController, cmd_openConversation: (pane: AppPane) => pane.commandController as Controller };

const PAGES = {
    addons: (window: AppWindow) => window.openAddonsMgr("addons://list/extension"),
    themes: (window: AppWindow) => window.openAddonsMgr("addons://list/theme"),
    config: (window: AppWindow) => window.openContentTab("about:config"),
};

const PANES = {
    folders: (pane: AppPane) => pane.folderTree,
    threads: (pane: AppPane) => pane.threadTree.table?.body,
    message: (pane: AppPane) => pane.messageBrowser.contentWindow?.getMessagePaneBrowser?.(),
};

export function app_verbs(context: ExtensionContext) {
    const pane_of = (window_id: number) => mail_pane_of(context, window_id) as AppPane;
    return {
        folderTreeExpand: guard("keys.folderTreeExpand", ({ windowId, open }: KeysFolderTreeExpandArgs): boolean => {
            const pane = pane_of(windowId);
            const in_folder_pane = focus_chain(pane.browsingContext.topChromeWindow.document).some((node) => node.id === "folderTree");
            if (in_folder_pane && pane.folderTree.selectedRow) pane.folderTree[open ? "expandRow" : "collapseRow"](pane.folderTree.selectedRow);
            return in_folder_pane;
        }),
        paneFocus: guard("keys.paneFocus", ({ windowId, pane }: KeysPaneFocusArgs): void => PANES[pane](pane_of(windowId))?.focus?.()),
        appCommand: guard("keys.appCommand", ({ windowId, name }: KeysAppCommandArgs): boolean => {
            const controller = CONTROLLERS[name](pane_of(windowId));
            const enabled = controller.isCommandEnabled(name);
            if (enabled) controller.doCommand(name);
            return enabled;
        }),
        appOpenPage: guard("keys.appOpenPage", ({ windowId, page }: KeysAppOpenPageArgs): void => PAGES[page](pane_of(windowId).browsingContext.topChromeWindow)),
    };
}
