// The keys of a compose body: Ctrl+E, and the modes with their `e`. It holds no browser global: `start_compose_keys` takes the window, the runtime and the label as arguments, so node tests drive it with stubs.

import type { ComposeEditRequest } from "../shared/protocol.ts";
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

export interface ComposeRuntime {
    sendMessage(message: ComposeEditRequest): Promise<unknown>;
}

// Caps Lock turns the key into a capital with no Shift, so the case is folded and Shift is checked on its own.
const is_plain_chord = (event: ComposeKeyEvent, key: string, ctrl: boolean): boolean =>
    event.ctrlKey === ctrl && !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === key;

// A modifier or lock key alone is not a key of the one-shot: Ctrl+O, then Shift, then `e` still edits.
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "OS"]);

/**
 * Insert mode holds while the body has focus: every key passes to the editor except Ctrl+E and Ctrl+O. Ctrl+O and Escape make the next key a normal-mode key. In that key `e` asks the background to edit this message, and any other key passes unchanged and ends the one-shot. Focus leaving the body hides the label and drops a pending one-shot. A key typed outside the body never reaches this script.
 * The setting is checked in the background, which says so when it is off.
 */
export function start_compose_keys(window: ComposeWindow, runtime: ComposeRuntime, show_mode: (state: LabelState) => void, has_focus: boolean): void {
    let mode: ComposeMode = "insert";
    // A held `e` or Ctrl+O repeats after the first press took it. The repeats must not reach the body or spend the one-shot.
    let swallow_repeat = false;
    const set_mode = (next: ComposeMode): void => void (show_mode((mode = next)));
    show_mode(has_focus ? mode : "hidden");

    const ask_to_edit = (event: ComposeKeyEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        // A held chord repeats. Only the first press asks, so a hold does not stack refusals.
        if (event.repeat) return;
        runtime.sendMessage({ type: "compose.edit" }).catch((error: unknown) => console.error("desertbird compose keys:", error));
    };

    window.addEventListener("focus", () => set_mode("insert"), false);
    window.addEventListener("blur", () => void ((mode = "insert"), show_mode("hidden")), false);
    window.addEventListener(
        "keydown",
        (event) => {
            if (event.isComposing) return;
            if (swallow_repeat && event.repeat) return void (event.preventDefault(), event.stopPropagation());
            swallow_repeat = false;
            if (is_plain_chord(event, "e", true)) return ask_to_edit(event);
            if (MODIFIER_KEYS.has(event.key)) return;
            if (mode === "normal") {
                set_mode("insert");
                if (is_plain_chord(event, "e", false)) return void ((swallow_repeat = true), ask_to_edit(event));
                return;
            }
            if (is_plain_chord(event, "o", true)) {
                event.preventDefault();
                event.stopPropagation();
                swallow_repeat = true;
                set_mode("normal");
            } else if (event.key === "Escape") set_mode("normal");
        },
        true,
    );
}
