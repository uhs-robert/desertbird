// The reading actions of a page tab: a fixed table keyed by command id, so no string from the keymap ever names code. The message ids map to the same functions, for the message tab with focus outside the body.

import type { FocusNode } from "./focus.ts";
import { NOT_IN_THE_TAB } from "./readable_focus.ts";

export interface ScrollNode {
    scrollHeight: number;
    clientHeight: number;
    clientWidth?: number;
    parentElement?: ScrollNode | null;
    /** The shadow host, when the node is the top of a shadow tree. */
    getRootNode?(): { host?: ScrollNode | null };
    ownerDocument?: ScrollDocument | null;
    checkVisibility?(): boolean;
    scrollBy(options: { top: number; behavior: "instant" }): void;
    scrollTo(options: { top: number; behavior: "instant" }): void;
}

export interface ScrollDocument {
    scrollingElement?: ScrollNode | null;
    querySelectorAll?(selectors: string): Iterable<ScrollNode>;
    defaultView?: { getComputedStyle(node: unknown): { overflowY: string } } | null;
}

// Pixels of one `j`. The body script of a message reads this from a setting. The chrome bundle has no storage, so a page tab takes the default.
const LINE_PX = 40;

const SCROLLING_OVERFLOW = new Set(["auto", "scroll"]);

const parent_of = (node: ScrollNode): ScrollNode | null => node.parentElement ?? node.getRootNode?.().host ?? null;

const scrolls = (node: ScrollNode): boolean => node.scrollHeight > node.clientHeight && SCROLLING_OVERFLOW.has(node.ownerDocument?.defaultView?.getComputedStyle(node).overflowY ?? "");

const area_of = (node: ScrollNode): number => node.clientHeight * (node.clientWidth ?? 1);

/** The scrollable element with the largest box under `scope`, or null. A node that is not visible stays out: a tab panel that is not in front keeps its layout. */
function largest_scrollable(scope: Pick<ScrollDocument, "querySelectorAll">): ScrollNode | null {
    let largest: ScrollNode | null = null;
    for (const node of scope.querySelectorAll?.("*") ?? []) if (node.checkVisibility?.() !== false && scrolls(node) && (largest === null || area_of(node) > area_of(largest))) largest = node;
    return largest;
}

/** The element a scroll key moves: the nearest scrollable ancestor of the focused element, else the scrolling element of its document, else, when that does not scroll, the largest scrollable element under `scope` (the document when none is given). That last step is for pages such as the settings tab, which scroll inside a pane that the focused sidebar button is not part of. The window document holds every tab, so a caller that scrolls it passes the panel of the front tab as `scope`. A site selector has no place here: the documents are known. */
export function scroll_target(focused: FocusNode | null | undefined, fallback_document: ScrollDocument, scope?: Pick<ScrollDocument, "querySelectorAll">): ScrollNode | null {
    for (let node = focused as ScrollNode | null | undefined; node; node = parent_of(node)) if (scrolls(node)) return node;
    const document = (focused as ScrollNode | undefined)?.ownerDocument ?? fallback_document;
    const root = document.scrollingElement ?? null;
    return root && root.scrollHeight > root.clientHeight ? root : (largest_scrollable(scope ?? document) ?? root);
}

/** What a scroll key acts on, from the focus chain of the window. Focus on the window body or the tab strip is no focus inside the tab: the key then acts on the document of the tab's own browser, so a page nobody clicked into still scrolls. */
export function scroll_focus(chain: FocusNode[], tab_document: ScrollDocument | null | undefined, window_document: ScrollDocument): { focused: FocusNode | undefined; document: ScrollDocument } {
    const end = chain.at(-1);
    const outside_the_tab = end === undefined || NOT_IN_THE_TAB.has(end.localName ?? "");
    const inner_document = chain.findLast((node) => node.contentDocument)?.contentDocument as ScrollDocument | null | undefined;
    return { focused: outside_the_tab ? undefined : end, document: inner_document ?? (outside_the_tab ? tab_document : null) ?? window_document };
}

type ScrollAction = (target: ScrollNode, count: number) => void;

const scroll_down_by = (pixels_of: (target: ScrollNode) => number): ScrollAction => (target, count) => target.scrollBy({ top: pixels_of(target) * count, behavior: "instant" });
const scroll_up_by = (pixels_of: (target: ScrollNode) => number): ScrollAction => (target, count) => target.scrollBy({ top: -pixels_of(target) * count, behavior: "instant" });
const line = () => LINE_PX;
const half_page = (target: ScrollNode) => target.clientHeight / 2;
const to_top: ScrollAction = (target) => target.scrollTo({ top: 0, behavior: "instant" });
const to_bottom: ScrollAction = (target) => target.scrollTo({ top: target.scrollHeight, behavior: "instant" });

const SCROLL_ACTIONS: Record<string, ScrollAction> = {
    "page.scroll_down": scroll_down_by(line),
    "page.scroll_up": scroll_up_by(line),
    "page.half_down": scroll_down_by(half_page),
    "page.half_up": scroll_up_by(half_page),
    "page.top": to_top,
    "page.bottom": to_bottom,
    "message.scroll_down": scroll_down_by(line),
    "message.scroll_up": scroll_up_by(line),
    "message.half_page_down": scroll_down_by(half_page),
    "message.half_page_up": scroll_up_by(half_page),
    "message.top": to_top,
    "message.bottom": to_bottom,
};

/** Runs the scroll the id names on the target. An id outside the table does nothing and returns false, so a newer keymap cannot make an older bundle run an action it does not have. */
export function run_scroll(id: string, target: ScrollNode | null, count: number | undefined): boolean {
    if (!Object.hasOwn(SCROLL_ACTIONS, id)) return false;
    if (target) SCROLL_ACTIONS[id]!(target, count === undefined || count < 1 ? 1 : count);
    return true;
}
