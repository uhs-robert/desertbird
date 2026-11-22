// Hint labels of the body alone: `f` labels the links and buttons on screen, the typed label focuses one, and Enter opens a link. A message uses them when the parent cannot label its header and body together (a remote body, a message window), and the own pages always. The labels come from `../shared/hint_labels.ts`.

import { hint_labels, labels_matching } from "../shared/hint_labels.ts";
import { CLICKABLE, OPENABLE, is_on_screen } from "../shared/hint_view.ts";
import type { HintAction } from "../shared/protocol.ts";
import type { HintElement, HintLabelNode, HintWindow } from "../shared/hint_view.ts";

export type { HintDocument, HintElement, HintLabelNode, HintWindow } from "../shared/hint_view.ts";

// The host of the labels. Its own rules are inline and `!important`, so a style sheet of the mail cannot hide, move or fade it.
const CONTAINER_STYLE = "all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483647 !important; display: block !important; opacity: 1 !important; transform: none !important;";

// `!important` on each property, because the mail's own style sheet shares the document. `colors` are literal declarations from the background: a custom property would pass through `all: initial` and a mail could recolor or hide the label.
const LABEL_STYLE = (top: number, left: number, colors: string): string =>
    `all: initial !important; position: fixed !important; top: ${top}px !important; left: ${left}px !important; z-index: 2147483647 !important; ${colors} font: bold 12px monospace !important; padding: 1px 3px !important; border: 1px solid !important;`;

export type HintKey = { kind: "typed"; letter: string } | { kind: "cancel" };

export interface HintSession {
    /** True between `begin` and the pick or the cancel. While it is, every key goes to `feed`. */
    active(): boolean;
    /** Labels the clickable elements on screen. Returns how many it labelled, and stays inactive when none. A `yank` labels only the elements with an address or text. */
    begin(action?: HintAction): number;
    /** Removes the labels with no pick. The page moved or the focus left, so they no longer sit on their targets. */
    cancel(): void;
    /** One key while active. A label that is unique among those that start with what was typed focuses its element. */
    feed(key: HintKey): void;
}

/** `open` runs on a picked link or button, after it has the focus. In a mail it asks for a trusted Enter, since a script click would skip Thunderbird's check for a link that lies about its address. */
export function create_hint_session(window: HintWindow, open: (element: HintElement) => void, colors: () => string, copy: (text: string) => void): HintSession {
    let targets: { label: string; element: HintElement; node: HintLabelNode }[] = [];
    let container: HintLabelNode | null = null;
    let typed = "";
    let action: HintAction | null = null;

    function end(): void {
        container?.remove();
        container = null;
        targets = [];
        typed = "";
    }

    const yank_text = (element: HintElement): string => (element.href ?? element.textContent ?? "").trim();

    function show(chosen: HintAction): number {
        action = chosen;
        const on_screen = [...window.document.querySelectorAll(CLICKABLE)].filter((element) => is_on_screen(window, element));
        const elements = chosen === "yank" ? on_screen.filter((element) => yank_text(element) !== "") : on_screen;
        if (elements.length === 0) return 0;
        const labels = hint_labels(elements.length);
        container = window.document.createElement("div");
        container.style.cssText = CONTAINER_STYLE;
        const shadow = container.attachShadow({ mode: "closed" });
        targets = elements.map((element, index) => {
            const node = window.document.createElement("span");
            const box = element.getBoundingClientRect();
            node.textContent = labels[index]!.toUpperCase();
            node.style.cssText = LABEL_STYLE(Math.max(box.top, 0), Math.max(box.left, 0), colors());
            shadow.append(node);
            return { label: labels[index]!, element, node };
        });
        window.document.documentElement.append(container);
        return elements.length;
    }

    return {
        active: () => container !== null,
        begin: (chosen = "activate") => show(chosen),
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
            if (action === "yank") return copy(yank_text(picked.element));
            picked.element.focus();
            if (action === "activate" && picked.element.matches(OPENABLE)) open(picked.element);
        },
    };
}
