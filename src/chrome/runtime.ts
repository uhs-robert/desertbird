// Key handling in the main mail window. It holds no Thunderbird global: the parent hands in a `RuntimeDeps`, so node tests drive every path with fakes.

import { COMPILED_KEYMAP_VERSION } from "../../vendor/desertfox/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../../vendor/desertfox/prefix_tree.ts";
import { create_matcher } from "../../vendor/desertfox/keys/matcher.ts";
import { event_to_token } from "../../vendor/desertfox/keys/token.ts";
import type { KeyEventLike } from "../../vendor/desertfox/keys/token.ts";
import { run_motion } from "./motions.ts";
import type { ViewPort } from "./motions.ts";

export interface KeydownEvent extends KeyEventLike {
    target: unknown;
    originalTarget?: unknown;
    composedPath?(): unknown[];
    preventDefault(): void;
    stopPropagation(): void;
}

export interface KeyTarget {
    addEventListener(type: "keydown", listener: (event: KeydownEvent) => void, capture: boolean): void;
    removeEventListener(type: "keydown", listener: (event: KeydownEvent) => void, capture: boolean): void;
}

/** The invocation that leaves for the background. Plain data only. */
export interface Invocation {
    command: string;
    args: Record<string, unknown>;
    count: number;
    windowId: number;
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
    view_port_of(window: Window): ViewPort | null;
    /** Whether the key is meant for a text field. The event target is not enough: see `focus.ts`. */
    is_typing_target(window: Window, event: KeydownEvent): boolean;
    window_id_of(window: Window): number;
    emit(invocation: Invocation): void;
}

export interface Runtime {
    install(tree: { version: number; root: unknown }): void;
    shutdown(): void;
}

const NORMAL_MODE = "normal";

// A plain printable key is one character. Named keys (Enter, Escape, arrows, Tab, Space) have a token in angle brackets, so they pass through.
const is_plain_printable = (token: string): boolean => [...token].length === 1;

function read_root(tree: { version: number; root: unknown }): TreeBranch {
    if (tree.version !== COMPILED_KEYMAP_VERSION) throw new Error(`keymap version ${String(tree.version)} is not ${COMPILED_KEYMAP_VERSION}`);
    const root = tree.root as Partial<TreeBranch> | null;
    if (typeof root !== "object" || root === null || root.kind !== "branch" || typeof root.children !== "object" || root.children === null) {
        throw new Error("keymap root is not a branch");
    }
    return root as TreeBranch;
}

// The matcher reads only `modes`, so the rest of a compiled keymap is never built here.
const keymap_of = (root: TreeBranch): CompiledKeymap => ({ format_version: COMPILED_KEYMAP_VERSION, modes: { [NORMAL_MODE]: root } }) as CompiledKeymap;

export function create_runtime<Window extends KeyTarget>(deps: RuntimeDeps<Window>): Runtime {
    // The cancel state lives in the matcher (a half-typed sequence) and in this map. Shutdown drops both.
    const hooked = new Map<Window, (event: KeydownEvent) => void>();
    let matcher: ReturnType<typeof create_matcher> | null = null;
    let listening = false;

    function run_leaf(leaf: TreeLeaf, port: ViewPort, window: Window, count: number | undefined): void {
        for (const step of leaf.steps) {
            const step_count = count ?? step.invocation.count;
            if (step.runs_in === "chrome") {
                run_motion(step.invocation.id, port, step_count);
            } else if (step.runs_in === "background") {
                deps.emit({ command: step.invocation.id, args: step.invocation.args ?? {}, count: step_count ?? 1, windowId: deps.window_id_of(window) });
            }
        }
    }

    function on_keydown(window: Window, event: KeydownEvent): void {
        if (!matcher || event.ctrlKey || event.altKey || event.metaKey || deps.is_typing_target(window, event)) return;
        const port = deps.view_port_of(window);
        const token = event_to_token(event);
        if (!port || token === null) return;
        const result = matcher.feed(NORMAL_MODE, token);
        if (result.kind_ === "no_match" && !is_plain_printable(token)) return;
        // Thunderbird binds single keys such as `j` and `a`, so the key stops here whether or not it matched.
        event.preventDefault();
        event.stopPropagation();
        if (result.kind_ === "match") run_leaf(result.leaf, port, window, result.count);
    }

    function hook(window: Window): void {
        if (hooked.has(window)) return;
        const handler = (event: KeydownEvent) => on_keydown(window, event);
        hooked.set(window, handler);
        window.addEventListener("keydown", handler, true);
    }

    function unhook(window: Window): void {
        const handler = hooked.get(window);
        if (!handler) return;
        window.removeEventListener("keydown", handler, true);
        hooked.delete(window);
    }

    return {
        install(tree) {
            const keymap = keymap_of(read_root(tree));
            matcher = create_matcher(keymap);
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
        },
    };
}
