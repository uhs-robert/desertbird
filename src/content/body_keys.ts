// Key handling in a message document. It holds no browser global: `start_body_script` takes the window and storage as arguments, so node tests drive every path with stubs.

import type { TreeLeaf } from "../../vendor/desertfox/prefix_tree.ts";
import { event_to_token } from "../../vendor/desertfox/keys/token.ts";
import type { KeyEventLike } from "../../vendor/desertfox/keys/token.ts";
import { is_typing_element } from "../chrome/focus.ts";
import type { FocusNode } from "../chrome/focus.ts";
import { NORMAL_MODE, is_plain_printable, matcher_for_tree } from "../shared/keymap_tree.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE, HINT_STYLE_STORAGE_KEY, KEYMAP_STORAGE_KEY, MESSAGE_SCROLL_STEP_PX, SETTINGS_STORAGE_KEY } from "../shared/protocol.ts";
import type { BodyFindReply, BodyFindRequest, BodyHintsRequest, BodyInvokeRequest, BodyModeRequest, BodyOpenLinkRequest, BodyPendingRequest, BodyTreeField, BodyTreeRequest, BodyYankRequest, HintAction, JsonValue } from "../shared/protocol.ts";
import { leaves_insert } from "../chrome/escape_rule.ts";
import { create_finder } from "./body_find.ts";
import type { FindWindow, Finder } from "./body_find.ts";
import { create_hint_session } from "./body_hints.ts";
import type { HintElement, HintSession, HintWindow } from "./body_hints.ts";
import { best_effort } from "../shared/swallow.ts";

