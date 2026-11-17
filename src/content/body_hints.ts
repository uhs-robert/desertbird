// Hint labels in the message: `f` labels the links and buttons on screen, the typed label focuses one, and Enter opens a link. The labels come from `../shared/hint_labels.ts`.

import { hint_labels, labels_matching } from "../shared/hint_labels.ts";

export interface HintElement {
    getBoundingClientRect(): { top: number; left: number; width: number; height: number };
    contains(other: unknown): boolean;
    /** Moves the keyboard focus to the element. A link then takes a real Enter, which Thunderbird handles as a click on it. */
    focus(): void;
    matches(selector: string): boolean;
}

export interface HintLabelNode {
    textContent: string | null;
    style: { cssText: string };
    remove(): void;
    append(...children: HintLabelNode[]): void;
    /** The labels live in a closed shadow root, so no rule of the mail's style sheet reaches them. */
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

/** What a click can act on in a mail. Scripts never run in a mail, so there are no handlers to find. */
const CLICKABLE = "a[href], button:not(:disabled), input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [role=button]";

/** What a pick opens with an Enter. A form control only gets the focus, since Enter in a field would submit or break a line. */
const OPENABLE = "a[href], button";

// The host of the labels. Its own rules are inline and `!important`, so a style sheet of the mail cannot hide, move or fade it.
const CONTAINER_STYLE = "all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483647 !important; display: block !important; opacity: 1 !important; transform: none !important;";

// `!important` on each property, because the mail's own style sheet shares the document.
const LABEL_STYLE = (top: number, left: number): string =>
    `all: initial !important; position: fixed !important; top: ${top}px !important; left: ${left}px !important; z-index: 2147483647 !important; background: #ffd33d !important; color: #000 !important; font: bold 12px monospace !important; padding: 1px 3px !important; border: 1px solid #000 !important;`;

export type HintKey = { kind: "typed"; letter: string } | { kind: "cancel" };

export interface HintSession {
    /** True between `begin` and the pick or the cancel. While it is, every key goes to `feed`. */
    active(): boolean;
    /** Labels the clickable elements on screen. Returns how many it labelled, and stays inactive when none. */
    begin(): number;
    /** Removes the labels with no pick. The page moved or the focus left, so they no longer sit on their targets. */
    cancel(): void;
    /** One key while active. A label that is unique among those that start with what was typed focuses its element. */
    feed(key: HintKey): void;
}

/** `open` asks for a trusted Enter on the focused element. A script click would skip Thunderbird's check for a link that lies about its address, so the pick never clicks. */
export function create_hint_session(window: HintWindow, open: () => void): HintSession {
    let targets: { label: string; element: HintElement; node: HintLabelNode }[] = [];
    let container: HintLabelNode | null = null;
    let typed = "";

    function end(): void {
        container?.remove();
        container = null;
        targets = [];
        typed = "";
    }

    // What a mouse would hit: the element is drawn, and it is the one on top at its own centre. A mail can hide a link or stack it under another, and such a link must get no label.
    function is_on_screen(element: HintElement): boolean {
        const box = element.getBoundingClientRect();
        if (!(box.width > 0 && box.height > 0 && box.top < window.innerHeight && box.top + box.height > 0 && box.left < window.innerWidth && box.left + box.width > 0)) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
        const hit = window.document.elementFromPoint(box.left + box.width / 2, (Math.max(box.top, 0) + Math.min(box.top + box.height, window.innerHeight)) / 2);
        return hit === element || element.contains(hit);
    }

    return {
        active: () => container !== null,
        begin() {
            const elements = [...window.document.querySelectorAll(CLICKABLE)].filter(is_on_screen);
            if (elements.length === 0) return 0;
            const labels = hint_labels(elements.length);
            container = window.document.createElement("div");
            container.style.cssText = CONTAINER_STYLE;
            const shadow = container.attachShadow({ mode: "closed" });
            targets = elements.map((element, index) => {
                const node = window.document.createElement("span");
                const box = element.getBoundingClientRect();
                node.textContent = labels[index]!.toUpperCase();
                node.style.cssText = LABEL_STYLE(Math.max(box.top, 0), Math.max(box.left, 0));
                shadow.append(node);
                return { label: labels[index]!, element, node };
            });
            window.document.documentElement.append(container);
            return elements.length;
        },
        cancel: end,
        feed(key) {
            const candidates = key.kind === "typed" ? labels_matching(targets.map((target) => target.label), typed + key.letter) : [];
            if (key.kind === "cancel" || candidates.length === 0) {
                return end();
            }
            typed += key.letter;
            const picked = targets.find((target) => target.label === typed);
            if (picked === undefined) return;
            end();
            picked.element.focus();
            if (picked.element.matches(OPENABLE)) open();
        },
    };
}
