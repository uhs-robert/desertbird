// Moves the border of the focused pane in `about:3pane`, and puts the panes back to their default sizes. It reads where the panes and splitters sit on screen, so it needs no table per layout: a splitter belongs to a pane when it touches the pane on the axis of the move. A splitter is 5 pixels thick and takes 1 pixel of layout, so it overlaps the pane next to its own by 4 pixels, which the gap of up to 5 allows.

import type { PaneResizeDirection } from "../shared/protocol.ts";

declare const Services: { xulStore: { removeValue(url: string, element: string, attribute: string): void } };

interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface BoxElement {
    getBoundingClientRect(): Box;
}

export interface SplitterLike extends BoxElement {
    id: string;
    resizeDirection: "horizontal" | "vertical";
    resizeElement: BoxElement | null;
    width: number | null;
    height: number | null;
    isCollapsed: boolean;
    isDisabled: boolean;
    getAttribute(name: string): string | null;
    dispatchEvent(event: unknown): boolean;
}

/** What the move reads of `about:3pane`. */
export interface ResizePane {
    paneLayout: { folderPaneSplitter: SplitterLike; messagePaneSplitter: SplitterLike };
    document: { getElementById(id: string): BoxElement | null };
    CustomEvent: new (type: string, init: { bubbles: boolean }) => unknown;
}

const STEP_PX = 24;

// Where `PaneLayout` stores each splitter's width and height. The name on `paneLayout` is also the splitter's id.
const STORE_URL = "chrome://messenger/content/messenger.xhtml";
const STORE_IDS = { folderPaneSplitter: "folderPaneBox", messagePaneSplitter: "messagepaneboxwrapper" } as const;

const PANE_IDS = ["folderPane", "threadPane", "messagePane"];

/**
 * Moves the border of the pane at index `pane` (0 folders, 1 threads, 2 message) by `steps` steps toward `direction`. A border is a splitter that touches the pane on the axis of the move and overlaps it on the other axis, whichever pane the splitter sizes. A pane with two borders moves the one after it.
 * Answers false when the pane has no border on that axis, or the pane or its splitter is collapsed or disabled.
 */
export function move_border(about_3pane: ResizePane, pane: number, direction: Exclude<PaneResizeDirection, "reset">, steps: number): boolean {
    const horizontal = direction === "left" || direction === "right";
    const [lo, hi, across_lo, across_hi] = horizontal ? (["left", "right", "top", "bottom"] as const) : (["top", "bottom", "left", "right"] as const);
    const pane_box = about_3pane.document.getElementById(PANE_IDS[pane]!)?.getBoundingClientRect();
    if (!pane_box) return false;
    const borders = Object.keys(STORE_IDS)
        .map((id) => about_3pane.paneLayout[id as keyof typeof STORE_IDS])
        .filter((each) => {
            const box = each.getBoundingClientRect();
            const touches = Math.abs(box[lo] - pane_box[hi]) < 6 || Math.abs(box[hi] - pane_box[lo]) < 6;
            return !each.isCollapsed && !each.isDisabled && each.resizeDirection === (horizontal ? "horizontal" : "vertical") && touches && box[across_lo] < pane_box[across_hi] && box[across_hi] > pane_box[across_lo];
        });
    const splitter = borders.find((each) => each.getBoundingClientRect()[lo] > pane_box[lo]) ?? borders[0];
    const box = splitter?.resizeElement?.getBoundingClientRect();
    if (!splitter || !box) return false;
    // Moving toward the end of the axis grows the element before the splitter and shrinks the one after it.
    const grows = box[lo] < splitter.getBoundingClientRect()[lo] === (direction === "right" || direction === "down");
    const property = horizontal ? "width" : "height";
    splitter[property] = Math.max(0, box[hi] - box[lo] + (grows ? steps : -steps) * STEP_PX);
    // The grid may give the pane less than asked, so the stored size is the one it took, as after a drag.
    const taken = splitter.resizeElement!.getBoundingClientRect();
    splitter[property] = Math.round(taken[hi] - taken[lo]);
    splitter.dispatchEvent(new about_3pane.CustomEvent("splitter-resized", { bubbles: true }));
    return true;
}

/** Gives both splitters their default sizes and removes the stored ones. It fires no `splitter-resized`: its handler would store the empty size. */
export function reset_sizes(about_3pane: ResizePane): boolean {
    for (const [id, store_id] of Object.entries(STORE_IDS)) {
        const splitter = about_3pane.paneLayout[id as keyof typeof STORE_IDS];
        splitter.width = splitter.height = null;
        for (const attribute of ["width", "height"]) Services.xulStore.removeValue(STORE_URL, store_id, attribute);
    }
    return true;
}
