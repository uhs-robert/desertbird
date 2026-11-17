// Finds out where a key is going: a text field, the reading pane or an open menu. The top window sees keys from every document below it, so the event target alone can name the wrapping element and not the field.

import { OVERLAY_BROWSER_ID } from "./overlay_id.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE } from "../shared/protocol.ts";

export interface FocusNode {
    localName?: string;
    id?: string;
    isContentEditable?: boolean;
    shadowRoot?: { activeElement: FocusNode | null } | null;
    contentDocument?: FocusDocument | null;
}

interface MarkedRoot {
    hasAttribute(name: string): boolean;
}

export interface FocusDocument {
    activeElement: FocusNode | null;
    body?: FocusNode | null;
    documentElement?: MarkedRoot | null;
    querySelectorAll?(selectors: string): Iterable<{ state?: string }>;
}

// Elements the user types text into. A `browser` is not one: the walk enters every browser it can read, and one it cannot read (a remote page) holds no Thunderbird text field.
const TYPING_ELEMENTS = new Set(["input", "textarea", "select", "search-textbox", "menulist"]);

// The measured chains are four deep (main window, about:3pane, about:message, message body). The cap only stops a pathological nesting.
const MAX_DEPTH = 12;

// The overlay's browser is remote and its document is out of reach, so its id is the only mark. Its keys are the page's own.
export const is_typing_element = (node: FocusNode | null | undefined): boolean => node?.isContentEditable === true || node?.id === OVERLAY_BROWSER_ID || TYPING_ELEMENTS.has(node?.localName ?? "");

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

// `messageBrowser` holds about:message inside about:3pane, and `messagepane`, the message body, sits inside about:message.
const READING_PANE_IDS = new Set(["messageBrowser", "messagepane"]);

/** Whether focus sits in the reading pane, whatever the element inside it. */
export const in_reading_pane = (document: FocusDocument): boolean => focus_chain(document).some((node) => READING_PANE_IDS.has(node.id ?? ""));

/** Whether the document that holds the focus is a message body that runs the body script. Only the innermost document counts: the script runs in the top frame only, so a key from a frame in the mail never reaches it. Focus in the message header or the thread list is in another document. */
export const body_script_is_live = (document: FocusDocument): boolean => focus_chain(document).findLast((node) => node.contentDocument)?.contentDocument?.documentElement?.hasAttribute(BODY_SCRIPT_LIVE_ATTRIBUTE) === true;

// A menu or panel shows from the moment it opens until it closes. Its `open` attribute stays unset, so only `state` tells.
const SHOWN_POPUP_STATES = new Set(["showing", "open"]);

/** Whether a menu or panel is open in the window or in a document on the way to the focus, such as the thread list's context menu in about:3pane. Its access keys are its own then. */
export function menu_is_open(document: FocusDocument): boolean {
    const documents = [document, ...focus_chain(document).flatMap((node) => (node.contentDocument ? [node.contentDocument] : []))];
    return documents.some((each) => [...(each.querySelectorAll?.("menupopup, panel") ?? [])].some((popup) => SHOWN_POPUP_STATES.has(popup.state ?? "")));
}

export interface KeyEventTargets {
    target: unknown;
    originalTarget?: unknown;
}

/** A key is typing when the event target, the original target or the focused element is a text field. The composed path is not asked: seen from the top window it starts at the browser that holds about:3pane, whatever has focus inside. */
export function is_typing(event: KeyEventTargets, document: FocusDocument): boolean {
    const candidates = [event.target, event.originalTarget, innermost_focus(document)];
    return candidates.some((candidate) => is_typing_element(candidate as FocusNode | null)) || body_script_is_live(document);
}
