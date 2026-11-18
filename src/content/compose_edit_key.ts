// The keys of a compose body: Ctrl+E, and the modes with their `e`. It holds no browser global: `start_compose_keys` takes the window, the runtime and the label as arguments, so node tests drive it with stubs.

import { SETTINGS_STORAGE_KEY } from "../shared/protocol.ts";
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

export interface ComposeStorage {
    get(key: string): Promise<Record<string, unknown>>;
    onChanged: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
}

export interface ComposeRuntime {
    sendMessage(message: ComposeEditRequest): Promise<unknown>;
}

// Caps Lock turns the key into a capital with no Shift, so the case is folded and Shift is checked on its own.
const is_plain_chord = (event: ComposeKeyEvent, key: string, ctrl: boolean): boolean =>
    event.ctrlKey === ctrl && !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === key;

// A modifier or lock key alone is not a key of the one-shot: Ctrl+O, then Shift, then `e` still edits.
// A record that is absent or of another shape leaves the gate shut, as the setting's default does.
const gate_is_open = (settings: unknown): boolean => (settings as { external_editor?: unknown } | null | undefined)?.external_editor === true;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "OS"]);

/**
 * Insert mode holds while the body has focus: every key passes to the editor except Ctrl+E and Ctrl+O. Ctrl+O and Escape make the next key a normal-mode key. In that key `e` asks the background to edit this message, and any other key passes unchanged and ends the one-shot. Focus leaving the body hides the label and drops a pending one-shot. A key typed outside the body never reaches this script.
 * While the `external_editor` setting is off, modes do nothing: no label, no one-shot, and `e` is a letter. Ctrl+E still asks, and the background says the setting is off. The setting is read from storage and followed through `storage.onChanged`.
 */
export async function start_compose_keys(window: ComposeWindow, runtime: ComposeRuntime, show_label: (state: LabelState) => void, has_focus: boolean, storage: ComposeStorage): Promise<void> {
    let mode: ComposeMode = "insert";
    let focused = has_focus;
    let enabled = false;
    // A held `e` or Ctrl+O repeats after the first press took it. The repeats must not reach the body or spend the one-shot.
    let swallow_repeat = false;
    const show_mode = (): void => show_label(enabled && focused ? mode : "hidden");
    const set_mode = (next: ComposeMode): void => void ((mode = next), show_mode());
    const set_gate = (settings: unknown): void => {
        enabled = gate_is_open(settings);
        mode = "insert";
        show_mode();
    };

    const ask_to_edit = (event: ComposeKeyEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        // A held chord repeats. Only the first press asks, so a hold does not stack refusals.
        if (event.repeat) return;
        runtime.sendMessage({ type: "compose.edit" }).catch((error: unknown) => console.error("desertbird compose keys:", error));
    };

    window.addEventListener("focus", () => void ((focused = true), set_mode("insert")), false);
    window.addEventListener("blur", () => void ((focused = false), set_mode("insert")), false);
    window.addEventListener(
        "keydown",
        (event) => {
            if (event.isComposing) return;
            if (swallow_repeat && event.repeat) return void (event.preventDefault(), event.stopPropagation());
            swallow_repeat = false;
            if (is_plain_chord(event, "e", true)) {
                if (mode === "normal") set_mode("insert");
                return ask_to_edit(event);
            }
            if (!enabled) return;
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
    storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[SETTINGS_STORAGE_KEY]) set_gate(changes[SETTINGS_STORAGE_KEY].newValue);
    });
    set_gate((await storage.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY]);
}
