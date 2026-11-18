// Ctrl+E in a compose body. It holds no browser global: `start_compose_keys` takes the window and the runtime as arguments, so node tests drive it with stubs.

import type { ComposeEditRequest } from "../shared/protocol.ts";

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
}

export interface ComposeRuntime {
    sendMessage(message: ComposeEditRequest): Promise<unknown>;
}

// Caps Lock turns the key into "E" with no Shift, so the case is folded and Shift is checked on its own.
const is_edit_chord = (event: ComposeKeyEvent): boolean => event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === "e";

/** Takes Ctrl+E and asks the background to edit this message. Every other key passes to the editor. The setting is checked in the background, which says so when it is off. */
export function start_compose_keys(window: ComposeWindow, runtime: ComposeRuntime): void {
    window.addEventListener(
        "keydown",
        (event) => {
            if (!is_edit_chord(event)) return;
            event.preventDefault();
            event.stopPropagation();
            // A held chord repeats. Only the first press asks, so a hold does not stack refusals.
            if (event.repeat) return;
            runtime.sendMessage({ type: "compose.edit" }).catch((error: unknown) => console.error("desertbird compose keys:", error));
        },
        true,
    );
}
