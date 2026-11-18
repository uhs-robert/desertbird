// What a hint can point at in a mail tab, and what picking it does. It reads the main window and the `about:3pane` and `about:message` documents inside it, and names Thunderbird members only through the interfaces below.

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

const pick_control = (element: TargetElement): void => {
    if (element.matches("input")) element.focus();
    else if (element.matches("tab")) element.closest("tabs")!.selectedItem = element;
    else element.click();
};

function on_screen(window: TargetWindow, selector: string, keep: (element: TargetElement) => boolean, act: (element: TargetElement) => void): PickTarget[] {
    return [...(window.document.querySelectorAll(selector) as Iterable<TargetElement>)].filter((element) => keep(element) && is_on_screen(window, element)).map((element) => ({ window, element, act: () => act(element) }));
}

const controls_outside_rows = (window: TargetWindow): PickTarget[] => on_screen(window, CONTROLS, (element) => element.closest(INSIDE_A_ROW) === null, pick_control);

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
        }),
        ...on_screen(pane, THREAD_ROWS, () => true, (element) => {
            pane.threadTree.selectedIndex = element.index!;
            pane.threadTree.table?.body?.focus?.();
        }),
        ...controls_outside_rows(pane),
        ...(message ? controls_outside_rows(message) : []),
    ];
}
