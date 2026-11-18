// Key handling in a message document. It holds no browser global: `start_body_script` takes the window and storage as arguments, so node tests drive every path with stubs.

import type { TreeLeaf } from "../../vendor/desertfox/prefix_tree.ts";
import { event_to_token } from "../../vendor/desertfox/keys/token.ts";
import type { KeyEventLike } from "../../vendor/desertfox/keys/token.ts";
import { is_typing_element } from "../chrome/focus.ts";
import type { FocusNode } from "../chrome/focus.ts";
import { NORMAL_MODE, is_plain_printable, matcher_for_tree } from "../shared/keymap_tree.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE, HINT_STYLE_STORAGE_KEY, KEYMAP_STORAGE_KEY, MESSAGE_SCROLL_STEP_PX, SETTINGS_STORAGE_KEY } from "../shared/protocol.ts";
import type { BodyFindReply, BodyFindRequest, BodyInvokeRequest, BodyOpenLinkRequest, BodyPendingRequest, JsonValue } from "../shared/protocol.ts";
import { create_finder } from "./body_find.ts";
import type { FindWindow, Finder } from "./body_find.ts";
import { create_hint_session } from "./body_hints.ts";
import type { HintElement, HintSession, HintWindow } from "./body_hints.ts";

export interface BodyKeyEvent extends KeyEventLike {
    target: unknown;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface BodyWindow extends FindWindow, HintWindow {
    addEventListener(type: "keydown", listener: (event: BodyKeyEvent) => void, capture: boolean): void;
    addEventListener(type: "scroll" | "blur" | "pointerdown", listener: () => void, capture: boolean): void;
    removeEventListener(type: "keydown", listener: (event: BodyKeyEvent) => void, capture: boolean): void;
    scrollBy(options: { top: number; behavior: "instant" }): void;
    scrollTo(options: { top: number; behavior: "instant" }): void;
    document: HintWindow["document"] & { body: unknown; documentElement: { scrollHeight: number; setAttribute(name: string, value: string): void; removeAttribute(name: string): void } };
}

export interface BodyStorage {
    get(keys: string[]): Promise<Record<string, unknown>>;
    onChanged: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
}

/** The ways to reach the background page: send a request, and answer the ones it sends. */
export interface BodyRuntime {
    sendMessage(message: BodyInvokeRequest | BodyOpenLinkRequest | BodyPendingRequest): Promise<unknown>;
    onMessage: { addListener(listener: (message: unknown) => Promise<BodyFindReply> | undefined): void };
}

interface BodyContext {
    window: BodyWindow;
    step_px: number;
    finder: Finder;
    hints: HintSession;
}

type Action = (context: BodyContext, count: number) => void;

// The fixed table of what a leaf of this document may run. An id that is not here does nothing.
const ACTIONS: Record<string, Action> = {
    "message.scroll_down": ({ window, step_px }, count) => window.scrollBy({ top: step_px * count, behavior: "instant" }),
    "message.scroll_up": ({ window, step_px }, count) => window.scrollBy({ top: -step_px * count, behavior: "instant" }),
    "message.half_page_down": ({ window }, count) => window.scrollBy({ top: (window.innerHeight / 2) * count, behavior: "instant" }),
    "message.half_page_up": ({ window }, count) => window.scrollBy({ top: -(window.innerHeight / 2) * count, behavior: "instant" }),
    "message.top": ({ window }) => window.scrollTo({ top: 0, behavior: "instant" }),
    "message.bottom": ({ window }) => window.scrollTo({ top: window.document.documentElement.scrollHeight, behavior: "instant" }),
    "message.find_next": ({ finder }) => finder.step(false),
    "message.find_prev": ({ finder }) => finder.step(true),
    "hint.pick": ({ hints }) => void hints.begin(),
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** The scroll step in the stored settings, or the default when it is absent or below 1. */
function scroll_step_of(settings: unknown): number {
    const step = (settings as { message_scroll_step_px?: unknown } | null | undefined)?.message_scroll_step_px;
    return typeof step === "number" && Number.isFinite(step) && step >= 1 ? step : MESSAGE_SCROLL_STEP_PX;
}

/** The keymap record in storage, read for the tree of this document. A record that is absent or of another shape gives null. */
function message_tree_of(record: unknown): { version: number; root: unknown } | null {
    const tree = (record as { message_tree?: { version?: unknown; root?: unknown } } | null | undefined)?.message_tree;
    return typeof tree?.version === "number" ? { version: tree.version, root: tree.root } : null;
}

/** Starts the keys of one message document. `open_pick` runs on a picked link or button. The default asks the background for a trusted Enter. A page of the add-on passes a script click: it has no mail to lie about a link, and the trusted Enter is refused outside the message pane. The tree comes from storage and follows `storage.onChanged`. Until a tree is in, no key is touched and the live marker stays off. */
export async function start_body_script(window: BodyWindow, storage: BodyStorage, runtime: BodyRuntime, open_pick: (element: HintElement) => void = () => void runtime.sendMessage({ type: "body.open_link" }).catch((error: unknown) => console.error("desertbird message keys:", error))): Promise<void> {
    let matcher: ReturnType<typeof matcher_for_tree> | null = null;
    const root_element = window.document.documentElement;
    // Read once per document: each message loads the script anew, so a theme change shows on the next message.
    let hint_colors = "background: #ffd33d !important;";
    const context: BodyContext = { window, step_px: MESSAGE_SCROLL_STEP_PX, finder: create_finder(window), hints: create_hint_session(window, open_pick, () => hint_colors) };

    // Tells the background the typed prefix for which-key. It sends only a change, so a plain key with no sequence sends nothing.
    let reported = "";
    function report(keys: string[]): void {
        const joined = keys.join(" ");
        if (joined === reported) return;
        reported = joined;
        runtime.sendMessage({ type: "body.pending", keys }).catch(() => {});
    }

    function reset_sequence(): void {
        matcher?.reset();
        report([]);
    }

    function run_leaf(leaf: TreeLeaf, typed_count: number | undefined): void {
        for (const step of leaf.steps) {
            const count = typed_count ?? step.invocation.count ?? 1;
            if (step.runs_in === "message") ACTIONS[step.invocation.id]?.(context, count);
            // The background checks the command and its args again. A refusal there is shown as a notification.
            else if (step.runs_in === "background") runtime.sendMessage({ type: "body.invoke", command: step.invocation.id, args: (step.invocation.args ?? {}) as Record<string, JsonValue>, count }).catch((error: unknown) => console.error("desertbird message keys:", error));
        }
    }

    // While the labels show, every key is for them. A key that is not a letter or a modifier cancels them.
    function on_hint_key(event: BodyKeyEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (MODIFIER_KEYS.has(event.key)) return;
        context.hints.feed(/^[a-z]$/i.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey ? { kind: "typed", letter: event.key.toLowerCase() } : { kind: "cancel" });
    }

    function on_keydown(event: BodyKeyEvent): void {
        if (context.hints.active()) return on_hint_key(event);
        if (!matcher) return;
        if (is_typing_element(event.target as FocusNode | null)) return reset_sequence();
        const token = event_to_token(event);
        if (token === null) return;
        // Escape ends a half-typed sequence or count and goes on to Thunderbird, which may use it.
        if (token === "<Escape>") return reset_sequence();
        const result = matcher.feed(NORMAL_MODE, token);
        report(result.kind_ === "pending" ? result.typed_ : []);
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
        else {
            root_element.removeAttribute(BODY_SCRIPT_LIVE_ATTRIBUTE);
            context.hints.cancel();
        }
        report([]);
    }

    window.addEventListener("keydown", on_keydown, true);
    // The labels sit at fixed places. They end when the page moves under them, the window loses the focus or a click lands elsewhere.
    for (const type of ["scroll", "blur", "pointerdown"] as const) window.addEventListener(type, () => context.hints.cancel(), true);
    // A half-typed `d` must not wait across a tab switch, or `d`, `<C-j>`, `<C-k>`, `d` trashes a message.
    window.addEventListener("blur", reset_sequence, true);
    runtime.onMessage.addListener((message) => {
        const request = message as Partial<BodyFindRequest> | null;
        return request?.type === "body.find" && typeof request.pattern === "string" ? Promise.resolve({ found: context.finder.start(request.pattern) }) : undefined;
    });
    storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes[SETTINGS_STORAGE_KEY]) context.step_px = scroll_step_of(changes[SETTINGS_STORAGE_KEY].newValue);
        if (changes[KEYMAP_STORAGE_KEY]) install(changes[KEYMAP_STORAGE_KEY].newValue);
    });
    const stored = await storage.get([KEYMAP_STORAGE_KEY, SETTINGS_STORAGE_KEY, HINT_STYLE_STORAGE_KEY]);
    hint_colors = (stored[HINT_STYLE_STORAGE_KEY] as string | undefined) ?? hint_colors;
    context.step_px = scroll_step_of(stored[SETTINGS_STORAGE_KEY]);
    install(stored[KEYMAP_STORAGE_KEY]);
}
