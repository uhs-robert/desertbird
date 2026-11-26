// The parent script of the `folderpane` API: the verbs that read or change the folder tree. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `folderpane`. Thunderbird loads it when the first call arrives, so the key script, which loads at startup, carries none of it.

import { focused_pane } from "./focus.ts";
import { guard } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import { mail_pane_of } from "./view.ts";
import { find_flagged_row } from "./flag_scan.ts";
import type { MessageView } from "./flag_scan.ts";
import type { FolderpaneFoldArgs, FolderpaneFocusedArgs, FolderpaneIndexFolderArgs, FolderpaneViewFindRowArgs, FolderpaneViewRowCountArgs, FoundRow } from "../shared/protocol.ts";

declare const ChromeUtils: { importESModule(url: string): Record<string, any> };
declare const Ci: any;

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
    gDBView?: MessageView;
    browsingContext: { topChromeWindow: MainWindow };
}

// Row classes of the folder tree: `children` marks a folder with subfolders and `collapsed` a closed one. `unselectable` marks the invisible wrapper row that holds every account (measured in the folder tree), which must stay open or the whole tree disappears. Opening every row takes one pass per level of nesting, and the pass count caps it, so a row that refuses to open cannot loop.
const MAX_FOLDER_DEPTH = 12;

function fold_folders(tree: FolderTreeLike, { open, extent }: Pick<FolderpaneFoldArgs, "open" | "extent">): void {
    const row = tree.selectedRow;
    if (extent === "row") {
        if (row) tree[open ? "expandRow" : "collapseRow"](row);
    } else if (extent === "all") {
        // Document order lists a parent before its children, so a close walks backward and shuts the children first, while their parents still show them. A row inside a parent that is already closed stays as it is: Thunderbird keeps its open state for when the parent opens. An open walks forward and shows each parent first.
        for (let pass = 0; pass < MAX_FOLDER_DEPTH; pass++) {
            const rows = Array.from(tree.querySelectorAll(open ? "li.children.collapsed" : "li.children:not(.collapsed):not(.unselectable)"));
            for (const each of open ? rows : rows.reverse()) if (open || !each.parentNode?.closest("li.collapsed")) tree[open ? "expandRow" : "collapseRow"](each);
        }
    } else if (row?.classList.contains("children") && !row.classList.contains("collapsed")) tree.collapseRow(row);
    else {
        const parent = row?.parentNode?.closest("li:not(.unselectable)");
        if (!parent) return;
        tree.collapseRow(parent);
        const rows = tree.rowCount;
        for (let index = 0; index < rows; index++) if (tree.getRowAtIndex(index) === parent) return void (tree.selectedIndex = index);
    }
}

interface LocalFolder {
    getDatabaseWithReparse(listener: null, window: null): unknown;
}

/**
 * Builds the summary of a local folder that has none or an old one, without showing the folder. Answers true when the parse finished, false for a folder that is not local or a parse that outlasts 30 s (a folder of 10,000 messages takes about 8 s).
 * The listener is on before the call, because a folder that parses at once fires the event inside it. `getDatabaseWithReparse` throws while it starts or joins a parse, so a throw means wait for `FolderLoaded`, which also covers a parse the user started.
 */
async function index_folder(id: string): Promise<boolean> {
    const { folder } = ChromeUtils.importESModule("resource:///modules/ExtensionAccounts.sys.mjs").getFolder(id) as { folder: LocalFolder };
    // The folder comes as a plain nsIMsgFolder, so its local methods show only after this check asks for the local interface. It also answers false for an IMAP folder.
    if (!(folder instanceof Ci.nsIMsgLocalMailFolder)) return false;
    const { mailSession } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs").MailServices;
    const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    return new Promise((resolve) => {
        const watch = { onFolderEvent: (from: unknown, event: string) => event === "FolderLoaded" && from === folder && done(true) };
        // The timer is not cleared: once the wait ended, its late call removes a listener that is gone and resolves a settled promise, which does nothing.
        setTimeout(() => done(false), 30000);
        const done = (ok: boolean) => (mailSession.RemoveFolderListener(watch), resolve(ok));
        mailSession.AddFolderListener(watch, Ci.nsIFolderListener.event);
        try {
            folder.getDatabaseWithReparse(null, null);
            done(true);
        } catch {
            // A parse runs. The listener or the timeout ends the wait.
        }
    });
}

export function get_folderpane_api(context: ExtensionContext) {
    const pane_of = (window_id: number) => mail_pane_of(context, window_id) as unknown as FolderPane;
    const has_focus = (pane: FolderPane) => focused_pane(pane.browsingContext.topChromeWindow.document) === 0;
    return {
        folderpane: {
            fold: guard("folderpane.fold", ({ windowId, open, extent }: FolderpaneFoldArgs): boolean => {
                const pane = pane_of(windowId);
                const in_folder_pane = has_focus(pane);
                if (in_folder_pane) fold_folders(pane.folderTree, { open, extent });
                return in_folder_pane;
            }),
            focused: guard("folderpane.focused", ({ windowId }: FolderpaneFocusedArgs): boolean => has_focus(pane_of(windowId))),
            indexFolder: guard("folderpane.indexFolder", ({ folderId }: FolderpaneIndexFolderArgs) => index_folder(folderId)),
            viewRowCount: guard("folderpane.viewRowCount", ({ windowId }: FolderpaneViewRowCountArgs): number => pane_of(windowId).gDBView?.rowCount ?? 0),
            viewFindRow: guard("folderpane.viewFindRow", ({ windowId, ...search }: FolderpaneViewFindRowArgs): FoundRow => {
                const { index, header } = find_flagged_row(pane_of(windowId).gDBView, search);
                return { index, id: (header && context.extension.messageManager.convert(header, { skipFolder: true })?.id) ?? null };
            }),
        },
    };
}

/** Holds no state, so there is nothing to remove. */
export function shutdown(): void {}
