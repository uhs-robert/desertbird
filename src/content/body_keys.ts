// Key handling in a message document. It holds no browser global: `start_body_script` takes the window and storage as arguments, so node tests drive every path with stubs.

import type { TreeLeaf } from "../../vendor/desertfox/prefix_tree.ts";
import { event_to_token } from "../../vendor/desertfox/keys/token.ts";
import type { KeyEventLike } from "../../vendor/desertfox/keys/token.ts";
import { is_typing_element } from "../chrome/focus.ts";
import type { FocusNode } from "../chrome/focus.ts";
import { NORMAL_MODE, is_plain_printable, matcher_for_tree } from "../shared/keymap_tree.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE, KEYMAP_STORAGE_KEY } from "../shared/protocol.ts";

/** One `j` or `k`. A fixed step: a setting comes with the config work. */
export const LINE_STEP_PX = 40;

export interface BodyKeyEvent extends KeyEventLike {
    target: unknown;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface BodyWindow {
    addEventListener(type: "keydown", listener: (event: BodyKeyEvent) => void, capture: boolean): void;
    removeEventListener(type: "keydown", listener: (event: BodyKeyEvent) => void, capture: boolean): void;
    scrollBy(options: { top: number; behavior: "instant" }): void;
    scrollTo(options: { top: number; behavior: "instant" }): void;
    innerHeight: number;
    document: { documentElement: { scrollHeight: number; setAttribute(name: string, value: string): void; removeAttribute(name: string): void } };
}

export interface BodyStorage {
    get(key: string): Promise<Record<string, unknown>>;
    onChanged: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
}

type Scroller = (window: BodyWindow, count: number) => void;

// The fixed table of what a leaf may run. An id that is not here does nothing.
const SCROLLS: Record<string, Scroller> = {
    "message.scroll_down": (window, count) => window.scrollBy({ top: LINE_STEP_PX * count, behavior: "instant" }),
    "message.scroll_up": (window, count) => window.scrollBy({ top: -LINE_STEP_PX * count, behavior: "instant" }),
    "message.half_page_down": (window, count) => window.scrollBy({ top: (window.innerHeight / 2) * count, behavior: "instant" }),
    "message.half_page_up": (window, count) => window.scrollBy({ top: -(window.innerHeight / 2) * count, behavior: "instant" }),
    "message.top": (window) => window.scrollTo({ top: 0, behavior: "instant" }),
    "message.bottom": (window) => window.scrollTo({ top: window.document.documentElement.scrollHeight, behavior: "instant" }),
};

/** The keymap record in storage, read for the tree of this document. A record that is absent or of another shape gives null. */
function message_tree_of(record: unknown): { version: number; root: unknown } | null {
    const tree = (record as { message_tree?: { version?: unknown; root?: unknown } } | null | undefined)?.message_tree;
    return typeof tree?.version === "number" ? { version: tree.version, root: tree.root } : null;
}

/** Starts the keys of one message document. The tree comes from storage and follows `storage.onChanged`. Until a tree is in, no key is touched and the live marker stays off. */
export async function start_body_script(window: BodyWindow, storage: BodyStorage): Promise<void> {
    let matcher: ReturnType<typeof matcher_for_tree> | null = null;
    const root_element = window.document.documentElement;

    function run_leaf(leaf: TreeLeaf, count: number | undefined): void {
        for (const step of leaf.steps) if (step.runs_in === "message") SCROLLS[step.invocation.id]?.(window, count ?? step.invocation.count ?? 1);
    }

    function on_keydown(event: BodyKeyEvent): void {
        if (!matcher) return;
        if (is_typing_element(event.target as FocusNode | null)) return void matcher.reset();
        const token = event_to_token(event);
        if (token === null) return;
        // Escape ends a half-typed sequence or count and goes on to Thunderbird, which may use it.
        if (token === "<Escape>") return void matcher.reset();
        const result = matcher.feed(NORMAL_MODE, token);
        // A chord takes the named-key path: it runs and is cancelled only when the keymap binds it, so Thunderbird keeps every chord the keymap leaves free.
        if (result.kind_ === "no_match" && !is_plain_printable(token)) return;
        // Thunderbird binds single keys such as `a` and `r`, so a plain key stops here whether or not it matched.
        event.preventDefault();
        event.stopPropagation();
        if (result.kind_ === "match") run_leaf(result.leaf, result.count);
    }

    function install(record: unknown): void {
        const tree = message_tree_of(record);
        try {
            matcher = tree && matcher_for_tree(tree);
        } catch (error) {
            console.error("desertbird message keys:", error);
            matcher = null;
        }
        if (matcher) root_element.setAttribute(BODY_SCRIPT_LIVE_ATTRIBUTE, "");
        else root_element.removeAttribute(BODY_SCRIPT_LIVE_ATTRIBUTE);
    }

    window.addEventListener("keydown", on_keydown, true);
    storage.onChanged.addListener((changes, area) => {
        const change = changes[KEYMAP_STORAGE_KEY];
        if (area === "local" && change) install(change.newValue);
    });
    install((await storage.get(KEYMAP_STORAGE_KEY))[KEYMAP_STORAGE_KEY]);
}