export interface BodyKeyEvent extends KeyEventLike {
    target: unknown;
    defaultPrevented?: boolean;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface BodyWindow extends FindWindow, HintWindow {
    addEventListener(type: "keydown", listener: (event: BodyKeyEvent) => void, capture: boolean): void;
    addEventListener(type: "scroll" | "blur" | "pointerdown", listener: () => void, capture: boolean): void;
    removeEventListener(type: "keydown", listener: (event: BodyKeyEvent) => void, capture: boolean): void;
    scrollBy(options: { top?: number; left?: number; behavior: "instant" }): void;
    scrollTo(options: { top: number; behavior: "instant" }): void;
    document: HintWindow["document"] & { body: unknown; documentElement: { scrollHeight: number; setAttribute(name: string, value: string): void; removeAttribute(name: string): void } };
}

export interface BodyStorage {
    get(keys: string[]): Promise<Record<string, unknown>>;
    onChanged: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
}

/** The ways to reach the background page: send a request, and answer the ones it sends. */
export interface BodyRuntime {
    sendMessage(message: BodyHintsRequest | BodyInvokeRequest | BodyModeRequest | BodyOpenLinkRequest | BodyPendingRequest | BodyTreeRequest | BodyYankRequest): Promise<unknown>;
    onMessage: { addListener(listener: (message: unknown) => Promise<BodyFindReply> | undefined): void };
}

interface BodyContext {
    window: BodyWindow;
    step_px: number;
    finder: Finder;
    hints: HintSession;
    pick(action: HintAction | undefined): void;
}

type Action = (context: BodyContext, count: number, args: Record<string, unknown>) => void;

// Pixels of one `h` or `l`, the step of DesertFox.
const SIDEWAYS_PX = 50;

const scroll_by = (side: "top" | "left", pixels_of: (context: BodyContext) => number): Action => (context, count) => context.window.scrollBy({ [side]: pixels_of(context) * count, behavior: "instant" });
const half_page = ({ window }: BodyContext) => window.innerHeight / 2;
const whole_page = ({ window }: BodyContext) => window.innerHeight;

// The fixed table of what a leaf of this document may run. An id that is not here does nothing.
const ACTIONS: Record<string, Action> = {
    "message.scroll_down": scroll_by("top", ({ step_px }) => step_px),
    "message.scroll_up": scroll_by("top", ({ step_px }) => -step_px),
    "message.half_page_down": scroll_by("top", half_page),
    "message.half_page_up": scroll_by("top", (context) => -half_page(context)),
    "message.page_down": scroll_by("top", whole_page),
    "message.page_up": scroll_by("top", (context) => -whole_page(context)),
    "message.scroll_left": scroll_by("left", () => -SIDEWAYS_PX),
    "message.scroll_right": scroll_by("left", () => SIDEWAYS_PX),
    "message.top": ({ window }) => window.scrollTo({ top: 0, behavior: "instant" }),
    "message.bottom": ({ window }) => window.scrollTo({ top: window.document.documentElement.scrollHeight, behavior: "instant" }),
    "message.find_next": ({ finder }) => finder.step(false),
    "message.find_prev": ({ finder }) => finder.step(true),
    "hint.pick": ({ pick }, _count, args) => pick(args["action"] as HintAction | undefined),
};

export type TreeField = BodyTreeField | "own_tree";

const log_error = (error: unknown) => console.error("desertbird message keys:", error);

const INSERT_MODE = "mode.insert";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** The scroll step in the stored settings, or the default when it is absent or below 1. */
function scroll_step_of(settings: unknown): number {
    const step = (settings as { message_scroll_step_px?: unknown } | null | undefined)?.message_scroll_step_px;
    return typeof step === "number" && Number.isFinite(step) && step >= 1 ? step : MESSAGE_SCROLL_STEP_PX;
}

/** The keymap record in storage, read for the tree of this document: a message document reads `message_tree`, one in a message window `window_tree` and an own page `own_tree`. A record that is absent or of another shape gives null. */
function tree_of_record(record: unknown, tree_field: TreeField): { version: number; root: unknown } | null {
    const tree = (record as Record<string, { version?: unknown; root?: unknown } | undefined> | null | undefined)?.[tree_field];
    return typeof tree?.version === "number" ? { version: tree.version, root: tree.root } : null;
}

/** Starts the keys of one message document. `open_pick` runs on a picked link or button. A yank sends the text to the background, which owns the clipboard. The default asks the background for a trusted Enter. A page of the add-on passes a script click: it has no mail to lie about a link, and the trusted Enter is refused outside the message pane. The tree comes from storage and follows `storage.onChanged`. Until a tree is in, no key is touched and the live marker stays off. Resolves to a switch to another tree field. */
export async function start_body_script(window: BodyWindow, storage: BodyStorage, runtime: BodyRuntime, open_pick: (element: HintElement) => void = () => void runtime.sendMessage({ type: "body.open_link" }).catch(log_error), tree_field: TreeField = "message_tree", parent_pick: (action: HintAction | undefined) => Promise<number> = async () => -1): Promise<(tree: TreeField) => void> {
    let matcher: ReturnType<typeof matcher_for_tree> | null = null;
    const root_element = window.document.documentElement;
    // Read once per document: each message loads the script anew, so a theme change shows on the next message.
    let hint_colors = "background: #ffd33d !important;";
    let hold_until = 0;
    // The pick whose answer is still out. A cancel, Escape or a keymap change clears it and leaves the hold: a late answer then draws nothing, and keys typed before the parent's labels still run nothing. Only the answer of this pick ends the hold early, else the 1.5 s do.
    let asked = 0;
    const hints = create_hint_session(window, open_pick, () => hint_colors, (text) => void runtime.sendMessage({ type: "body.yank", text }).catch(log_error));
    const cancel = () => ((asked = 0), hints.cancel());

    // `parent_pick` labels the header and the body as one set, and the parent then takes the keys. Plain keys typed before its labels show would run as commands here, so they are dropped until the answer, at most 1.5 s. The parent answers once its labels show, and they own the keys from then. An answer below 0 or a failure means the parent cannot read this body, and the body labels itself.
    function pick(action: HintAction | undefined): void {
        const held = (asked = hold_until = Date.now() + 1500);
        const answered = (count: number) => held === asked && ((hold_until = 0), count < 0 && hints.begin(action));
        void parent_pick(action).then(answered, () => answered(-1));
    }

    const context: BodyContext = { window, step_px: MESSAGE_SCROLL_STEP_PX, finder: create_finder(window), hints, pick };

    // Tells the background the typed prefix for which-key. It sends only a change, so a plain key with no sequence sends nothing.
    let reported = "";
    function report(keys: string[]): void {
        const joined = keys.join(" ");
        if (joined === reported) return;
        reported = joined;
        void best_effort(runtime.sendMessage({ type: "body.pending", keys, ...(tree_field === "message_tree" ? {} : { tree: tree_field === "own_tree" ? "own" : "window" }) }));
    }

    function reset_sequence(): void {
        matcher?.reset();
        report([]);
    }

    // Insert mode (`i`). A blur ends it, so it does not follow the focus to another pane.
    let insert = false;
    let escaped: BodyKeyEvent | null = null;
    function set_insert(on: boolean): void {
        if (insert === on) return;
        insert = on;
        void best_effort(runtime.sendMessage({ type: "body.mode", mode: on ? "insert" : "normal" }));
    }

    function run_leaf(leaf: TreeLeaf, typed_count: number | undefined): void {
        for (const step of leaf.steps) {
            const count = typed_count ?? step.invocation.count ?? 1;
            if (step.invocation.id === INSERT_MODE) (reset_sequence(), cancel(), set_insert(true));
            else if (step.runs_in === "message") ACTIONS[step.invocation.id]?.(context, count, step.invocation.args ?? {});
            // The background checks the command and its args again. A refusal there is shown as a notification.
            else if (step.runs_in === "background") runtime.sendMessage({ type: "body.invoke", command: step.invocation.id, args: (step.invocation.args ?? {}) as Record<string, JsonValue>, count }).catch(log_error);
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
        const token = event_to_token(event);
        if (token === null) return;
        if (insert) return void (token === "<Escape>" || token === "<C-[>" ? escaped = event : undefined);
        if (is_typing_element(event.target as FocusNode | null)) return reset_sequence();
        if (hold_until > Date.now() && is_plain_printable(token)) return void (event.preventDefault(), event.stopPropagation());
        // Escape ends a half-typed sequence or count. With a sequence pending it is cancelled too, or Thunderbird closes a message window under the open panel. With none pending it goes on to Thunderbird, which may use it.
        if (token === "<Escape>") {
            const was_pending = reported !== "";
            asked = 0;
            reset_sequence();
            return was_pending ? (event.preventDefault(), event.stopPropagation()) : undefined;
        }
        const result = matcher.feed(NORMAL_MODE, token);
        report(result.kind_ === "pending" ? result.typed_ : []);
        // A chord takes the named-key path: it runs and is cancelled only when the keymap binds it, so Thunderbird keeps every chord the keymap leaves free.
        if (result.kind_ === "no_match" && !is_plain_printable(token)) return;
        // Thunderbird binds single keys such as `a` and `r`, so a plain key stops here whether or not it matched.
        event.preventDefault();
        event.stopPropagation();
        if (result.kind_ === "match") run_leaf(result.leaf, result.count);
    }

    let last_record: unknown;
    function install(record: unknown): void {
        last_record = record;
        const tree = tree_of_record(record, tree_field);
        try {
            matcher = tree && matcher_for_tree(tree);
        } catch (error) {
            log_error(error);
            matcher = null;
        }
        asked = 0;
        if (matcher) root_element.setAttribute(BODY_SCRIPT_LIVE_ATTRIBUTE, "");
        else {
            root_element.removeAttribute(BODY_SCRIPT_LIVE_ATTRIBUTE);
            cancel();
        }
        report([]);
    }

    window.addEventListener("keydown", on_keydown, true);
    window.addEventListener("keydown", (event) => leaves_insert(escaped, event) && set_insert(false), false);
    // The labels sit at fixed places. They end when the page moves under them, the window loses the focus or a click lands elsewhere.
    for (const type of ["scroll", "blur", "pointerdown"] as const) window.addEventListener(type, cancel, true);
    // A half-typed `d` must not wait across a tab switch, or `d`, `J`, `K`, `d` trashes a message.
    window.addEventListener("blur", () => (reset_sequence(), set_insert(false)), true);
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
    // Switches the document to another tree of the same record, for a message window whose background answered late.
    return (tree) => ((tree_field = tree), install(last_record));
}
