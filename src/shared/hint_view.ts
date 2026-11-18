// The document shapes of the hint modes and the check that a target is on screen, which the body script and the `hints` Experiment share. The body script draws its own labels: its bundle has no room for a general drawing.

export interface HintElement {
    getBoundingClientRect(): { top: number; left: number; width: number; height: number };
    contains(other: unknown): boolean;
    /** Moves the keyboard focus to the element. A link then takes a real Enter, which Thunderbird handles as a click on it. */
    focus(): void;
    /** A script click. Only a page of the add-on uses it, where `open` is the one to decide. */
    click(): void;
    matches(selector: string): boolean;
}

export interface HintLabelNode {
    textContent: string | null;
    style: { cssText: string };
    remove(): void;
    append(...children: HintLabelNode[]): void;
    /** The labels live in a closed shadow root, so no rule of the document's style sheet reaches them. */
    attachShadow(init: { mode: "closed" }): { append(...children: HintLabelNode[]): void };
}

export interface HintDocument {
    querySelectorAll(selector: string): Iterable<HintElement>;
    elementFromPoint(x: number, y: number): unknown;
    createElement(name: string): HintLabelNode;
    documentElement: { append(child: HintLabelNode): void };
}

export interface HintWindow {
    innerHeight: number;
    innerWidth: number;
    document: HintDocument;
    getComputedStyle(element: HintElement): { display: string; visibility: string; opacity: string };
}

/** What a mouse would hit: the element is drawn, and it is the one on top at its own centre. A page can hide an element or stack it under another, and such an element must get no label. */
export function is_on_screen(window: HintWindow, element: HintElement): boolean {
    const box = element.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0 && box.top < window.innerHeight && box.top + box.height > 0 && box.left < window.innerWidth && box.left + box.width > 0)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
    const hit = window.document.elementFromPoint(box.left + box.width / 2, (Math.max(box.top, 0) + Math.min(box.top + box.height, window.innerHeight)) / 2);
    return hit === element || element.contains(hit);
}
