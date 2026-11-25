// Ctrl+E in a compose body. It holds no browser global: `start_compose_keys` takes the window and the runtime as arguments, so node tests drive it with stubs. The modes and every other key of the compose window belong to the chrome runtime (`../chrome/compose_runtime.ts`), which passes chords, so Ctrl+E reaches this script in either mode.

import type { ComposeEditRequest } from "../shared/protocol.ts";

export interface ComposeKeyEvent {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
    isTrusted: boolean;
    isComposing?: boolean;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface ComposeWindow {
    addEventListener(type: "keydown", listener: (event: ComposeKeyEvent) => void, capture: boolean): void;
}

export interface ComposeRuntime {
    sendMessage(message: ComposeEditRequest): Promise<unknown>;
}

// Caps Lock turns the key into a capital with no Shift, so the case is folded and Shift is checked on its own.
const is_ctrl_e = (event: ComposeKeyEvent): boolean => event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "e";

/** Ctrl+E is taken and asks the background to edit the message in the external editor. Every other key passes. */
export function start_compose_keys(window: ComposeWindow, runtime: ComposeRuntime): void {
    window.addEventListener(
        "keydown",
        (event) => {
            if (!event.isTrusted || event.isComposing || !is_ctrl_e(event)) return;
            event.preventDefault();
            event.stopPropagation();
            // A held chord repeats. Only the first press asks, so a hold does not stack refusals.
            if (!event.repeat) runtime.sendMessage({ type: "compose.edit" }).catch((error: unknown) => console.error("desertbird compose keys:", error));
        },
        true,
    );
}
