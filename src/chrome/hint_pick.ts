// The hint mode of the mail window: labels over targets in several chrome documents, the typed label, and the act on the picked one. It holds no Thunderbird global: the parent hands in the host, so node tests drive it with fakes.

import { hint_labels, labels_matching } from "../shared/hint_labels.ts";
import type { HintDocument, HintElement, HintLabelNode, HintWindow } from "../shared/hint_view.ts";
import type { HintLabelScheme } from "../shared/protocol.ts";
import { is_typed_character } from "../shared/hint_hold.ts";

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
    /** Calls the listener with each key until `stop`. It must see the key before the key runtime does, or a hint letter would run as a command. `hold` tells the key runtimes the labels have ended while the listener holds the keys until `ends_at`, after a typo. `stop` ends both. */
    on_key(listener: (event: PickKeyEvent) => void): { hold(ends_at: number): void; stop(): void };
    now(): number;
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

// The key runtimes drop plain keys for this long after `f`, and the hold after a typo ends with theirs.
const HOLD_MS = 1500;

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

/** Labels the targets and takes the keys until a pick or an end. Returns how many it labelled. With none it starts nothing. A second call ends the first. A yank labels only the targets with text. `hint_keys` are the key sequences that start a pick, which pass the hold after a typo. `hint_letters` is the alphabet of the labels, `hint_labels` takes the default when it is absent. */
export function start_pick(host: PickHost, targets: readonly PickTarget[], scheme: HintLabelScheme, action: PickAction = "activate", hint_keys: readonly (readonly string[])[] = [], hint_letters?: string): number {
    end_pick();
    const hold_ends_at = host.now() + HOLD_MS;
    const picks = action === "yank" ? targets.filter((target) => target.text !== "") : targets;
    if (picks.length === 0) return 0;
    const labels = hint_labels(picks.length, hint_letters);
    const windows = [...new Set(picks.map((target) => target.window))];
    const drawn = windows.map((window) => {
        const indexes = picks.flatMap((target, index) => (target.window === window ? [index] : []));
        return { indexes, ...draw(window, indexes.map((index) => picks[index]!.element), indexes.map((index) => labels[index]!), scheme) };
    });
    let typed = "";
    // Set once a typo ended the labels. The listener then holds plain keys until `hold_ends_at`, and lets a typed start of a new pick through.
    let after_typo: string[] | null = null;

    function end(): void {
        keys.stop();
        stop_disturb();
        for (const { container } of drawn) container.remove();
        end_current = null;
    }

    // A typo (a typed character that starts no label) must not run as a command, nor the keys typed after it while the user still means to pick. Named keys and chords pass, and the hold goes on.
    function hold_after_typo(event: PickKeyEvent, prefix: string[]): void {
        if (host.now() >= hold_ends_at) return end();
        // Backspace steps the downstream matcher back one key, so the prefix steps back with it.
        if (event.key === "Backspace") return void (after_typo = prefix.slice(0, -1));
        if (!is_typed_character(event)) return;
        const keys_so_far = [...prefix, event.key];
        const started = hint_keys.filter((sequence) => keys_so_far.every((key, at) => sequence[at] === key));
        // A whole sequence runs a pick, which ends this one. One that finds nothing to label leaves the hold to start over.
        if (started.length) return void (after_typo = started.some((sequence) => sequence.length === keys_so_far.length) ? [] : keys_so_far);
        after_typo = [];
        event.preventDefault();
        event.stopPropagation();
    }

    const keys = host.on_key((event) => {
        if (after_typo) return hold_after_typo(event, after_typo);
        event.preventDefault();
        event.stopPropagation();
        if (MODIFIER_KEYS.has(event.key)) return;
        const letter = [...event.key].length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey ? event.key.toLowerCase() : "";
        if (letter === "" || labels_matching(labels, typed + letter).length === 0) {
            if (!is_typed_character(event)) return end();
            after_typo = [];
            for (const { container } of drawn) container.remove();
            return keys.hold(hold_ends_at);
        }
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
