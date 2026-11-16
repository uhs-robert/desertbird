// The one file that touches the thread list of `about:3pane`. Everything else in the chrome runtime sees a ViewPort.

import type { ViewPort } from "./motions.ts";

/** What the motions read from `about:3pane`. Thunderbird has no typings, so the used members are listed here. */
export interface DbViewLike {
    rowCount: number;
}

export interface ThreadTreeLike {
    selectedIndex: number;
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
    currentTabInfo: TabInfoLike | null;
}

export const MAIL_TAB_MODE = "mail3PaneTab";

/** The `about:3pane` of the tab in front, or null when that tab is not a mail tab. */
export function front_about_3pane(tabmail: TabmailLike | null): About3PaneLike | null {
    const tab = tabmail?.currentTabInfo;
    return tab?.mode.name === MAIL_TAB_MODE ? (tab.chromeBrowser?.contentWindow ?? null) : null;
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
