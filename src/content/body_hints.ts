// Hint labels in the message: `f` labels the links and buttons on screen, the typed label clicks one. The labels come from `../shared/hint_labels.ts`.

import { hint_labels, labels_matching } from "../shared/hint_labels.ts";

export interface HintElement {
    getBoundingClientRect(): { top: number; left: number; width: number; height: number };
    click(): void;
}

export interface HintLabelNode {
    textContent: string | null;
    style: { cssText: string };
    remove(): void;
    append(...children: HintLabelNode[]): void;
}

export interface HintDocument {
    querySelectorAll(selector: string): Iterable<HintElement>;
    createElement(name: string): HintLabelNode;
    documentElement: { append(child: HintLabelNode): void };
}

export interface HintWindow {
    innerHeight: number;
    innerWidth: number;
    document: HintDocument;
}

/** What a click can act on in a mail. Scripts never run in a mail, so there are no handlers to find. */
const CLICKABLE = "a[href], button, input:not([type=hidden]), select, textarea, [role=button]";

// `!important` on each property, because the mail's own style sheet shares the document.
const LABEL_STYLE = (top: number, left: number): string =>
    `all: initial !important; position: fixed !important; top: ${top}px !important; left: ${left}px !important; z-index: 2147483647 !important; background: #ffd33d !important; color: #000 !important; font: bold 12px monospace !important; padding: 1px 3px !important; border: 1px solid #000 !important;`;

export type HintKey = { kind: "typed"; letter: string } | { kind: "cancel" };

export interface HintSession {
    /** True between `begin` and the pick or the cancel. While it is, every key goes to `feed`. */
    active(): boolean;
    /** Labels the clickable elements on screen. Returns how many it labelled, and stays inactive when none. */
    begin(): number;
    /** One key while active. A label that is unique among those that start with what was typed clicks its element. */
    feed(key: HintKey): void;
}

export function create_hint_session(window: HintWindow): HintSession {
    let targets: { label: string; element: HintElement; node: HintLabelNode }[] = [];
    let container: HintLabelNode | null = null;
    let typed = "";

    function end(): void {
        container?.remove();
        container = null;
        targets = [];
        typed = "";
    }

    function is_on_screen(element: HintElement): boolean {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top < window.innerHeight && box.top + box.height > 0 && box.left < window.innerWidth && box.left + box.width > 0;
    }

    return {
        active: () => container !== null,
        begin() {
            const elements = [...window.document.querySelectorAll(CLICKABLE)].filter(is_on_screen);
            if (elements.length === 0) return 0;
            const labels = hint_labels(elements.length);
            container = window.document.createElement("div");
            targets = elements.map((element, index) => {
                const node = window.document.createElement("span");
                const box = element.getBoundingClientRect();
                node.textContent = labels[index]!.toUpperCase();
                node.style.cssText = LABEL_STYLE(Math.max(box.top, 0), Math.max(box.left, 0));
                container!.append(node);
                return { label: labels[index]!, element, node };
            });
            window.document.documentElement.append(container);
            return elements.length;
        },
        feed(key) {
            if (key.kind === "cancel") return end();
            const candidates = labels_matching(targets.map((target) => target.label), typed + key.letter);
            if (candidates.length === 0) return end();
            typed += key.letter;
            const picked = targets.find((target) => target.label === typed);
            if (picked === undefined) return;
            end();
            picked.element.click();
        },
    };
}
