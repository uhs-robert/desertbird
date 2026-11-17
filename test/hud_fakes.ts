// Fakes the hud tests share: timers that move only when a test advances them, and a settings source that a test changes.

import { DEFAULT_SETTINGS } from "../vendor/desertfox/config.ts";
import type { Settings } from "../vendor/desertfox/config.ts";
import type { TreeBranch, TreeLeaf } from "../vendor/desertfox/prefix_tree.ts";
import type { Timers } from "../src/background/hud/toasts.ts";

export function fake_timers(): Timers & { advance(ms: number): void; pending(): number } {
    let now = 0;
    let next = 1;
    const timers = new Map<number, { at: number; run: () => void }>();
    return {
        set(run, ms) {
            const id = next++;
            timers.set(id, { at: now + ms, run });
            return id;
        },
        clear: (handle) => void timers.delete(handle as number),
        pending: () => timers.size,
        advance(ms) {
            const end = now + ms;
            for (;;) {
                const due = [...timers].filter(([, timer]) => timer.at <= end).sort((left, right) => left[1].at - right[1].at)[0];
                if (due === undefined) break;
                now = due[1].at;
                timers.delete(due[0]);
                due[1].run();
            }
            now = end;
        },
    };
}

export const settings_with = (overrides: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

const leaf = (id: string, label: string): TreeLeaf => ({ kind: "leaf", label, steps: [{ invocation: { id }, runs_in: "background", count_rule: "repeat" }] });

/** `g` holds `g` (first row) and a group `u` with two keys. `d` holds `d`. `j` is a leaf. */
export const sample_root = (): TreeBranch => ({
    kind: "branch",
    children: {
        j: leaf("motion.down", "Down"),
        g: { kind: "branch", label: "Go", children: { g: leaf("motion.top", "First row"), u: { kind: "branch", children: { a: leaf("a.a", "A"), b: leaf("a.b", "B") } } } },
        d: { kind: "branch", children: { d: leaf("msg.delete", "Delete") } },
    },
});

/** Lets the promises of a started call settle. The service awaits a few reads before it acts. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
