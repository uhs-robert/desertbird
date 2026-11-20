// What a hint can point at in the front tab, and what picking it does. In a mail tab it reads the main window and the `about:3pane` and `about:message` documents inside it, and names Thunderbird members only through the interfaces below. Any other tab offers the controls of the window and of its own page.

import { is_on_screen } from "../shared/hint_view.ts";
import type { HintElement, HintWindow } from "../shared/hint_view.ts";
import type { PickTarget } from "./hint_pick.ts";

interface TargetElement extends HintElement {
    closest(selector: string): TargetElement | null;
    parentElement: TargetElement | null;
    /** Set on a row of the thread list. */
    index?: number;
    /** Set on a tab: the `tabs` element holds the selection. */
    selectedItem?: unknown;
    /** Set on a link: the absolute address. */
    href?: string;
    textContent: string | null;
    querySelector(selector: string): TargetElement | null;
}

type TargetWindow = HintWindow;

/** The members of `about:3pane` a pick acts through. The window object is the global scope the tree variables live in. */
export interface HintMailPane extends TargetWindow {
    folderTree: { rowCount: number; selectedIndex: number; getRowAtIndex(index: number): unknown; focus(): void };
    threadTree: { selectedIndex: number; scrollToIndex?(index: number): void; table?: { body?: { focus?(): void } } };
    messageBrowser: { contentWindow?: TargetWindow | null };
}

// Buttons and tabs of any document. A field is a target too, and a pick focuses it. Rows and their inner buttons are separate rules, so a row gets one label.
const CONTROLS = "button:not([disabled]), toolbarbutton:not([disabled]), tab, [role=button], input:not([type=hidden]):not([disabled])";
const INSIDE_A_ROW = "#folderTree, tbody";
const FOLDER_ROWS = "#folderTree li:not(.unselectable) > .container";
const THREAD_ROWS = "#threadTree tbody tr";

// A page tab has no rows this file knows, so each control is a target. The list is DesertFox's clickable selector with the XUL controls of Thunderbird's pages added. Its `[tabindex]` catch-all is left out: in a chrome document it marks whole panes and lists.
const PAGE_CONTROLS = `${CONTROLS}, a[href], select:not([disabled]), textarea:not([disabled]), search-textbox, [contenteditable=true], summary, checkbox:not([disabled]), radio:not([disabled]), menulist:not([disabled]), richlistitem, [role=link], [role=tab], [role=checkbox], [role=switch], [role=radio], [role=option], [role=treeitem], [role=menuitem]`;
const FIELDS = "input, select, textarea, search-textbox, [contenteditable=true]";

const pick_control = (element: TargetElement): void => {
    if (element.matches(FIELDS)) element.focus();
    else if (element.matches("tab")) element.closest("tabs")!.selectedItem = element;
    else element.click();
};

// The name and the subject sit in their own elements of a row (`.subject` in a card view row), so a yank copies those and not the unread count or the date.
const FOLDER_NAME = ".name";
const THREAD_SUBJECT = ".subject-line, .subject";

/** A yank copies the address of a link, else the text. */
const yank_text = (element: TargetElement | null): string => (element?.href ?? element?.textContent ?? "").trim();

// A row has no focus of its own to take, so the focus action on a row is its pick: the row is selected and the list keeps the focus.
function on_screen(window: TargetWindow, selector: string, keep: (element: TargetElement) => boolean, act: (element: TargetElement) => void, text_of: (element: TargetElement) => string, focus: (element: TargetElement) => void = act): PickTarget[] {
    return [...(window.document.querySelectorAll(selector) as Iterable<TargetElement>)].filter((element) => keep(element) && is_on_screen(window, element)).map((element) => ({ window, element, act: () => act(element), focus: () => focus(element), text: text_of(element) }));
}

const controls_outside_rows = (window: TargetWindow): PickTarget[] => on_screen(window, CONTROLS, (element) => element.closest(INSIDE_A_ROW) === null, pick_control, yank_text, (element) => element.focus());

/** The targets in the order they sit on screen from the top: the window's own toolbars and tabs, the folder rows, the thread rows and the header buttons, then the message header. A pick selects a row and leaves the focus in its list, so the motion keys go on from there. */
export function collect_targets(main: TargetWindow, pane: HintMailPane): PickTarget[] {
    const message = pane.messageBrowser.contentWindow;
    return [
        ...controls_outside_rows(main),
        ...on_screen(pane, FOLDER_ROWS, () => true, (element) => {
            const tree = pane.folderTree;
            // The index setter selects the row and opens the folder. Setting the row alone selects it and shows no folder.
            for (let index = 0; index < tree.rowCount; index++) if (tree.getRowAtIndex(index) === element.parentElement) tree.selectedIndex = index;
            tree.focus();
        }, (element) => yank_text(element.querySelector(FOLDER_NAME) ?? element)),
        ...on_screen(pane, THREAD_ROWS, () => true, (element) => {
            pane.threadTree.selectedIndex = element.index!;
            pane.threadTree.table?.body?.focus?.();
        }, (element) => yank_text(element.querySelector(THREAD_SUBJECT))),
        ...controls_outside_rows(pane),
        ...(message ? controls_outside_rows(message) : []),
    ];
}

/** The targets of a tab that is not the mail tab: the controls of the window, which holds a calendar or tasks tab itself, then those of the tab's own page (settings, the address book, an `about:` page). `page` is null when the tab has no page the parent can read. */
export const collect_page_targets = (main: TargetWindow, page: TargetWindow | null): PickTarget[] =>
    [main, ...(page ? [page] : [])].flatMap((window) => on_screen(window, PAGE_CONTROLS, () => true, pick_control, yank_text, (element) => element.focus()));
