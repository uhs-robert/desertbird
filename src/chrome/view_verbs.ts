// The thread list verbs of the `app` API: read rows, open or close a thread, scroll a row into view. They live apart from `view.ts` so the key script, which loads at startup, carries none of them.

import { guard } from "./platform.ts";
import type { ExtensionContext } from "./platform.ts";
import { mail_pane_of } from "./view.ts";
import type { MessageIdOf, ThreadVerbPane, RowsThreadTree } from "./view.ts";
import type { AppViewAllThreadsArgs, AppViewRowsArgs, AppViewRowsResult, AppViewScrollArgs, AppViewThreadArgs } from "../shared/protocol.ts";

export function read_rows(about_3pane: ThreadVerbPane, first: number, last: number, message_id_of: MessageIdOf): AppViewRowsResult {
    const view = about_3pane.gDBView;
    const rows: AppViewRowsResult["rows"] = [];
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
export function scroll_row(tree: RowsThreadTree, row: number, position: AppViewScrollArgs["position"]): void {
    tree.scrollToIndex?.(row, true);
    tree.getRowAtIndex(row)?.scrollIntoView({ block: SCROLL_BLOCK[position], behavior: "instant" });
    tree.scrollBy({ top: -(tree.table?.header?.clientHeight ?? 0) * HEADER_SHARE[position], behavior: "instant" });
}

/** The thread verbs: each names a window by id and acts on its front mail tab. */
export function view_verbs(context: ExtensionContext) {
    const about_3pane_of = (window_id: number) => mail_pane_of(context, window_id);
    return {
        viewRows: guard("app.viewRows", ({ windowId, first, last }: AppViewRowsArgs) => read_rows(about_3pane_of(windowId), first, last, (header) => context.extension.messageManager.convert(header, { skipFolder: true })?.id ?? null)),
        viewThread: guard("app.viewThread", ({ windowId, row, open }: AppViewThreadArgs): void => about_3pane_of(windowId).threadTree[open ? "expandRowAtIndex" : "collapseRowAtIndex"](row)),
        viewAllThreads: guard("app.viewAllThreads", ({ windowId, open }: AppViewAllThreadsArgs): void => about_3pane_of(windowId).commandController.doCommand(open ? "cmd_expandAllThreads" : "cmd_collapseAllThreads")),
        viewScroll: guard("app.viewScroll", ({ windowId, row, position }: AppViewScrollArgs): void => scroll_row(about_3pane_of(windowId).threadTree, row, position)),
    };
}
