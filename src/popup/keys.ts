// The key table of the toolbar popup. No DOM, so a unit test can read it.

import type { PopupRunRequest } from "../shared/protocol.ts";

export type PopupCommand = PopupRunRequest["command"];

// The letter is the first letter of the label, so a new entry takes the next free letter.
export const POPUP_KEYS: readonly { key: string; command: PopupCommand }[] = [
    { key: "o", command: "options.open" },
    { key: "h", command: "help.open" },
];

export type PopupKeyAction = { kind: "press"; command: PopupCommand } | { kind: "move"; step: 1 | -1 } | { kind: "none" };

const MOVE_STEPS: Readonly<Record<string, 1 | -1>> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };

export function action_for_key(event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }): PopupKeyAction {
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return { kind: "none" };
    const step = MOVE_STEPS[event.key];
    if (step !== undefined) return { kind: "move", step };
    const entry = POPUP_KEYS.find((candidate) => candidate.key === event.key);
    return entry ? { kind: "press", command: entry.command } : { kind: "none" };
}

// Moving stops at the first and last item, as j and k do in a list.
export function next_index(current: number, step: 1 | -1, count: number): number {
    return Math.min(count - 1, Math.max(0, current + step));
}
