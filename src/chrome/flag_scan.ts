// The flag scan behind `folderpane.viewFindRow`, apart from the verb so the step tests run the same loop. The step commands find rows here, not through `app.viewRows`, which converts every row to a message id and crosses to the background in blocks of 500. The verb converts only the found row.

import { flags_have } from "../shared/protocol.ts";
import type { FolderpaneViewFindRowArgs } from "../shared/protocol.ts";

export interface FlaggedHeader {
    flags: number;
}

export interface MessageView {
    rowCount: number;
    getMsgHdrAt(index: number): FlaggedHeader | null;
}

/** The `wanted`th row from `from` whose header has the flag, else the last one found, else index -1. The header comes back so the verb can convert that one row to its message id. */
export function find_flagged_row(view: MessageView | undefined, { from, forward, flag, wanted }: Omit<FolderpaneViewFindRowArgs, "windowId">): { index: number; header: FlaggedHeader | null } {
    const rows = view?.rowCount ?? 0;
    let found = { index: -1, header: null as FlaggedHeader | null };
    // Only each header's flags word is read, never a message id. A row with no header matches nothing. Going back, a `from` past the end starts at the last row, since the list can shrink after the caller counted it.
    for (let at = forward ? from : Math.min(from, rows - 1); at >= 0 && at < rows && wanted > 0; at += forward ? 1 : -1) {
        const header = view!.getMsgHdrAt(at);
        if (header && flags_have(header.flags, flag)) (found = { index: at, header }), wanted--;
    }
    return found;
}
