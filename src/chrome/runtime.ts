// Key handling in the main mail window. It holds no Thunderbird global: the parent hands in a `RuntimeDeps`, so node tests drive every path with fakes.

import type { JsonValue, KeysEvent } from "../shared/protocol.ts";
import type { TreeLeaf } from "../../vendor/desertfox/prefix_tree.ts";
import { event_to_token } from "../../vendor/desertfox/keys/token.ts";
import type { KeyEventLike } from "../../vendor/desertfox/keys/token.ts";
import { NORMAL_MODE, is_plain_printable, matcher_for_tree } from "../shared/keymap_tree.ts";
import { run_motion } from "./motions.ts";
import type { ViewPort } from "./motions.ts";
import type { ListPort } from "./view.ts";

export interface KeydownEvent extends KeyEventLike {
    target: unknown;
    originalTarget?: unknown;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface KeyTarget {
    addEventListener(type: "keydown", listener: (event: KeydownEvent) => void, capture: boolean): void;
    removeEventListener(type: "keydown", listener: (event: KeydownEvent) => void, capture: boolean): void;
}

export interface WindowListener<Window> {
    on_load_window(window: Window): void;
    on_unload_window(window: Window): void;
}

export interface RuntimeDeps<Window extends KeyTarget> {
    /** Calls `on_load_window` for each main window already open and for each one opened later. */
    register_window_listener(listener: WindowListener<Window>): void;
    unregister_window_listener(): void;
    open_windows(): Window[];
    /** The thread list of the window's front tab, or null when that tab is not the mail tab. Keys then pass through. */
    list_port_of(window: Window): ListPort | null;
    /** The front tab: 0 the mail tab, 1 any other. The keys of another tab belong to the `pages` bundle. */
    tab_kind_of(window: Window): 0 | 1;
    /** The folder tree while the folder pane has the focus, or null. The motions then move the folder selection instead of the thread list. */
    folder_port_of(window: Window): ViewPort | null;
    /** Whether the key is meant for someone else: a text field, or a message body that runs the body script. The event target is not enough: see `focus.ts`. */
    is_typing_target(window: Window, event: KeydownEvent): boolean;
    /** Whether a menu or panel is open. Keys then belong to it, its access keys among them. */
    menu_is_open(window: Window): boolean;
    /** Whether focus sits in the reading pane. Plain printable keys are swallowed there, so no motion runs and Thunderbird's own single-key shortcuts do not fire. */
    in_reading_pane(window: Window): boolean;
    /** Calls `listener` when the front tab of the window changes, whatever caused it: a click, Ctrl+Tab or a command. Returns the way to stop listening. */
    on_tab_select(window: Window, listener: () => void): () => void;
    /** Calls `listener` when the window itself loses focus, for example on an alt-tab. Focus moving between elements inside it does not count. Returns the way to stop listening. */
    on_window_blur(window: Window, listener: () => void): () => void;
    window_id_of(window: Window): number;
    /** Milliseconds, for the hold timeout. */
    now(): number;
    emit(event: KeysEvent): void;
}

export interface Runtime {
    install(tree: { version: number; root: unknown }, hold_commands?: readonly string[]): void;
    shutdown(): void;
}

// How long plain keys are dropped after a command that opens the overlay. The overlay takes the focus a round trip later, so keys typed ahead would otherwise act on the list.
const HOLD_MS = 1500;

const KEY_LIST = "help.whichkey";

export function create_runtime<Window extends KeyTarget>(deps: RuntimeDeps<Window>): Runtime {
    const hooked = new Map<Window, { handler: (event: KeydownEvent) => void; stop_tab_listening: () => void; stop_blur_listening: () => void }>();
    let matcher: ReturnType<typeof matcher_for_tree> | null = null;
    let listening = false;
    // The window that typed the half-typed sequence. A key from another window starts over, so `g` in one window and `g` in another never make `g g`.
    let sequence_window: Window | null = null;
    let hold_commands = new Set<string>();
    let hold_until = 0;
    // How many keys the last report held. Plain keys then report nothing, and an end is reported once.
    let was = 0;
    // Tells the background the keys typed so far, so it can list the keys that may follow. No keys means the sequence ended. A tab change or a window blur is not reported here: the background watches those.
    const pend = (w: Window, keys: string[]) => {
        if (keys.length || was) deps.emit({ command: "pending", keys, windowId: deps.window_id_of(w) });
        was = keys.length;
    };

    // The window the background last heard visual mode start in, or null. The anchor is shared by all windows, so another window can end the mode, and the end goes to the window that heard the start. Only a change is sent.
    let visual_told: Window | null = null;
    const tell_visual = (w: Window) => {
        const on = visual_anchor >= 0;
        if (on === (visual_told !== null)) return;
        const told = visual_told ?? w;
        visual_told = on ? w : null;
        deps.emit({ command: "mode", mode: on ? "visual" : "normal", windowId: deps.window_id_of(told) });
    };

    // Visual mode: the row where `v` was pressed, or -1 when the mode is off. Motions then select the range from it to the current row. A blur or a tab change ends the mode, so no per-window copy is needed. A background command that removes or moves rows ends it too, so `a` or `d` acts on the range once. One that leaves the rows (`m r`, `m s`) keeps it.
    let visual_anchor = -1;
    // Where the mode last put the current row, and the view and message keys at both ends of the range then. A key that finds anything else means the list changed under the mode (a click, new mail, a row inserted or removed inside the range, a sort or folder change), so the mode ends and the old anchor never reaches into the new list.
    let visual_end = -1;
    let visual_marks: unknown[] = [];

    function end_visual(port: ListPort): void {
        visual_anchor = -1;
        port.select(port.selected_index());
    }

    // For `.`. An unrepeatable leaf clears it.
    let last: { leaf: TreeLeaf; count: number | undefined } | null = null;

    function run_leaf(leaf: TreeLeaf, port: ListPort, window: Window, count?: number): void | null {
        if (leaf.steps[0]?.invocation.id === "repeat.last") return last && run_leaf(last.leaf, port, window, count ?? last.count);
        if (leaf.steps[0]?.invocation.id === "visual.toggle") return visual_anchor < 0 ? void ((visual_end = visual_anchor = port.selected_index()), (visual_marks = port.marks(visual_anchor, visual_anchor))) : end_visual(port);
        if (leaf.steps[0]?.invocation.id !== KEY_LIST) last = leaf.steps.some((step) => "repeatable" in step) ? null : { leaf, count };
        for (const step of leaf.steps) {
            const step_count = count ?? step.invocation.count;
            if (step.runs_in === "background" && hold_commands.has(step.invocation.id)) hold_until = deps.now() + HOLD_MS;
            if (step.runs_in === "chrome") {
                const anchor = visual_anchor;
                run_motion(step.invocation.id, deps.folder_port_of(window) ?? (anchor < 0 ? port : { ...port, select: (index) => void (port.select_range(anchor, (visual_end = index)), (visual_marks = port.marks(anchor, index))) }), step_count);
            } else if (step.runs_in === "background") {
                // The selection is read here, inside the key's own handler, because the background answers later: by then a following `j` has moved the selection.
                const args = (step.invocation.args ?? {}) as Record<string, JsonValue>;
                deps.emit({ command: step.invocation.id, args, count: step_count ?? 1, windowId: deps.window_id_of(window), messageIds: port.selected_message_ids() });
                // The panel of the key list is not a typed prefix, so the next key reports the end of it.
                if (step.invocation.id === KEY_LIST) was = 1;
                // The range is taken. Collapsing to the current row keeps a following `d d` to one message. A command whose rows stay in the list keeps the range.
                if (visual_anchor >= 0 && !("keeps_selection" in step)) end_visual(port);
            }
        }
    }

    /** The thread list a key acts on, or null when the key goes to a text field, an open menu or a tab that is not the mail tab. */
    function list_port_for(window: Window, event: KeydownEvent): ListPort | null {
        return deps.is_typing_target(window, event) || deps.menu_is_open(window) ? null : deps.list_port_of(window);
    }

    function on_keydown(window: Window, event: KeydownEvent): void {
        if (!matcher) return;
        // A chord takes the named-key path: it runs and is cancelled only when the keymap binds it, so Thunderbird keeps every chord the keymap leaves free.
        const token = event_to_token(event);
        if (token === null) return;
        // The hold ends when the focus is in a text field, which the overlay's browser counts as.
        if (hold_until > deps.now()) {
            if (deps.is_typing_target(window, event)) hold_until = 0;
            else if (is_plain_printable(token)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        if (deps.tab_kind_of(window)) return matcher.reset();
        const port = list_port_for(window, event);
        // A key that leaves the list ends a half-typed sequence. Otherwise `d`, a trip to the quick filter, then `d` would trash.
        if (!port || deps.in_reading_pane(window)) {
            matcher.reset();
            visual_anchor = -1;
            pend(window, []);
            if (port && is_plain_printable(token)) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }
        if (visual_anchor >= 0 && (port.selected_index() !== visual_end || port.marks(visual_anchor, visual_end).some((mark, at) => mark !== visual_marks[at]))) visual_anchor = -1;
        // Escape belongs to visual mode only while it is active, so the command line overlay and Thunderbird keep it otherwise.
        if (visual_anchor >= 0 && token === "<Escape>") {
            matcher.reset();
            pend(window, []);
            end_visual(port);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (sequence_window !== window) matcher.reset();
        sequence_window = window;
        const result = matcher.feed(NORMAL_MODE, token);
        pend(window, result.kind_ === "pending" ? result.typed_ : []);
        if (result.kind_ === "no_match" && !is_plain_printable(token)) return;
        // Thunderbird binds single keys such as `j` and `a`, so the key stops here whether or not it matched.
        event.preventDefault();
        event.stopPropagation();
        if (result.kind_ === "match") run_leaf(result.leaf, port, window, result.count);
    }

    function hook(window: Window): void {
        if (hooked.has(window)) return;
        const handler = (event: KeydownEvent) => (on_keydown(window, event), tell_visual(window));
        const reset_typing = () => {
            matcher?.reset();
            hold_until = 0;
            visual_anchor = -1;
            tell_visual(window);
        };
        // A click on the tab bar sends no key, so no key handler can end the sequence. `d`, a click away and back, then `d` would trash.
        const stop_tab_listening = deps.on_tab_select(window, reset_typing);
        // The same hazard with focus: `d`, an alt-tab away and back, then `d`.
        const stop_blur_listening = deps.on_window_blur(window, reset_typing);
        hooked.set(window, { handler, stop_tab_listening, stop_blur_listening });
        window.addEventListener("keydown", handler, true);
    }

    function unhook(window: Window): void {
        const entry = hooked.get(window);
        if (!entry) return;
        window.removeEventListener("keydown", entry.handler, true);
        entry.stop_tab_listening();
        entry.stop_blur_listening();
        hooked.delete(window);
        if (sequence_window === window) sequence_window = null;
    }

    return {
        install(tree, hold = []) {
            matcher = matcher_for_tree(tree);
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
            visual_anchor = -1;
            hold_until = 0;
            sequence_window = null;
        },
    };
}
