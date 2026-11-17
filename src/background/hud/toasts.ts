// The toasts of one window: a short stack of messages, each gone after its own time.

import type { ToastView } from "../../shared/protocol.ts";

export interface Timers {
    set(run: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

/** More toasts than this push the oldest out, so a burst of refusals never covers the window. */
export const MAX_TOASTS = 4;

export interface Toasts {
    /** Returns the id of the toast. */
    show(text: string, is_error: boolean, ms: number): number;
    /** Removes a toast before its time. Does nothing for an id that is gone. */
    dismiss(id: number): void;
    list(): ToastView[];
    /** Drops every toast and its timer. */
    clear(): void;
}

export function create_toasts(timers: Timers, on_change: () => void): Toasts {
    let next_id = 1;
    const shown: (ToastView & { timer: unknown })[] = [];

    function remove(id: number): void {
        const at = shown.findIndex((toast) => toast.id === id);
        if (at < 0) return;
        timers.clear(shown[at]?.timer);
        shown.splice(at, 1);
        on_change();
    }

    return {
        show(text, is_error, ms) {
            const id = next_id++;
            shown.push({ id, text, is_error, timer: timers.set(() => remove(id), ms) });
            while (shown.length > MAX_TOASTS) remove(shown[0]!.id);
            on_change();
            return id;
        },
        dismiss: remove,
        list: () => shown.map(({ id, text, is_error }) => ({ id, text, is_error })),
        clear() {
            for (const toast of shown.splice(0)) timers.clear(toast.timer);
            on_change();
        },
    };
}
