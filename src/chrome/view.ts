// The one file that touches the thread list of `about:3pane`. Everything else in the chrome runtime sees a ViewPort.

import type { ViewPort } from "./motions.ts";
import { guard, open_main_windows, tabmail_of } from "./platform.ts";
import type { ExtensionContext } from "./platform.ts";
import type { KeysViewAllThreadsArgs, KeysViewRowsArgs, KeysViewRowsResult, KeysViewScrollArgs, KeysViewThreadArgs } from "../shared/protocol.ts";

/** What the runtime reads from `about:3pane`. Thunderbird has no typings, so the used members are listed here. */
export interface DbViewLike {
    rowCount: number;
    /** The headers behind the selected rows. A collapsed thread counts as all its messages, as for Thunderbird's own archive and delete. */
    getSelectedMsgHdrs(): unknown[];
}

export interface ThreadTreeLike {
    selectedIndex: number;
    currentIndex: number;
    scrollToIndex?(index: number, instant?: boolean): void;

    /** The focusable body of the list. The overlay returns the focus here. */
    table?: { body?: { focus?(): void } };
    focus?(): void;
}

export interface About3PaneLike {
    gDBView: DbViewLike | null;
    threadTree: ThreadTreeLike;
}

/** The members only the thread verbs read, kept apart so the key path needs none of them. */
export interface RowsDbView extends DbViewLike {
    getMsgHdrAt(index: number): { isRead: boolean } | null;
    getLevel(index: number): number;
    isContainer(index: number): boolean;
    isContainerOpen(index: number): boolean;
}

export interface RowsThreadTree extends ThreadTreeLike {
    expandRowAtIndex(index: number): void;
    collapseRowAtIndex(index: number): void;
    getRowAtIndex(index: number): { offsetHeight: number } | null;
    clientHeight: number;
    scrollTo(options: { top: number; behavior: "instant" }): void;
    table?: ThreadTreeLike["table"] & { header?: { clientHeight: number } };
}

export interface ThreadVerbPane extends About3PaneLike {
    gDBView: RowsDbView | null;
    threadTree: RowsThreadTree;
    /** Thunderbird's own command table of the thread pane, which `cmd_expandAllThreads` and `cmd_collapseAllThreads` run through. */
    commandController: { doCommand(command: string): void };
}

export interface TabInfoLike {
    mode: { name: string };
    chromeBrowser?: { contentWindow: About3PaneLike | null } | null;
}

export interface TabmailLike {
    currentTabInfo: TabInfoLike | null;
}

/** The thread list a key acts on: the rows the motions move over, and the selection a background command acts on. */
export interface ListPort extends ViewPort {
    selected_message_ids(): number[];
}

/** The MailExtension id of a message header, or null when the extension cannot name it. */
export type MessageIdOf = (header: unknown) => number | null;

export const MAIL_TAB_MODE = "mail3PaneTab";

/** The `about:3pane` of the tab in front, or null when that tab is not a mail tab. */
export function front_about_3pane<Pane extends About3PaneLike = About3PaneLike>(tabmail: TabmailLike | null): Pane | null {
    const tab = tabmail?.currentTabInfo;
    // The tab holds the whole about:3pane. `Pane` names the members a caller reads from it.
    return tab?.mode.name === MAIL_TAB_MODE ? ((tab.chromeBrowser?.contentWindow as Pane | null | undefined) ?? null) : null;
}

export function create_list_port(about_3pane: About3PaneLike, message_id_of: MessageIdOf): ListPort {
    const tree = about_3pane.threadTree;
    return {
        row_count: () => about_3pane.gDBView?.rowCount ?? 0,
        selected_index: () => tree.currentIndex ?? -1,
        select(index) {
            tree.selectedIndex = index;
            tree.scrollToIndex?.(index);
        },
        selected_message_ids() {
            const headers = about_3pane.gDBView?.getSelectedMsgHdrs() ?? [];
            return headers.map(message_id_of).filter((id) => id !== null);
        },
    };
}

const ROW_CAP = 500;

/** The rows `first` to `last`, ends included and cut to the list and to ROW_CAP rows, so one call never converts a whole large folder. `current` is the current row, or -1. */
export function read_rows(about_3pane: ThreadVerbPane, first: number, last: number, message_id_of: MessageIdOf): KeysViewRowsResult {
    const view = about_3pane.gDBView;
    const end = Math.min(last, (view?.rowCount ?? 0) - 1, first + ROW_CAP - 1);
    const rows: KeysViewRowsResult["rows"] = [];
    for (let index = first; view && index <= end; index++) {
        const header = view.getMsgHdrAt(index);
        rows.push({ index, id: header && message_id_of(header), depth: view.getLevel(index), collapsed: view.isContainer(index) && !view.isContainerOpen(index), unread: header?.isRead === false });
    }
    return { current: about_3pane.threadTree.currentIndex ?? -1, rows };
}

// The tree only offers scrollToIndex, which moves just far enough to show the row. So the position is computed from the row height and the visible height under the sticky header.
export function scroll_row(tree: RowsThreadTree, row: number, position: KeysViewScrollArgs["position"]): void {
    tree.scrollToIndex?.(row, true);
    const height = tree.getRowAtIndex(row)?.offsetHeight ?? 0;
    const visible = tree.clientHeight - (tree.table?.header?.clientHeight ?? 0);
    const top = row * height;
    const target = { top, center: top + (height - visible) / 2, bottom: top + height - visible }[position];
    tree.scrollTo({ top: Math.max(0, target), behavior: "instant" });
}

/** The thread verbs of the `keys` API. Each names a window by its id and acts on the thread list of its front mail tab. They read and move the view and know no command. */
export function view_verbs(context: ExtensionContext) {
    const message_id_of: MessageIdOf = (header) => context.extension.messageManager.convert(header, { skipFolder: true })?.id ?? null;
    const about_3pane_of = (window_id: number): ThreadVerbPane => {
        const window = open_main_windows().find((candidate) => context.extension.windowManager.getWrapper(candidate)?.id === window_id);
        const about_3pane = window && front_about_3pane<ThreadVerbPane>(tabmail_of(window));
        if (!about_3pane) throw new Error("the window shows no mail tab");
        return about_3pane;
    };
    const row_of = (args: { windowId: number; row: number }): [ThreadVerbPane, number] => {
        const about_3pane = about_3pane_of(args.windowId);
        if (args.row >= (about_3pane.gDBView?.rowCount ?? 0)) throw new Error(`row ${args.row} is not in the list`);
        return [about_3pane, args.row];
    };
    return {
        viewRows: guard("keys.viewRows", ({ windowId, first, last }: KeysViewRowsArgs) => read_rows(about_3pane_of(windowId), first, last, message_id_of)),
        viewThread: guard("keys.viewThread", (args: KeysViewThreadArgs): void => {
            const [about_3pane, row] = row_of(args);
            if (args.open) about_3pane.threadTree.expandRowAtIndex(row);
            else about_3pane.threadTree.collapseRowAtIndex(row);
        }),
        viewAllThreads: guard("keys.viewAllThreads", ({ windowId, open }: KeysViewAllThreadsArgs): void => about_3pane_of(windowId).commandController.doCommand(open ? "cmd_expandAllThreads" : "cmd_collapseAllThreads")),
        viewScroll: guard("keys.viewScroll", (args: KeysViewScrollArgs): void => {
            const [about_3pane, row] = row_of(args);
            scroll_row(about_3pane.threadTree, row, args.position);
        }),
    };
}
