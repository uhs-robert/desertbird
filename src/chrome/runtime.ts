// Key handling in the main mail window. It holds no Thunderbird global: the parent hands in a `RuntimeDeps`, so node tests drive every path with fakes.

import type { JsonValue, KeysEvent, ModeName, PaneResizeDirection } from "../shared/protocol.ts";
import type { TreeLeaf } from "../../vendor/desertfox/prefix_tree.ts";
import { event_to_token } from "../../vendor/desertfox/keys/token.ts";
import type { KeyEventLike } from "../../vendor/desertfox/keys/token.ts";
import { NORMAL_MODE, is_plain_printable, matcher_for_tree } from "../shared/keymap_tree.ts";
import { leaves_insert } from "./escape_rule.ts";
import { run_motion } from "./motions.ts";
import type { ViewPort } from "./motions.ts";
import type { ListPort } from "./view.ts";

export interface KeydownEvent extends KeyEventLike {
    target: unknown;
    originalTarget?: unknown;
    defaultPrevented?: boolean;
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
    /** Whether an open menu or panel takes the plain key, or null when none is open. Plain keys then belong to the menu: one it takes passes to it and the rest are swallowed. */
    menu_takes_key(window: Window, key: string): boolean | null;
    /** Whether the focus sits in the overlay's browser while its page is not ready. Plain keys are dropped then, whatever the hold timer says. */
    overlay_is_loading(window: Window): boolean;
    /** Whether focus sits in the reading pane. Plain printable keys are swallowed there, so no motion runs and Thunderbird's own single-key shortcuts do not fire. */
    in_reading_pane(window: Window): boolean;
    /** Whether the focus sits in a text field or in the overlay's browser. Unlike `is_typing_target`, a message body that runs the body script does not count: resize mode keeps its keys there. */
    in_text_field(window: Window): boolean;
    /** Calls `listener` when the front tab of the window changes, whatever caused it: a click, Ctrl+Tab or a command. Returns the way to stop listening. */
    on_tab_select(window: Window, listener: () => void): () => void;
    /** Calls `listener` when the window itself loses focus, for example on an alt-tab. Focus moving between elements inside it does not count. Returns the way to stop listening. */
    on_window_blur(window: Window, listener: () => void): () => void;
    window_id_of(window: Window): number;
    /** How many hint picks have ended in the window. A change since a hold began means the labels came and went, so the hold ends. */
    hints_done_of(window: Window): number;
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

// Thunderbird binds single keys, so a key the runtime takes stops here.
const swallow = (event: KeydownEvent): void => void (event.preventDefault(), event.stopPropagation());

const RESIZE_KEYS: Record<string, PaneResizeDirection> = { h: "left", l: "right", j: "down", k: "up", "=": "reset" };

export function create_runtime<Window extends KeyTarget>(deps: RuntimeDeps<Window>): Runtime {
    const hooked = new Map<Window, { handler: (event: KeydownEvent) => void; settle: (event: KeydownEvent) => void; stop_tab_listening: () => void; stop_blur_listening: () => void }>();
    let matcher: ReturnType<typeof matcher_for_tree> | null = null;
    let listening = false;
    // The window that typed the half-typed sequence. A key from another window starts over, so `g` in one window and `g` in another never make `g g`.
    let sequence_window: Window | null = null;
    let hold_commands = new Set<string>();
    let hold_until = 0;
    // The picks ended when an f hold began, or null for a hold of the command line, which a hint pick never ends.
    let hints_done_at_hold: number | null = 0;
    // How many keys the last report held. Plain keys then report nothing, and an end is reported once.
    let was = 0;
    // Tells the background the keys typed so far, so it can list the keys that may follow. No keys means the sequence ended. A tab change or a window blur is not reported here: the background watches those.
    const pend = (w: Window, keys: string[]) => {
        if (keys.length || was) deps.emit({ command: "pending", keys, windowId: deps.window_id_of(w) });
        was = keys.length;
    };

    // The mode the background last heard and the window it heard it in. The anchor and the resize flag are shared by all windows, so another window can end a mode, and the end goes to the window that heard the start. Only a change is sent.
    let told_mode: ModeName = "normal";
    let told_window: Window | null = null;
    const tell_mode = (w: Window) => {
        const mode: ModeName = resize_window ? "resize" : insert_window ? "insert" : visual_anchor >= 0 ? "visual" : "normal";
        if (mode === told_mode) return;
        const before = told_window ?? w;
        told_mode = mode;
        told_window = mode === "normal" ? null : w;
        const tell = (name: ModeName, window: Window) => deps.emit({ command: "mode", mode: name, windowId: deps.window_id_of(window) });
        // A mode that starts in another window clears the old window first, so no label keeps the old mode.
        if (before !== w || mode === "normal") tell("normal", before);
        if (mode !== "normal") tell(mode, w);
    };

    // Resize mode: the window it runs in, or null. It takes the plain keys of the window until Escape or Enter, a tab change, a window blur, a text field, a menu or another window ends it. `resize_count` holds the digits typed since the last move, up to the six digits of the matcher.
    let resize_window: Window | null = null;
    let resize_count = 0;

    // Insert mode (`i`): the window it runs in, or null. Escape, a tab change, a window blur, a key in the reading pane or in another window ends it.
    let insert_window: Window | null = null;
    let escaped: KeydownEvent | null = null;

    // Visual mode: the row where `v` was pressed, or -1 when the mode is off. Motions then select the rows that were selected at `v` (the base, never unselected by the mode) plus the range from the anchor to the current row, so a second `v` adds to a kept selection. A blur or a tab change ends the mode, so no per-window copy is needed. Leaving the mode with `v`, Escape or Space keeps the selection as a pick. A command that removes the rows ends the mode and leaves Thunderbird to pick the next one.
    let visual_anchor = -1;
    let visual_base: number[] = [];

    // A pick: Space or the end of visual mode started one, and motions move only the current row, so a pick of one row survives `j`. One selected row looks the same whether it was picked or only read, so this flag is the only thing that tells them apart. A pick ends on Escape, a tab change, a blur and a command that removes rows.
    let picking = false;
    // The current row, the selected rows, and the view and message keys at them after the last key. A key that finds anything else means the list changed under the runtime (a click, new mail, a row inserted or removed above one of them, a sort or folder change), so visual mode and the pick end and old rows never reach into the new list. The current row's key counts too, since a row removed under an unselected cursor leaves every selected row as it was. The row numbers count as well as the keys: a message inserted above a selected row moves the row and its key together.
    let list_seen: unknown[] = [];
    const list_view = (port: ListPort, rows = port.selected_rows()) => [port.selected_index(), ...rows, ...port.marks([...rows, port.selected_index()])];
    const differs = (now: unknown[], then: unknown[]) => now.length !== then.length || now.some((mark, at) => mark !== then[at]);

    // For `.`. An unrepeatable leaf clears it.
    let last: { leaf: TreeLeaf; count: number | undefined } | null = null;

    function run_leaf(leaf: TreeLeaf, port: ListPort, window: Window, count?: number): void | null {
        const id = leaf.steps[0]?.invocation.id;
        if (id === "repeat.last") return last && run_leaf(last.leaf, port, window, count ?? last.count);
        if (id === "pane.resize_mode") return void ((resize_window = window), (resize_count = 0), (visual_anchor = -1));
        if (id === "mode.insert") return void ((insert_window = window), (resize_window = null), (visual_anchor = -1), (picking = false));
        // Space in visual mode leaves it as `v` does, since Space is a toggle of normal mode. It is still unrepeatable, so it clears `.`.
        if (id === "select.toggle" && visual_anchor >= 0) last = null;
        if (id === "visual.toggle" || (id === "select.toggle" && visual_anchor >= 0)) return void (visual_anchor < 0 ? ((visual_anchor = port.selected_index()), (visual_base = port.selected_rows())) : ((visual_anchor = -1), (picking = true)));
        if (id !== KEY_LIST) last = leaf.steps.some((step) => "repeatable" in step) ? null : { leaf, count };
        // Space toggles the current row, and the cursor stays. The Space that starts a pick on the one selected row keeps it, so the read message is the first one picked (the string compare asks whether the current row is the only selected row). It acts on the thread list only, so it does nothing while the folder pane has the focus.
        if (id === "select.toggle") return void (deps.folder_port_of(window) || port.selected_index() < 0 || ((picking || `${port.selected_rows()}` !== `${port.selected_index()}`) && port.toggle(port.selected_index()), (picking = true)));
        for (const step of leaf.steps) {
            const step_count = count ?? step.invocation.count;
            if (step.runs_in === "background" && hold_commands.has(step.invocation.id)) {
                hold_until = deps.now() + HOLD_MS;
                hints_done_at_hold = step.invocation.id.startsWith("hint.") ? deps.hints_done_of(window) : null;
            }
            if (step.runs_in === "chrome") {
                const anchor = visual_anchor;
                const range = (end: number) => Array.from({ length: Math.abs(end - anchor) + 1 }, (_, offset) => Math.min(anchor, end) + offset);
                // In a pick or with two or more rows selected a motion moves only the current row, so the selection stays. Otherwise it selects the row, so the message pane shows each message passed.
                const list_port = anchor >= 0 ? { ...port, select: (index: number) => void (port.select_rows([...new Set([...visual_base, ...range(index)])], index)) } : picking || port.selected_rows().length > 1 ? { ...port, select: port.move_cursor } : port;
                run_motion(step.invocation.id, deps.folder_port_of(window) ?? list_port, step_count);
            } else if (step.runs_in === "background") {
                // The selection is read here, inside the key's own handler, because the background answers later: by then a following `j` has moved the selection.
                const args = (step.invocation.args ?? {}) as Record<string, JsonValue>;
                deps.emit({ command: step.invocation.id, args, count: step_count ?? 1, windowId: deps.window_id_of(window), messageIds: port.selected_message_ids() });
                // The panel of the key list is not a typed prefix, so the next key reports the end of it.
                if (step.invocation.id === KEY_LIST) was = 1;
                // A command whose rows stay in the list keeps the mode and the pick, so a second command acts on the same rows.
                if (!("keeps_selection" in step)) visual_anchor = -1, picking = false;
            }
        }
    }

    function on_keydown(window: Window, event: KeydownEvent): void {
        if (!matcher) return;
        // A chord takes the named-key path: it runs and is cancelled only when the keymap binds it, so Thunderbird keeps every chord the keymap leaves free.
        const token = event_to_token(event);
        if (token === null) return;
        // A key in another window ends the mode before any early return below.
        if (resize_window && resize_window !== window) resize_window = null;
        // Space is text in the line, and in the list it picks a row, so the hold drops it with the plain keys.
        const held = is_plain_printable(token) || token === "<Space>";
        // The overlay's browser has the focus before its page can take a key, and the hold timer can run out first. Plain keys are dropped for as long as that lasts.
        if (held && deps.overlay_is_loading(window)) return swallow(event);
        // The hold ends when the focus is in a text field, which the overlay's browser counts as.
        if (hold_until > deps.now()) {
            if (deps.is_typing_target(window, event) || hints_done_at_hold !== null && deps.hints_done_of(window) !== hints_done_at_hold) hold_until = 0;
            else if (held) {
                swallow(event);
                return;
            }
        }
        if (deps.tab_kind_of(window)) return matcher.reset();
        const typing = deps.is_typing_target(window, event);
        const menu_takes = typing ? null : deps.menu_takes_key(window, token);
        if (insert_window && (insert_window !== window || (typing && deps.in_reading_pane(window)))) insert_window = null;
        // No key runs or is cancelled here. Escape alone is read, by `settle`.
        if (insert_window) {
            if (token === "<Escape>" || token === "<C-[>") escaped = event;
            return;
        }
        if (resize_window && (deps.in_text_field(window) || menu_takes !== null)) resize_window = null;
        // A chord is no resize key, so it runs as in normal mode and the mode stays: `<A-l>` moves the focus to the message pane and the mode follows it.
        if (resize_window && /^(.|<Escape>|<Enter>)$/.test(token)) {
            swallow(event);
            const direction = RESIZE_KEYS[token];
            if (/^\d$/.test(token)) {
                if (resize_count < 100000) resize_count = resize_count * 10 + Number(token);
            }
            else if (direction) {
                deps.emit({ command: "pane.resize", args: { direction }, count: resize_count || 1, windowId: deps.window_id_of(window), messageIds: [] });
                resize_count = 0;
            } else if (!is_plain_printable(token)) {
                // A chord prefix typed in the mode must not complete after it.
                resize_window = null;
                matcher.reset();
                pend(window, []);
            }
            return;
        }
        // The thread list is the target unless the key goes to a text field or an open menu.
        const port = typing || menu_takes !== null ? null : deps.list_port_of(window);
        // A key that leaves the list ends a half-typed sequence. Otherwise `d`, a trip to the quick filter, then `d` would trash.
        if (!port || deps.in_reading_pane(window)) {
            matcher.reset();
            visual_anchor = -1;
            picking = false;
            pend(window, []);
            // A menu opened by a click leaves the focus in the list, so Thunderbird's single-key shortcuts (`j` marks junk) would act under the menu.
            if (is_plain_printable(token) && (port || menu_takes === false)) {
                swallow(event);
                // The message header takes `i` here, since the keys of the reading pane are not run by the tree.
                if (token === "i" && port) insert_window = window;
            }
            return;
        }
        if (differs(list_view(port), list_seen)) (visual_anchor = -1), (picking = false);
        // Escape ends visual mode and keeps the selection as a pick. Out of it, Escape ends a pick and drops a selection of two or more rows to the current row. Otherwise it passes, so the command line overlay and Thunderbird keep it.
        if (token === "<Escape>" && (visual_anchor >= 0 || ((picking || port.selected_rows().length > 1) && !deps.folder_port_of(window)))) {
            matcher.reset();
            pend(window, []);
            picking = visual_anchor >= 0 || (port.select(port.selected_index()), false);
            visual_anchor = -1;
            swallow(event);
            return;
        }
        if (sequence_window !== window) matcher.reset();
        sequence_window = window;
        const result = matcher.feed(NORMAL_MODE, token);
        pend(window, result.kind_ === "pending" ? result.typed_ : []);
        if (result.kind_ === "no_match" && !is_plain_printable(token)) return;
        // Thunderbird binds single keys such as `j` and `a`, so the key stops here whether or not it matched.
        swallow(event);
        if (result.kind_ === "match") run_leaf(result.leaf, port, window, result.count);
        list_seen = list_view(port);
    }

    function hook(window: Window): void {
        if (hooked.has(window)) return;
        const handler = (event: KeydownEvent) => (on_keydown(window, event), tell_mode(window));
        // The folder tree cancels every key it handles, Escape included, so a cancelled Escape there is no sign that Thunderbird used it.
        const settle = (event: KeydownEvent) => (leaves_insert(escaped, event) || (escaped === event && deps.folder_port_of(window))) && ((insert_window = null), tell_mode(window));
        const reset_typing = () => {
            insert_window = null;
            matcher?.reset();
            hold_until = 0;
            visual_anchor = -1;
            picking = false;
            resize_window = null;
            tell_mode(window);
        };
        // A click on the tab bar sends no key, so no key handler can end the sequence. `d`, a click away and back, then `d` would trash.
        const stop_tab_listening = deps.on_tab_select(window, reset_typing);
        // The same hazard with focus: `d`, an alt-tab away and back, then `d`.
        const stop_blur_listening = deps.on_window_blur(window, reset_typing);
        hooked.set(window, { handler, settle, stop_tab_listening, stop_blur_listening });
        window.addEventListener("keydown", handler, true);
        window.addEventListener("keydown", settle, false);
    }

    function unhook(window: Window): void {
        const entry = hooked.get(window);
        if (!entry) return;
        window.removeEventListener("keydown", entry.handler, true);
        window.removeEventListener("keydown", entry.settle, false);
        entry.stop_tab_listening();
        entry.stop_blur_listening();
        hooked.delete(window);
        if (sequence_window === window) sequence_window = null;
        if (insert_window === window || resize_window === window) ((insert_window = resize_window = null), tell_mode(window));
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
            resize_window = null;
            insert_window = null;
            hold_until = 0;
            sequence_window = null;
        },
    };
}
