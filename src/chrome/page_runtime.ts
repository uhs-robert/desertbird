// Key handling in the tabs of the main window that are not the mail tab. It holds no Thunderbird global: the parent hands in a `PageDeps`, so node tests drive every path with fakes.

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
    /** The MailExtension ids of the message the front tab shows, read when the key is pressed. */
    message_ids_of(window: Window): number[];
    /** Runs a reading action of the front tab's document. Returns false for an id it has no action for: a message step that needs the body script (hints, find) ends here. */
    scroll(window: Window, id: string, count: number | undefined): boolean;
    on_tab_select(window: Window, listener: () => void): () => void;
    on_window_blur(window: Window, listener: () => void): () => void;
    window_id_of(window: Window): number;
    /** Milliseconds, for the hold timeout. */
    now(): number;
    emit(event: KeysEvent): void;
}

export interface PageRuntime {
    install(trees: { page: { version: number; root: unknown }; message: { version: number; root: unknown } }, hold_commands?: readonly string[]): void;
    shutdown(): void;
}

// How long plain keys are dropped after a command that opens the overlay. The same wait as the mail runtime, which shares no state with this bundle.
const HOLD_MS = 1500;

const KEY_LIST = "help.whichkey";

export function create_page_runtime<Window>(deps: PageDeps<Window>): PageRuntime {
    const hooked = new Map<Window, { target: KeyTarget; handler: (event: KeydownEvent) => void; stop_tab_listening: () => void; stop_blur_listening: () => void }>();
    let matcher: ReturnType<typeof matcher_for_tree> | null = null;
    // The message tab takes its own tree, so its keys and their meaning follow the message document's.
    let message_matcher: ReturnType<typeof matcher_for_tree> | null = null;
    let listening = false;
    let sequence_window: Window | null = null;
    let hold_commands = new Set<string>();
    let hold_until = 0;
    // Whether the last report left the key list open. The next key then reports its end, and plain keys report nothing. Pending keys are never reported from a page tab, so the panel of a half-typed sequence does not show.
    let key_list_shown = false;

    function end_key_list(window: Window): void {
        if (key_list_shown) deps.emit({ command: "pending", keys: [], windowId: deps.window_id_of(window) });
        key_list_shown = false;
    }

    function on_keydown(window: Window, event: KeydownEvent): void {
        if (!matcher || !message_matcher) return;
        // A chord takes the named-key path: it runs and is cancelled only when the keymap binds it, so Thunderbird keeps every chord the keymap leaves free.
        const token = event_to_token(event);
        if (token === null) return;
        const situation = deps.situation_of(window, event);
        if (hold_until > deps.now()) {
            // The hold ends when the focus is in a text field, which the overlay's browser counts as.
            if (situation === "typing") hold_until = 0;
            else if (situation !== "pass" && is_plain_printable(token)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        end_key_list(window);
        if (situation === "pass" || situation === "typing") return (matcher.reset(), message_matcher.reset());
        // A page of another process hides its text fields, so only a chord is safe there.
        if (situation === "remote" && is_plain_printable(token)) return matcher.reset();
        // The two matchers each keep a half-typed sequence, so the one not in use starts over.
        const [active, idle] = situation === "message" ? [message_matcher, matcher] : [matcher, message_matcher];
        idle.reset();
        if (sequence_window !== window) active.reset();
        sequence_window = window;
        const result = active.feed(NORMAL_MODE, token);
        // Thunderbird binds single keys of its own in a message tab (`j` is junk), so a plain key stops here whether or not it matched.
        if (result.kind_ === "no_match") {
            if (situation === "message" && is_plain_printable(token)) (event.preventDefault(), event.stopPropagation());
            return;
        }
        if (result.kind_ === "match") {
            const steps = result.leaf.steps;
            // In a remote page only a bound command of the background runs, and one that takes no argument: the page's own chords stay its own.
            if (situation === "remote" && steps.some((step) => step.runs_in !== "background" || step.invocation.args)) return;
            for (const step of steps) {
                const count = result.count ?? step.invocation.count;
                if (step.runs_in !== "background") deps.scroll(window, step.invocation.id, count);
                else {
                    if (hold_commands.has(step.invocation.id)) hold_until = deps.now() + HOLD_MS;
                    if (step.invocation.id === KEY_LIST) key_list_shown = true;
                    deps.emit({ command: step.invocation.id, args: (step.invocation.args ?? {}) as Record<string, JsonValue>, count: count ?? 1, windowId: deps.window_id_of(window), messageIds: situation === "message" ? deps.message_ids_of(window) : [] });
                }
            }
        }
        event.preventDefault();
        event.stopPropagation();
    }

    function hook(window: Window): void {
        if (hooked.has(window)) return;
        const handler = (event: KeydownEvent) => on_keydown(window, event);
        const reset_typing = () => {
            matcher?.reset();
            message_matcher?.reset();
            hold_until = 0;
        };
        // A click on the tab bar sends no key, so no key handler can end the sequence. `g`, a click away and back, then `g` would run `gg`.
        const stop_tab_listening = deps.on_tab_select(window, reset_typing);
        const stop_blur_listening = deps.on_window_blur(window, reset_typing);
        const target = deps.key_target_of(window);
        hooked.set(window, { target, handler, stop_tab_listening, stop_blur_listening });
        target.addEventListener("keydown", handler, true);
    }

    function unhook(window: Window): void {
        const entry = hooked.get(window);
        if (!entry) return;
        entry.target.removeEventListener("keydown", entry.handler, true);
        entry.stop_tab_listening();
        entry.stop_blur_listening();
        hooked.delete(window);
        if (sequence_window === window) sequence_window = null;
    }

    return {
        install(trees, hold = []) {
            matcher = matcher_for_tree(trees.page);
            message_matcher = matcher_for_tree(trees.message);
            hold_commands = new Set(hold);
            if (listening) return;
            listening = true;
            deps.register_window_listener({ on_load_window: hook, on_unload_window: unhook });
            // The registration reports open windows too. Hooking them again is a no-op and covers a host that does not.
            for (const window of deps.open_windows()) hook(window);
        },
        shutdown() {
            for (const window of [...hooked.keys()]) unhook(window);
            if (listening) deps.unregister_window_listener();
            listening = false;
            matcher = null;
            message_matcher = null;
            hold_until = 0;
            sequence_window = null;
        },
    };
}
