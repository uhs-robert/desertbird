// The hint mode of the mail window: labels over targets in several chrome documents, the typed label, and the act on the picked one. It holds no Thunderbird global: the parent hands in the host, so node tests drive it with fakes.

import { hint_labels, labels_matching } from "../shared/hint_labels.ts";
import type { HintDocument, HintElement, HintLabelNode, HintWindow } from "../shared/hint_view.ts";
import type { HintLabelScheme } from "../shared/protocol.ts";

/** One thing a label can point at. `window` is the document it sits in, which draws the label in its own coordinates. */
export interface PickTarget {
    window: HintWindow;
    element: HintElement;
    /** The activate action: what a pick did before actions existed. */
    act(): void;
    /** The focus action. */
    focus(): void;
    /** What the yank action copies. Empty means nothing to copy, and the yank gives the target no label. */
    text: string;
}

/** What a typed label does to its target. */
export type PickAction = "focus" | "activate" | "yank";

export interface PickKeyEvent {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface PickHost {
    /** Calls the listener with each key until the returned function is called. It must see the key before the key runtime does, or a hint letter would run as a command. */
    on_key(listener: (event: PickKeyEvent) => void): () => void;
    /** Calls the listener when the labels no longer sit on their targets: a scroll or a click in any of the documents, the window losing the focus, a tab change, another message loading. */
    on_disturb(listener: () => void): () => void;
    /** Puts the text on the system clipboard. */
    copy(text: string): void;
}

// The host of the labels. Its own rules are inline and `!important`, so no style sheet of the document can hide, move or fade it.
const CONTAINER_STYLE = "all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483647 !important; display: block !important; opacity: 1 !important; transform: none !important;";

const label_style = (top: number, left: number, { fill, text }: HintLabelScheme): string =>
    `all: initial !important; position: fixed !important; top: ${top}px !important; left: ${left}px !important; z-index: 2147483647 !important; background: ${fill} !important; color: ${text} !important; font: bold 12px monospace !important; padding: 1px 3px !important; border: 1px solid ${fill} !important;`;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

let end_current: (() => void) | null = null;

/** Ends the labels with no pick. */
export const end_pick = (): void => end_current?.();

function draw(target_window: HintWindow, elements: HintElement[], labels: string[], scheme: HintLabelScheme): { container: HintLabelNode; nodes: HintLabelNode[] } {
    const document: HintDocument = target_window.document;
    const container = document.createElement("div");
    container.style.cssText = CONTAINER_STYLE;
    const shadow = container.attachShadow({ mode: "closed" });
    const nodes = elements.map((element, index) => {
        const node = document.createElement("span");
        const box = element.getBoundingClientRect();
        node.textContent = labels[index]!.toUpperCase();
        node.style.cssText = label_style(Math.max(box.top, 0), Math.max(box.left, 0), scheme);
        shadow.append(node);
        return node;
    });
    document.documentElement.append(container);
    return { container, nodes };
}

/** Labels the targets and takes the keys until a pick or an end. Returns how many it labelled. With none it starts nothing. A second call ends the first. A yank labels only the targets with text. */
export function start_pick(host: PickHost, targets: readonly PickTarget[], scheme: HintLabelScheme, action: PickAction = "activate"): number {
    end_pick();
    const picks = action === "yank" ? targets.filter((target) => target.text !== "") : targets;
    if (picks.length === 0) return 0;
    const labels = hint_labels(picks.length);
    const windows = [...new Set(picks.map((target) => target.window))];
    const drawn = windows.map((window) => {
        const indexes = picks.flatMap((target, index) => (target.window === window ? [index] : []));
        return { indexes, ...draw(window, indexes.map((index) => picks[index]!.element), indexes.map((index) => labels[index]!), scheme) };
    });
    let typed = "";

    function end(): void {
        stop_keys();
        stop_disturb();
        for (const { container } of drawn) container.remove();
        end_current = null;
    }

    const stop_keys = host.on_key((event) => {
        event.preventDefault();
        event.stopPropagation();
        if (MODIFIER_KEYS.has(event.key)) return;
        const letter = /^[a-z]$/i.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey ? event.key.toLowerCase() : "";
        if (letter === "" || labels_matching(labels, typed + letter).length === 0) return end();
        typed += letter;
        // A label that stopped matching goes, so the ones left show what may follow.
        for (const { indexes, nodes } of drawn) indexes.forEach((index, at) => labels[index]!.startsWith(typed) || nodes[at]!.remove());
        const picked = labels.indexOf(typed);
        if (picked < 0) return;
        const target = picks[picked]!;
        end();
        // A message that loaded after the labels drew left the old target out of its document.
        if (target.element.isConnected === false) return;
        if (action === "yank") host.copy(target.text);
        else if (action === "focus") target.focus();
        else target.act();
    });
    const stop_disturb = host.on_disturb(end);
    end_current = end;
    return picks.length;
}
