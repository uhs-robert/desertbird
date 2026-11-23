// The keys of a compose window: one mode per window, shared by the body and the address and subject fields. It holds no Thunderbird global: the parent hands in a `ComposeDeps`, so node tests drive every path with fakes.

import { COMPILED_KEYMAP_VERSION } from "../shared/protocol.ts";
import type { JsonValue, KeysInvocation } from "../shared/protocol.ts";
import type { LeafStep } from "../../vendor/desertfox/prefix_tree.ts";
import type { KeydownEvent, KeyTarget, WindowListener } from "./runtime.ts";

export type ComposeMode = "insert" | "normal";

/** Where the focus of a compose window sits: the body editor, a text field of the header (an address input, a pill being edited, the subject), or anything else (From, the attachment list, a sidebar, the find bar), where every key passes. */
export type ComposeTarget = "body" | "field" | "other";

export const COMPOSE_FIELDS = ["to", "cc", "bcc", "subject", "body"] as const;
export type ComposeField = (typeof COMPOSE_FIELDS)[number];

/** The two Thunderbird commands the window keys run. Both open a prompt that waits in a nested event loop, so the parent runs them from a timer. */
export type ComposeCommand = "cmd_close" | "cmd_sendWithCheck";

/** A node of the compiled compose tree: a branch with children by key token, or a leaf with steps. */
interface ComposeNode {
    children?: Record<string, ComposeNode>;
    steps?: LeafStep[];
}

export interface ComposeKeyEvent extends KeydownEvent {
    repeat?: boolean;
    isComposing?: boolean;
}

export interface ComposeDeps<Window> {
    /** Calls `on_load_window` for each compose window already open and for each one opened later. */
    register_window_listener(listener: WindowListener<Window>): void;
    unregister_window_listener(): void;
    open_windows(): Window[];
    /** Where the key listener goes: above the window, so it sees a key before Thunderbird's handlers and the body script do. */
    key_target_of(window: Window): KeyTarget;
    target_of(window: Window): ComposeTarget;
    /** Whether the focused field uses Escape itself: an open address popup closes, a pill being edited goes back to its address. */
    field_takes_escape(window: Window): boolean;
    focus_field(window: Window, field: ComposeField): void;
    run_command(window: Window, command: ComposeCommand): void;
    /** Draws the mode label of the window, or removes it for null. */
    show_mode(window: Window, mode: ComposeMode | null): void;
    window_id_of(window: Window): number;
    emit(event: KeysInvocation): void;
}

export interface ComposeRuntime {
    /** `allow_send` is the `compose_send` setting: while it is off the send key runs nothing. */
    install(tree: { version: number; root: unknown }, allow_send: boolean): void;
    shutdown(): void;
}

/** The leaves the runtime runs itself. Each other leaf goes to the background. */
export const COMPOSE_CHROME_IDS = ["compose.focus", "compose.close", "compose.send"] as const;

/** The token of the compiled tree for a typed character or a chord on one (`j`, `<CS-t>`), or null for a named key, which no compose key binds. Shift on a chord with a letter shows as `S` with the letter in lower case: Ctrl+Shift+T arrives as `t` with Shift held (measured), and as `T` under Caps Lock. */
export function compose_token(event: ComposeKeyEvent): string | null {
    const key = event.key;
    if ([...key].length !== 1) return null;
    const mods = (event.altKey ? "A" : "") + (event.ctrlKey ? "C" : "") + (event.metaKey ? "M" : "");
    const is_letter = key.toLowerCase() !== key.toUpperCase();
    return mods ? `<${mods}${event.shiftKey && is_letter ? "S" : ""}-${is_letter ? key.toLowerCase() : key}>` : key === " " ? "<Space>" : key;
}

// What would change the draft in normal mode. Tab and Shift+Tab move the focus in a field, and make a pill of a typed address there, so only the body holds them back (a plain-text body inserts a tab).
const EDITING_KEYS = new Set(["Enter", "Backspace", "Delete"]);

