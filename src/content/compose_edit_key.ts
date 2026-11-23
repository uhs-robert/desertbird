// The keys of a compose body: Ctrl+E, and the two modes. It holds no browser global: `start_compose_keys` takes the window, the runtime and the label as arguments, so node tests drive it with stubs.

import { KEYMAP_STORAGE_KEY } from "../shared/protocol.ts";
import type { BodyInvokeRequest, ComposeEditRequest, JsonValue } from "../shared/protocol.ts";
import type { ComposeMode, LabelState } from "./compose_mode_label.ts";

export interface ComposeKeyEvent {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
    isComposing: boolean;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface ComposeWindow {
    addEventListener(type: "keydown", listener: (event: ComposeKeyEvent) => void, capture: boolean): void;
    addEventListener(type: "focus" | "blur", listener: () => void, capture: boolean): void;
}

export interface ComposeStorage {
    get(key: string): Promise<Record<string, unknown>>;
    onChanged: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
}

export interface ComposeRuntime {
    sendMessage(message: ComposeEditRequest | BodyInvokeRequest): Promise<unknown>;
}

interface TreeNode {
    children?: Record<string, TreeNode>;
    steps?: { invocation: { id: string; args?: Record<string, JsonValue> }; runs_in?: string }[];
}

// Caps Lock turns the key into a capital with no Shift, so the case is folded and Shift is checked on its own.
const is_ctrl_e = (event: ComposeKeyEvent): boolean => event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "e";

// What would change the draft. Tab inserts a tab in a plain-text body (measured), so it is held back too, and Shift+Tab with it. F6, the arrows and the other function keys stay free, so the caret and the focus still move in normal mode.
const EDITING_KEYS = new Set(["Enter", "Backspace", "Delete", "Tab"]);

// The compose tree is a branch of branches and leaves. A record that is absent or of another shape gives no keys, and normal mode then only holds the typing back.
const compose_root_of = (record: unknown): TreeNode | undefined => (record as { compose_tree?: { root?: TreeNode } } | null | undefined)?.compose_tree?.root ?? undefined;

/**
 * Insert mode holds while the body has focus: every key passes to the editor except Escape and Ctrl+E. Escape makes it normal mode, and `i` makes it insert again.
 * In normal mode a character key and Enter, Backspace, Delete and Tab never reach the draft, bound or not. A bound key (or a sequence of them) asks the background to run its command through `body.invoke`. Chords with Ctrl, Alt or Meta pass untouched, so Ctrl+Enter and Ctrl+S stay Thunderbird's. A key of an IME composition is never touched.
 * Every window opens in insert mode. The mode then stays across focus and blur, which only hide and show the label, because Thunderbird moves the focus on a save and the script cannot tell that from the user. The keys come from the `compose_tree` of the keymap record in storage. Ctrl+E asks the background to edit through its own request, so it works before the tree is in.
 */
export async function start_compose_keys(window: ComposeWindow, runtime: ComposeRuntime, show_label: (state: LabelState) => void, has_focus: boolean, storage: ComposeStorage): Promise<void> {
    let mode: ComposeMode = "insert";
    let focused = has_focus;
    let root: TreeNode | undefined;
    let pending: TreeNode | undefined;
    const log_error = (error: unknown): void => console.error("desertbird compose keys:", error);
    const set_mode = (next: ComposeMode): void => {
        mode = next;
        pending = undefined;
        show_label(focused ? mode : "hidden");
    };
    const take = (event: ComposeKeyEvent): void => void (event.preventDefault(), event.stopPropagation());
    const run_leaf = (leaf: TreeNode): void => {
        for (const step of leaf.steps ?? []) if (step.runs_in === "background") runtime.sendMessage({ type: "body.invoke", command: step.invocation.id, args: step.invocation.args ?? {}, count: 1 }).catch(log_error);
    };

    const set_focus = (now: boolean): void => {
        focused = now;
        pending = undefined;
        show_label(focused ? mode : "hidden");
    };
    window.addEventListener("focus", () => set_focus(true), false);
    window.addEventListener("blur", () => set_focus(false), false);
    window.addEventListener(
        "keydown",
        (event) => {
            if (event.isComposing) return;
            if (is_ctrl_e(event)) {
                take(event);
                // A held chord repeats. Only the first press asks, so a hold does not stack refusals.
                if (!event.repeat) runtime.sendMessage({ type: "compose.edit" }).catch(log_error);
                return;
            }
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            if (mode === "insert") {
                if (event.key === "Escape") (take(event), set_mode("normal"));
                return;
            }
            if (event.key === "Escape") return void (take(event), (pending = undefined));
            if ([...event.key].length !== 1 && !EDITING_KEYS.has(event.key)) return;
            take(event);
            if (event.repeat) return;
            if (event.key === "i" && !pending) return set_mode("insert");
            const next = (pending ?? root)?.children?.[event.key];
            pending = next?.children ? next : undefined;
            if (next?.steps) run_leaf(next);
        },
        true,
    );
    storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[KEYMAP_STORAGE_KEY]) void ((root = compose_root_of(changes[KEYMAP_STORAGE_KEY].newValue)), (pending = undefined));
    });
    show_label(focused ? mode : "hidden");
    root = compose_root_of((await storage.get(KEYMAP_STORAGE_KEY))[KEYMAP_STORAGE_KEY]);
}
