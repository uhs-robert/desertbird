// Key handling in the tabs of the main window that are not the mail tab, and in the header of a message window. It holds no Thunderbird global: the parent hands in a `PageDeps`, so node tests drive every path with fakes.

import type { JsonValue, KeysEvent } from "../shared/protocol.ts";
import { event_to_token } from "../../vendor/desertfox/keys/token.ts";
import { NORMAL_MODE, is_plain_printable, matcher_for_tree } from "../shared/keymap_tree.ts";
import type { KeydownEvent, KeyTarget, WindowListener } from "./runtime.ts";
import type { Situation } from "./readable_focus.ts";

export interface PageDeps<Window> {
    /** Calls `on_load_window` for each main window already open and for each one opened later. */
    register_window_listener(listener: WindowListener<Window>): void;
    unregister_window_listener(): void;
    open_windows(): Window[];
    /** Where the key listener goes. It must sit above the window, so this bundle sees a key before the key runtime does. */
    key_target_of(window: Window): KeyTarget;
    situation_of(window: Window, event: KeydownEvent): Situation;
    /** Whether the window is a message window, whose message keys are message mode's (the window tree). */
    is_message_window(window: Window): boolean;
    /** The MailExtension ids of the message the front tab shows, read when the key is pressed. */
    message_ids_of(window: Window): number[];
    /** Runs a reading action of the front tab's document. Returns false for an id it has no action for: a message step that needs the body script (hints, find) ends here. */
    scroll(window: Window, id: string, count: number | undefined): boolean;
    on_tab_select(window: Window, listener: () => void): () => void;
    on_window_blur(window: Window, listener: () => void): () => void;
    /** Whether the focus sits in the overlay's browser while its page is not ready. Plain keys are dropped then, whatever the hold timer says. */
    overlay_is_loading(window: Window): boolean;
    /** Takes the focus out of the text field that has it. */
    blur_focused(window: Window): void;
    /** The page actor, once it runs. */
    child(): ChildPort | null;
    window_id_of(window: Window): number;
    /** How many hint picks have ended in the window. A change since a hold began means the labels came and went, so the hold ends. */
    hints_done_of(window: Window): number;
    /** Milliseconds, for the hold timeout. */
    now(): number;
    emit(event: KeysEvent): void;
}

/** A key the page actor's child took in a web page or another add-on's page, as an event that cancels nothing: the child already did. `field` tells whether a text field had the focus, and `defaultPrevented` whether the page used an Escape. */
export interface ChildKey extends KeydownEvent {
    field: boolean;
}

/** The page actor as the runtime sees it. Each call names the window and acts on the page of its front tab. */
export interface ChildPort {
    /** Whether the child of the front tab's page is on and has the focus, so the chrome leaves every key of that page to it. */
    takes_keys(window: unknown): boolean;
    /** Hands the insert flag of the window to its children. Called on every set, so each reset of the sequence reaches them. */
    set_insert(window: unknown, on: boolean): void;
    /** Each answers false when the front tab's page has no child, so the chrome acts on its own documents. The parent's `scroll` and `blur_focused` ask these first. */
    scroll(window: unknown, id: string, count: number | undefined): boolean;
    blur(window: unknown): boolean;
}

export interface PageRuntime {
    /** Runs a key from the page actor's child as the front tab's own. Null tells that the front tab's child said hello (a new page, or a key typed in the page's field), which ends insert mode, the half-typed sequence and its key list, as a tab change does. */
    on_child_key(window: unknown, key: ChildKey | null): void;
    install(trees: { page: { version: number; root: unknown }; message: { version: number; root: unknown }; window: { version: number; root: unknown }; typing: { version: number; root: unknown } }, hold_commands?: readonly string[]): void;
    shutdown(): void;
}

// How long plain keys are dropped after a command that opens the overlay. The same wait as the mail runtime, which shares no state with this bundle.
const HOLD_MS = 1500;

const KEY_LIST = "help.whichkey";
const CLOSE_TAB = "tab.close";

