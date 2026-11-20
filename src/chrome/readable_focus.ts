// Decides from the focus chain what the keys of the front tab meet. Thunderbird draws its tabs in chrome documents and parent-process pages that no content script reaches, so the bundle reads them from here. A page of another process is out of reach: only chords are safe there.

import { focus_chain, is_text_field, is_typing, menu_is_open } from "./focus.ts";
import type { FocusDocument, KeyEventTargets } from "./focus.ts";
import { MAIL_TAB_MODE } from "./view.ts";

export const MESSAGE_TAB_MODE = "mailMessageTab";

/**
 * What a key meets in the front tab:
 * - `pass`: the mail tab outside a text field, or an open menu. The key is not this bundle's.
 * - `typing`: a message body that runs the body script, or the overlay's browser. Both take their own keys.
 * - `field`: a text field, in the mail tab too. Only the typing keys run.
 * - `remote`: a page of another process. Only chords are safe.
 * - `page`: a chrome or parent-process document.
 * - `message`: a message tab whose focus is outside the body, in the header or the tab strip.
 */
export type Situation = "pass" | "typing" | "field" | "remote" | "page" | "message";

export interface FrontTab {
    mode: string;
    browser_is_remote: boolean;
}

// With the focus on nothing or on the tab strip, no element of the tab has it.
export const NOT_IN_THE_TAB = new Set(["body", "tab", "tabs"]);

function page_is_remote(document: FocusDocument, tab: FrontTab): boolean {
    const end = focus_chain(document).at(-1);
    if (end === undefined || NOT_IN_THE_TAB.has(end.localName ?? "")) return tab.browser_is_remote;
    // The walk enters every browser it can read, so a browser at the end of the chain holds a document it could not enter.
    return end.localName === "browser" && !end.contentDocument;
}

export function situation_of(document: FocusDocument, tab: FrontTab | null, event: KeyEventTargets): Situation {
    if (tab === null || menu_is_open(document)) return "pass";
    // The mail tab's list keys belong to the key bundle, but a text field there (the quick filter, the search box) takes the typing keys of this one.
    if (is_text_field(event, document)) return "field";
    if (tab.mode === MAIL_TAB_MODE) return "pass";
    if (is_typing(event, document)) return "typing";
    if (page_is_remote(document, tab)) return "remote";
    return tab.mode === MESSAGE_TAB_MODE ? "message" : "page";
}
