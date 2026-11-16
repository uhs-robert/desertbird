// The one file that touches the thread list of `about:3pane`. Everything else in the chrome runtime sees a ViewPort or plain rows.

import type { ViewPort } from "./motions.ts";

/** What a verb reads from `about:3pane`. Thunderbird has no typings, so the used members are listed here. */
export interface MessageHeaderLike {
    isRead: boolean;
}

export interface DbViewLike {
    rowCount: number;
    getMsgHdrAt(index: number): MessageHeaderLike;
    getLevel(index: number): number;
    isContainer(index: number): boolean;
    isContainerOpen(index: number): boolean;
}

export interface ThreadTreeLike {
    selectedIndex: number;
    selectedIndices: number[];
    currentIndex: number;
    scrollToIndex?(index: number, instant?: boolean): void;
}

export interface About3PaneLike {
    gDBView: DbViewLike | null;
    threadTree: ThreadTreeLike;
}

export interface TabInfoLike {
    mode: { name: string };
    chromeBrowser?: { contentWindow: About3PaneLike | null } | null;
}

export interface TabmailLike {
    tabInfo: TabInfoLike[];
    currentTabInfo: TabInfoLike | null;
}

export interface ViewRowData {
    index: number;
    id: number;
    depth: number;
    collapsed: boolean;
    unread: boolean;
}

// One call returns at most this many rows, so a verb cannot stall the window on a big mailbox.
export const MAX_ROWS_PER_CALL = 2000;

export const MAIL_TAB_MODE = "mail3PaneTab";

/** The `about:3pane` of the tab in front, or null when that tab is not a mail tab. */
export function front_about_3pane(tabmail: TabmailLike | null): About3PaneLike | null {
    const tab = tabmail?.currentTabInfo;
    return tab?.mode.name === MAIL_TAB_MODE ? (tab.chromeBrowser?.contentWindow ?? null) : null;
}

/** The `about:3pane` of the first tab, which is always the mail tab. */
export function primary_about_3pane(tabmail: TabmailLike | null): About3PaneLike | null {
    return tabmail?.tabInfo[0]?.chromeBrowser?.contentWindow ?? null;
}

export function create_view_port(about_3pane: About3PaneLike): ViewPort {
    const tree = about_3pane.threadTree;
    return {
        row_count: () => about_3pane.gDBView?.rowCount ?? 0,
        selected_index: () => tree.currentIndex ?? -1,
        select(index) {
            tree.selectedIndex = index;
            tree.scrollToIndex?.(index);
        },
    };
}

export function read_rows(about_3pane: About3PaneLike, first: number, last: number, message_id_of: (header: MessageHeaderLike) => number): ViewRowData[] {
    const view = about_3pane.gDBView;
    if (!view) return [];
    const end = Math.min(last, view.rowCount - 1);
    if (end - first + 1 > MAX_ROWS_PER_CALL) throw new Error(`at most ${MAX_ROWS_PER_CALL} rows per call`);
    const rows: ViewRowData[] = [];
    for (let index = Math.max(first, 0); index <= end; index++) {
        const container = view.isContainer(index);
        rows.push({
            index,
            id: message_id_of(view.getMsgHdrAt(index)),
            depth: view.getLevel(index),
            collapsed: container && !view.isContainerOpen(index),
            unread: !view.getMsgHdrAt(index).isRead,
        });
    }
    return rows;
}

/** Selects every row from `anchor` to `end` and leaves `end` as the current row. */
export function select_range(about_3pane: About3PaneLike, anchor: number, end: number): void {
    const rows = about_3pane.gDBView?.rowCount ?? 0;
    if (anchor < 0 || end < 0 || anchor >= rows || end >= rows) throw new Error("row out of range");
    const tree = about_3pane.threadTree;
    if (anchor === end) {
        tree.selectedIndex = end;
    } else {
        const low = Math.min(anchor, end);
        tree.selectedIndices = Array.from({ length: Math.abs(end - anchor) + 1 }, (_, offset) => low + offset);
        tree.currentIndex = end;
    }
    tree.scrollToIndex?.(end);
}