export function create_page_runtime<Window>(deps: PageDeps<Window>): PageRuntime {
    const hooked = new Map<Window, { target: KeyTarget; handler: (event: KeydownEvent) => void; settle: (event: KeydownEvent) => void; reset_typing: () => void; stop_tab_listening: () => void; stop_blur_listening: () => void }>();
    let matcher: ReturnType<typeof matcher_for_tree> | null = null;
    // The message tab takes its own tree, so its keys and their meaning follow the message document's.
    let message_matcher: ReturnType<typeof matcher_for_tree> | null = null;
    // A message window takes the message mode tree. It never shows a page tab, and a message tab never runs this tree, so a window switch, which resets the sequence, is the only way between the two.
    let window_matcher: ReturnType<typeof matcher_for_tree> | null = null;
    let listening = false;
    let sequence_window: Window | null = null;
    // The windows in manual insert mode (`i`): plain keys go to the page, as in a text field. Memory only, and each window has its own.
    const insert = new Set<Window>();
    const set_insert = (window: Window, on: boolean) => {
        if (insert.has(window) !== on) deps.emit({ command: "mode", mode: on ? "insert" : "normal", windowId: deps.window_id_of(window) });
        // Pushed on every call, not only on a change: a tab change or a window blur ends the half-typed sequence, and the push starts the child's walk over too.
        deps.child()?.set_insert(window, on);
        insert[on ? "add" : "delete"](window);
    };
    // The keys that run in a text field: `<Escape>` leaves it, `<A-j>` and `<A-k>` switch tab. Plain keys are never fed, since in a field they are text.
    let typing_matcher: ReturnType<typeof matcher_for_tree> | null = null;
    // The Escape event the capture handler matched. The bubble handler leaves only for the same event, once Thunderbird's own handlers have run: a key one of them used (clearing the quick filter, cancelling an inline edit) has `defaultPrevented` and stays theirs.
    let escaped: KeydownEvent | null = null;
    // Whether that Escape was typed in a text field. In insert mode with no field focused it only leaves the mode, and the focused element (a remote browser, say) keeps the focus.
    let escaped_in_field = false;
    let hold_commands = new Set<string>();
    let hold_until = 0;
    let hints_done_at_hold = 0;
    // Whether the last report left the panel open. The next key then reports its end, unless it extends the typed prefix.
    let key_list_shown = false;

    const reset_matchers = () => [matcher, message_matcher, window_matcher, typing_matcher].forEach((each) => each?.reset());

    function end_key_list(window: Window): void {
        if (key_list_shown) deps.emit({ command: "pending", keys: [], windowId: deps.window_id_of(window) });
        key_list_shown = false;
    }

    // `from_child` is set for a key of the page actor's child: the child read the focus, where the chrome sees only the remote browser.
    function on_keydown(window: Window, event: KeydownEvent, from_child?: Situation): void {
        if (!matcher || !message_matcher || !window_matcher || !typing_matcher) return;
        // A chord takes the named-key path: it runs and is cancelled only when the keymap binds it, so Thunderbird keeps every chord the keymap leaves free.
        const token = event_to_token(event);
        if (token === null) return;
        let situation = deps.situation_of(window, event);
        // The child sends the keys it takes after the chrome saw them, so the chrome leaves them alone: a reset here would break the sequence the child is typing.
        if (from_child ? situation === "pass" : situation === "remote" && deps.child()?.takes_keys(window)) return;
        situation = from_child ?? situation;
        const in_text_field = situation === "field";
        if (insert.has(window) && situation !== "pass" && situation !== "typing") situation = "field";
        // The overlay's browser has the focus before its page can take a key, and the hold timer can run out first. Plain keys are dropped for as long as that lasts.
        if (is_plain_printable(token) && deps.overlay_is_loading(window)) return void (event.preventDefault(), event.stopPropagation());
        if (hold_until > deps.now()) {
            // The hold ends when the focus is in a text field, which the overlay's browser counts as.
            if (situation === "typing" || situation === "field" || deps.hints_done_of(window) !== hints_done_at_hold) hold_until = 0;
            else if (situation !== "pass" && is_plain_printable(token)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        if (situation === "pass" || situation === "typing") return (end_key_list(window), reset_matchers());
        const in_field = situation === "field";
        // A page of another process hides its text fields, so only a chord is safe there. In a text field a plain key is text.
        if ((in_field || situation === "remote") && is_plain_printable(token)) return (end_key_list(window), reset_matchers());
        // Each matcher keeps a half-typed sequence, so every one not in use starts over: a `d` typed before a text field took Escape must not wait for the second `d`.
        const in_window = deps.is_message_window(window);
        const active = in_field ? typing_matcher : situation === "message" ? (in_window ? window_matcher : message_matcher) : matcher;
        for (const each of [matcher, message_matcher, window_matcher, typing_matcher]) each === active || each.reset();
        if (sequence_window !== window) active.reset();
        sequence_window = window;
        const result = active.feed(NORMAL_MODE, token);
        const source = situation !== "message" ? "page" : in_window ? "window" : "message";
        if (result.kind_ === "pending") {
            key_list_shown = true;
            deps.emit({ command: "pending", keys: result.typed_, windowId: deps.window_id_of(window), source });
        } else if (!(result.kind_ === "match" && result.leaf.steps.some((step) => step.invocation.id === KEY_LIST))) end_key_list(window);
        // Thunderbird binds single keys of its own in a message tab (`j` is junk), so a plain key stops here whether or not it matched.
        if (result.kind_ === "no_match") {
            if (situation === "message" && is_plain_printable(token)) (event.preventDefault(), event.stopPropagation());
            return;
        }
        if (result.kind_ === "match") {
            const steps = result.leaf.steps;
            // In a remote page only the close chord runs. The chrome cannot see a text field there, so any other chord (Ctrl+K in a web form) stays the page's own.
            if (situation === "remote" && steps.some((step) => step.runs_in !== "background" || step.invocation.args || step.invocation.id !== CLOSE_TAB)) return;
            for (const step of steps) {
                const count = result.count ?? step.invocation.count;
                if (step.invocation.id === "mode.insert") set_insert(window, true);
                else if (step.invocation.id === "mode.escape") (escaped = event, (escaped_in_field = in_text_field));
                else if (step.runs_in !== "background") deps.scroll(window, step.invocation.id, count);
                else if (step.invocation.id === KEY_LIST) {
                    // The background cannot tell which tree this tab runs, so the event names it.
                    key_list_shown = true;
                    deps.emit({ command: "pending", keys: [], windowId: deps.window_id_of(window), source, root: true });
                } else {
                    if (hold_commands.has(step.invocation.id)) (hold_until = deps.now() + HOLD_MS), (hints_done_at_hold = deps.hints_done_of(window));
                    deps.emit({ command: step.invocation.id, args: (step.invocation.args ?? {}) as Record<string, JsonValue>, count: count ?? 1, windowId: deps.window_id_of(window), messageIds: situation === "message" ? deps.message_ids_of(window) : [] });
                }
            }
        }
        if (event === escaped) return;
        event.preventDefault();
        event.stopPropagation();
    }

    function hook(window: Window): void {
        if (hooked.has(window)) return;
        const handler = (event: KeydownEvent) => on_keydown(window, event);
        const settle = (event: KeydownEvent) => {
            if (escaped !== event) return;
            escaped = null;
            if (!event.defaultPrevented) (set_insert(window, false), escaped_in_field && deps.blur_focused(window));
        };
        const reset_typing = () => {
            set_insert(window, false);
            reset_matchers();
            hold_until = 0;
            key_list_shown = false;
        };
        // A click on the tab bar sends no key, so no key handler can end the sequence. `g`, a click away and back, then `g` would run `gg`.
        const stop_tab_listening = deps.on_tab_select(window, reset_typing);
        const stop_blur_listening = deps.on_window_blur(window, reset_typing);
        const target = deps.key_target_of(window);
        hooked.set(window, { target, handler, settle, reset_typing, stop_tab_listening, stop_blur_listening });
        target.addEventListener("keydown", handler, true);
        target.addEventListener("keydown", settle, false);
    }

    function unhook(window: Window): void {
        const entry = hooked.get(window);
        if (!entry) return;
        entry.target.removeEventListener("keydown", entry.handler, true);
        entry.target.removeEventListener("keydown", entry.settle, false);
        set_insert(window, false);
        entry.stop_tab_listening();
        entry.stop_blur_listening();
        hooked.delete(window);
        if (sequence_window === window) sequence_window = null;
    }

    return {
        on_child_key(window, key) {
            if (key) (on_keydown(window as Window, key, key.field ? "field" : "page"), hooked.get(window as Window)?.settle(key));
            else (end_key_list(window as Window), hooked.get(window as Window)?.reset_typing());
        },
        install(trees, hold = []) {
            matcher = matcher_for_tree(trees.page);
            message_matcher = matcher_for_tree(trees.message);
            window_matcher = matcher_for_tree(trees.window);
            typing_matcher = matcher_for_tree(trees.typing);
            hold_commands = new Set(hold);
            if (listening) return;
            listening = true;
            deps.register_window_listener({ on_load_window: hook, on_unload_window: unhook });
            // The registration reports open windows too. Hooking them again is a no-op and covers a host that does not.
            for (const window of deps.open_windows()) hook(window);
        },
        shutdown() {
            for (const window of [...hooked.keys()]) unhook(window);
            insert.clear();
            typing_matcher = null;
            if (listening) deps.unregister_window_listener();
            listening = false;
            matcher = null;
            message_matcher = null;
            window_matcher = null;
            hold_until = 0;
            sequence_window = null;
        },
    };
}
