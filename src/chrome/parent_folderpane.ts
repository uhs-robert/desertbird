// The parent script of the `folderpane` API: the verbs that read or change the folder tree. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `folderpane`. Thunderbird loads it when the first call arrives, so the key script, which loads at startup, carries none of it. Later folder pane features (search) add their verbs here.

import { focused_pane } from "./focus.ts";
import { guard } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import { mail_pane_of } from "./view.ts";
import type { FolderpaneFoldArgs } from "../shared/protocol.ts";

interface FolderRowLike {
    classList: { contains(name: string): boolean };
    parentNode: { closest(selector: string): FolderRowLike | null } | null;
}

interface FolderTreeLike {
    rowCount: number;
    selectedIndex: number;
    selectedRow: FolderRowLike | null;
    getRowAtIndex(index: number): unknown;
    querySelectorAll(selector: string): ArrayLike<FolderRowLike>;
    expandRow(row: unknown): void;
    collapseRow(row: unknown): void;
}

interface FolderPane {
    folderTree: FolderTreeLike;
    browsingContext: { topChromeWindow: MainWindow };
}

// Row classes of the folder tree: `children` marks a folder with subfolders and `collapsed` a closed one. `unselectable` marks the invisible wrapper row that holds every account (measured in the folder tree), which must stay open or the whole tree disappears. Opening every row takes one pass per level of nesting, and the pass count caps it, so a row that refuses to open cannot loop.
const MAX_FOLDER_DEPTH = 12;

function fold_folders(tree: FolderTreeLike, { open, extent }: Pick<FolderpaneFoldArgs, "open" | "extent">): void {
    const row = tree.selectedRow;
    if (extent === "row") {
        if (row) tree[open ? "expandRow" : "collapseRow"](row);
    } else if (extent === "all") {
        // Document order lists a parent before its children. Closing a hidden row corrupts the tree, so a close walks backward and shuts the children first, and an open walks forward and shows each parent first.
        for (let pass = 0; pass < MAX_FOLDER_DEPTH; pass++) {
            const rows = Array.from(tree.querySelectorAll(open ? "li.children.collapsed" : "li.children:not(.collapsed):not(.unselectable)"));
            for (const each of open ? rows : rows.reverse()) tree[open ? "expandRow" : "collapseRow"](each);
        }
    } else if (row?.classList.contains("children") && !row.classList.contains("collapsed")) tree.collapseRow(row);
    else {
        const parent = row?.parentNode?.closest("li:not(.unselectable)");
        if (!parent) return;
        tree.collapseRow(parent);
        for (let index = 0; index < tree.rowCount; index++) if (tree.getRowAtIndex(index) === parent) tree.selectedIndex = index;
    }
}

export function get_folderpane_api(context: ExtensionContext) {
    return {
        folderpane: {
            fold: guard("folderpane.fold", ({ windowId, open, extent }: FolderpaneFoldArgs): boolean => {
                const pane = mail_pane_of(context, windowId) as unknown as FolderPane;
                const in_folder_pane = focused_pane(pane.browsingContext.topChromeWindow.document) === 0;
                if (in_folder_pane) fold_folders(pane.folderTree, { open, extent });
                return in_folder_pane;
            }),
        },
    };
}

/** Holds no state, so there is nothing to remove. */
export function shutdown(): void {}
