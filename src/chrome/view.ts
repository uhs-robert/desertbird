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
    getKeyAt?(index: number): number;
}

export interface ThreadTreeLike {
    selectedIndex: number;
    selectedIndices?: number[];
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
    getMsgHdrAt(index: number): { isRead: boolean; flags: number } | null;
    getLevel(index: number): number;
    isContainer(index: number): boolean;
    isContainerOpen(index: number): boolean;
}

export interface RowsThreadTree extends ThreadTreeLike {
    expandRowAtIndex(index: number): void;
    collapseRowAtIndex(index: number): void;
    getRowAtIndex(index: number): { scrollIntoView(options: { block: "start" | "center" | "end"; behavior: "instant" }): void } | null;
    scrollBy(options: { top: number; behavior: "instant" }): void;
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
    /** The browser of a content tab. `isRemoteBrowser` is true when its page runs in another process. */
    browser?: { isRemoteBrowser?: boolean; focus(): void } | null;
}

export interface TabmailLike {
    currentTabInfo: TabInfoLike | null;
}

/** The thread list a key acts on: the rows the motions move over, and the selection a background command acts on. */
export interface ListPort extends ViewPort {
    selected_message_ids(): number[];
    /** Selects every row from `anchor` to `end` and makes `end` the current row, so a motion goes on from there. */
    select_range(anchor: number, end: number): void;
    /** The view and the message keys at two rows. Equal marks mean the list shows the same messages there, so a row inserted or removed between them shifts the far one. */
    marks(anchor: number, end: number): unknown[];
}

/** The MailExtension id of a message header, or null when the extension cannot name it. */
export type MessageIdOf = (header: unknown) => number | null;

export const MAIL_TAB_MODE = "mail3PaneTab";

/** Which tab is in front: 0 the mail tab, 1 a tab whose document the focus chain reads, 2 any other. */
export function tab_kind(tabmail: TabmailLike | null): 0 | 1 | 2 {
    const mode = tabmail?.currentTabInfo?.mode.name;
    return mode && mode !== MAIL_TAB_MODE ? (/^(calendar|addressBookTab|preferencesTab)$/.test(mode) ? 1 : 2) : 0;
}

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
        marks: (anchor, end) => [about_3pane.gDBView, about_3pane.gDBView?.getKeyAt?.(anchor), about_3pane.gDBView?.getKeyAt?.(end)],
        select_range(anchor, end) {
            const first = Math.min(anchor, end);
            tree.selectedIndices = Array.from({ length: Math.abs(end - anchor) + 1 }, (_, offset) => first + offset);
            tree.currentIndex = end;
        },
        selected_message_ids() {
            const headers = about_3pane.gDBView?.getSelectedMsgHdrs() ?? [];
            return headers.map(message_id_of).filter((id) => id !== null);
        },
    };
}

export function read_rows(about_3pane: ThreadVerbPane, first: number, last: number, message_id_of: MessageIdOf): KeysViewRowsResult {
    const view = about_3pane.gDBView;
    const rows: KeysViewRowsResult["rows"] = [];
    for (let index = first; view && index <= Math.min(last, view.rowCount - 1, first + 499); index++) {
        const header = view.getMsgHdrAt(index);
        rows.push({ index, id: header && message_id_of(header), depth: view.getLevel(index), collapsed: view.isContainer(index) && !view.isContainerOpen(index), unread: header?.isRead === false, flags: header?.flags ?? 0 });
    }
    return { current: about_3pane.threadTree.currentIndex ?? -1, rows };
}

const SCROLL_BLOCK = { top: "start", center: "center", bottom: "end" } as const;
// The sticky column header covers the top of the list, which scrollIntoView ignores. Top moves back by its height and center by half.
const HEADER_SHARE = { top: 1, center: 0.5, bottom: 0 } as const;

// scrollToIndex first, because only rows near the view have an element.
export function scroll_row(tree: RowsThreadTree, row: number, position: KeysViewScrollArgs["position"]): void {
    tree.scrollToIndex?.(row, true);
    tree.getRowAtIndex(row)?.scrollIntoView({ block: SCROLL_BLOCK[position], behavior: "instant" });
    tree.scrollBy({ top: -(tree.table?.header?.clientHeight ?? 0) * HEADER_SHARE[position], behavior: "instant" });
}

/** The `about:3pane` of the front mail tab of a window named by id, or a throw when the window shows no mail tab. */
export function mail_pane_of(context: ExtensionContext, window_id: number): ThreadVerbPane {
    const window = open_main_windows().find((candidate) => context.extension.windowManager.getWrapper(candidate)?.id === window_id);
    const about_3pane = window && front_about_3pane<ThreadVerbPane>(tabmail_of(window));
    if (!about_3pane) throw new Error("the window shows no mail tab");
    return about_3pane;
}

/** The `keys` thread verbs: each names a window by id and acts on its front mail tab. */
export function view_verbs(context: ExtensionContext) {
    const about_3pane_of = (window_id: number) => mail_pane_of(context, window_id);
    return {
        viewRows: guard("keys.viewRows", ({ windowId, first, last }: KeysViewRowsArgs) => read_rows(about_3pane_of(windowId), first, last, (header) => context.extension.messageManager.convert(header, { skipFolder: true })?.id ?? null)),
        viewThread: guard("keys.viewThread", ({ windowId, row, open }: KeysViewThreadArgs): void => about_3pane_of(windowId).threadTree[open ? "expandRowAtIndex" : "collapseRowAtIndex"](row)),
        viewAllThreads: guard("keys.viewAllThreads", ({ windowId, open }: KeysViewAllThreadsArgs): void => about_3pane_of(windowId).commandController.doCommand(open ? "cmd_expandAllThreads" : "cmd_collapseAllThreads")),
        viewScroll: guard("keys.viewScroll", ({ windowId, row, position }: KeysViewScrollArgs): void => scroll_row(about_3pane_of(windowId).threadTree, row, position)),
    };
}
