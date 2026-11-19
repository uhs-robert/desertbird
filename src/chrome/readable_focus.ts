// Decides from the focus chain what the keys of the front tab meet. Thunderbird draws its tabs in chrome documents and parent-process pages that no content script reaches, so the bundle reads them from here. A page of another process is out of reach: only chords are safe there.

import { focus_chain, is_typing, menu_is_open } from "./focus.ts";
import type { FocusDocument, KeyEventTargets } from "./focus.ts";
import { MAIL_TAB_MODE } from "./view.ts";


/**
 * What a key meets in the front tab:
 * - `pass`: the mail tab or an open menu. The key is not this bundle's.
 * - `typing`: a text field or a message body that runs the body script.
 * - `remote`: a page of another process. Only chords are safe.
 * - `page`: a chrome or parent-process document.
 */
export type Situation = "pass" | "typing" | "remote" | "page";

export interface FrontTab {
    mode: string;
    browser_is_remote: boolean;
}

// With the focus on nothing or on the tab strip, no element of the tab has it.
const NOT_IN_THE_TAB = new Set(["body", "tab", "tabs"]);

function page_is_remote(document: FocusDocument, tab: FrontTab): boolean {
    const end = focus_chain(document).at(-1);
    if (end === undefined || NOT_IN_THE_TAB.has(end.localName ?? "")) return tab.browser_is_remote;
    // The walk enters every browser it can read, so a browser at the end of the chain holds a document it could not enter.
    return end.localName === "browser" && !end.contentDocument;
}

export function situation_of(document: FocusDocument, tab: FrontTab | null, event: KeyEventTargets): Situation {
    if (tab === null || tab.mode === MAIL_TAB_MODE || menu_is_open(document)) return "pass";
    if (is_typing(event, document)) return "typing";
    if (page_is_remote(document, tab)) return "remote";
    return "page";
}
