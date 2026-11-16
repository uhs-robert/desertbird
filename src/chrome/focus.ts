// Finds out whether a key is meant for a text field. The top window sees keys from every document below it, so the event target alone can name the wrapping element and not the field.

export interface FocusNode {
    localName?: string;
    id?: string;
    isContentEditable?: boolean;
    shadowRoot?: { activeElement: FocusNode | null } | null;
    contentDocument?: { activeElement: FocusNode | null; body?: FocusNode | null } | null;
}

export interface FocusDocument {
    activeElement: FocusNode | null;
}

// Elements the user types text into. A `browser` is not one: the walk enters every browser it can read, and one it cannot read (a remote page) holds no Thunderbird text field.
const TYPING_ELEMENTS = new Set(["input", "textarea", "select", "search-textbox", "menulist"]);

const MAX_DEPTH = 12;

export const is_typing_element = (node: FocusNode | null | undefined): boolean => node?.isContentEditable === true || TYPING_ELEMENTS.has(node?.localName ?? "");

/** The focused element and every element it sits in, outermost first. The walk follows shadow roots and the documents of browsers and frames. A browser whose document is out of reach ends it. */
export function focus_chain(document: FocusDocument): FocusNode[] {
    const chain: FocusNode[] = [];
    let node = document.activeElement;
    for (let depth = 0; node && depth < MAX_DEPTH; depth++) {
        chain.push(node);
        const content = node.contentDocument;
        node = node.shadowRoot?.activeElement ?? (content ? (content.activeElement ?? content.body ?? null) : null);
    }
    return chain;
}

/** The element that has focus: the end of the chain. */
export const innermost_focus = (document: FocusDocument): FocusNode | null => focus_chain(document).at(-1) ?? null;

// The ids of the reading pane's browser elements in about:3pane.
const READING_PANE_IDS = new Set(["messageBrowser", "messagepane"]);

/** Whether focus sits in the reading pane, whatever the element inside it. */
export const in_reading_pane = (document: FocusDocument): boolean => focus_chain(document).some((node) => READING_PANE_IDS.has(node.id ?? ""));

export interface KeyEventTargets {
    target: unknown;
    originalTarget?: unknown;
}

/** A key is typing when the event target, the original target or the focused element is a text field. The composed path is not asked: seen from the top window it starts at the browser that holds about:3pane, whatever has focus inside. */
export function is_typing(event: KeyEventTargets, document: FocusDocument): boolean {
    const candidates = [event.target, event.originalTarget, innermost_focus(document)];
    return candidates.some((candidate) => is_typing_element(candidate as FocusNode | null));
}