export function create_compose_runtime<Window>(deps: ComposeDeps<Window>): ComposeRuntime {
    const hooked = new Map<Window, { target: KeyTarget; handler: (event: ComposeKeyEvent) => void }>();
    // Memory only: a window opens in insert mode, and the mode changes only on Escape and `i`, never on focus, because a draft save moves the focus.
    const modes = new Map<Window, ComposeMode>();
    let root: ComposeNode | null = null;
    // The branch of a half-typed sequence and its window. A key in another window starts over.
    let pending: ComposeNode | null = null;
    let sequence_window: Window | null = null;
    let allow_send = false;
    let listening = false;

    const set_mode = (window: Window, mode: ComposeMode) => {
        modes.set(window, mode);
        pending = null;
        deps.show_mode(window, mode);
    };

    function run_leaf(window: Window, steps: LeafStep[]): void {
        for (const { runs_in, invocation } of steps) {
            const id = invocation.id;
            const args = (invocation.args ?? {}) as Record<string, JsonValue>;
            if (runs_in === "background") deps.emit({ command: id, args, count: invocation.count ?? 1, windowId: deps.window_id_of(window), messageIds: [] });
            else if (id === "compose.focus" && COMPOSE_FIELDS.includes(args["field"] as ComposeField)) deps.focus_field(window, args["field"] as ComposeField);
            else if (id === "compose.close") deps.run_command(window, "cmd_close");
            else if (id === "compose.send" && allow_send) deps.run_command(window, "cmd_sendWithCheck");
        }
    }

    function on_keydown(window: Window, event: ComposeKeyEvent): void {
        if (!root || event.isComposing) return;
        const target = deps.target_of(window);
        if (target === "other" || sequence_window !== window) pending = null;
        sequence_window = window;
        if (target === "other") return;
        const take = () => void (event.preventDefault(), event.stopPropagation());
        if (event.key === "Escape") {
            pending = null;
            // Escape in normal mode passes, so Thunderbird still closes the find bar and a notification with it.
            if (!deps.field_takes_escape(window) && modes.get(window) !== "normal") (take(), set_mode(window, "normal"));
            return;
        }
        if (modes.get(window) !== "normal") return;
        const token = compose_token(event);
        if (token === "i" && !pending) return void (take(), set_mode(window, "insert"));
        // A held key repeats. Only the first press runs, so a held `q` asks to close once.
        const next = token === null || event.repeat ? undefined : (pending ?? root).children?.[token];
        if (token !== null && !event.repeat) pending = next?.children ? next : null;
        if (next?.steps) run_leaf(window, next.steps);
        // An unbound chord stays Thunderbird's (Ctrl+Enter, Ctrl+S). Any other key that would type is held back.
        const chord = event.ctrlKey || event.altKey || event.metaKey;
        if (next || (!chord && (token !== null || EDITING_KEYS.has(event.key) || (event.key === "Tab" && target === "body")))) take();
    }

    function hook(window: Window): void {
        if (!modes.has(window)) modes.set(window, "insert");
        // The listener may run once for a window that was open at the install and again when the window listener reports it, so only the label is drawn again.
        deps.show_mode(window, modes.get(window)!);
        if (hooked.has(window)) return;
        const target = deps.key_target_of(window);
        const handler = (event: ComposeKeyEvent) => on_keydown(window, event);
        hooked.set(window, { target, handler });
        target.addEventListener("keydown", handler, true);
    }

    function unhook(window: Window): void {
        const entry = hooked.get(window);
        if (entry) entry.target.removeEventListener("keydown", entry.handler, true);
        hooked.delete(window);
        modes.delete(window);
        deps.show_mode(window, null);
        if (sequence_window === window) sequence_window = pending = null;
    }

    return {
        install(tree, send) {
            if (tree.version !== COMPILED_KEYMAP_VERSION) throw new Error(`keymap version ${tree.version} is not ${COMPILED_KEYMAP_VERSION}`);
            root = tree.root as ComposeNode;
            allow_send = send;
            if (listening) return;
            listening = true;
            deps.register_window_listener({ on_load_window: hook, on_unload_window: unhook });
            for (const window of deps.open_windows()) hook(window);
        },
        shutdown() {
            for (const window of [...hooked.keys()]) unhook(window);
            if (listening) deps.unregister_window_listener();
            listening = false;
            root = sequence_window = pending = null;
        },
    };
}
