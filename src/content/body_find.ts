// Find in the message. The browser's own `window.find` does the search, the highlight and the scroll to the match, so the script holds no match list.

export interface FindWindow {
    find(pattern: string, case_sensitive: boolean, backwards: boolean, wrap: boolean): boolean;
    getSelection(): { removeAllRanges(): void; selectAllChildren(node: unknown): void; collapseToEnd(): void } | null;
    focus(): void;
    document: { body: unknown };
}

export interface Finder {
    /** Finds the first match from the top of the message. False when there is none. */
    start(pattern: string): boolean;
    /** Moves to the next or the previous match of the last pattern, wrapping at the ends. Does nothing before a first find. */
    step(backwards: boolean): void;
}

// A pattern with a capital letter is case sensitive and any other is not, the same rule the command line search uses.
const is_case_sensitive = (pattern: string): boolean => pattern !== pattern.toLowerCase();

// The wrap is done here and not by the `wrap` flag of `window.find`: in a message tab that flag measured as a no-op, so the search stopped at the last match.
export function create_finder(window: FindWindow): Finder {
    let pattern = "";
    return {
        start(next_pattern) {
            pattern = next_pattern;
            window.getSelection()?.removeAllRanges();
            // The command line took the focus. Moving it back into the message is what lets n and N reach this script.
            window.focus();
            return window.find(pattern, is_case_sensitive(pattern), false, false);
        },
        step(backwards) {
            if (pattern === "" || window.find(pattern, is_case_sensitive(pattern), backwards, false)) return;
            // No match beyond the selection. Put the selection at the far end and search again.
            const selection = window.getSelection();
            if (backwards) {
                selection?.selectAllChildren(window.document.body);
                selection?.collapseToEnd();
            } else selection?.removeAllRanges();
            window.find(pattern, is_case_sensitive(pattern), backwards, false);
        },
    };
}
