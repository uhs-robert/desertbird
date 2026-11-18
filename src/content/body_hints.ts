// Hint labels in the message: `f` labels the links and buttons on screen, the typed label focuses one, and Enter opens a link. The labels come from `../shared/hint_labels.ts`.

import { hint_labels, labels_matching } from "../shared/hint_labels.ts";
import { is_on_screen } from "../shared/hint_view.ts";
import type { HintElement, HintLabelNode, HintWindow } from "../shared/hint_view.ts";

export type { HintDocument, HintElement, HintLabelNode, HintWindow } from "../shared/hint_view.ts";

/** What a click can act on in a mail. Scripts never run in a mail, so there are no handlers to find. */
const CLICKABLE = "a[href], button:not(:disabled), input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [role=button]";

/** What a pick opens with an Enter. A form control only gets the focus, since Enter in a field would submit or break a line. */
const OPENABLE = "a[href], button";

// The host of the labels. Its own rules are inline and `!important`, so a style sheet of the mail cannot hide, move or fade it.
const CONTAINER_STYLE = "all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483647 !important; display: block !important; opacity: 1 !important; transform: none !important;";

// `!important` on each property, because the mail's own style sheet shares the document. The colors are the theme tokens of the style sheet the background registers for message documents, and the options page carries the same tokens from `follow_theme`. The fallback shows where neither reached.
const LABEL_STYLE = (top: number, left: number): string =>
    `all: initial !important; position: fixed !important; top: ${top}px !important; left: ${left}px !important; z-index: 2147483647 !important; background: var(--desertfox-primary, #ffd33d) !important; color: var(--desertfox-bg-core, #000) !important; font: bold 12px monospace !important; padding: 1px 3px !important; border: 1px solid !important;`;

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

/** `open` runs on a picked link or button, after it has the focus. In a mail it asks for a trusted Enter, since a script click would skip Thunderbird's check for a link that lies about its address. */
export function create_hint_session(window: HintWindow, open: (element: HintElement) => void): HintSession {
    let targets: { label: string; element: HintElement; node: HintLabelNode }[] = [];
    let container: HintLabelNode | null = null;
    let typed = "";

    function end(): void {
        container?.remove();
        container = null;
        targets = [];
        typed = "";
    }

    return {
        active: () => container !== null,
        begin() {
            const elements = [...window.document.querySelectorAll(CLICKABLE)].filter((element) => is_on_screen(window, element));
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
            if (picked.element.matches(OPENABLE)) open(picked.element);
        },
    };
}
