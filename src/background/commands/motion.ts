import { needing } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// Motions run in the chrome runtime from its fixed motion table, so they carry no handler here. `repeat.last` and `visual.toggle` are handled in the runtime itself, because they read what the runtime last ran and the mode it holds.
export const motion: CommandGroup = {
    commands: needing("list", {
        "motion.down": { runs_in: "chrome", bridge: true, label: "Move down", intent: "Select the next row in the message list.", count: "repeat" },
        "motion.up": { runs_in: "chrome", bridge: true, label: "Move up", intent: "Select the previous row in the message list.", count: "repeat" },
        "motion.top": { runs_in: "chrome", bridge: true, label: "Go to first row", intent: "Select the first row in the message list." },
        "repeat.last": { runs_in: "chrome", bridge: true, label: "Repeat", intent: "Run the last motion or command again. A count replaces the count it ran with. A move to a typed folder, a snooze and an undo are never repeated.", count: "repeat" },
        "visual.toggle": { runs_in: "chrome", bridge: true, label: "Select a range of rows", intent: "Start or end visual mode. While it is on, a motion extends the selection from the row where it started, and a command such as archive or delete acts on the range and ends the mode. Escape also ends it." },
        "motion.bottom": { runs_in: "chrome", bridge: true, label: "Go to last row", intent: "Select the last row in the message list." },
    }),
    normal_keys: {
        j: { id: "motion.down" },
        k: { id: "motion.up" },
        gg: { id: "motion.top", label: "First row" },
        G: { id: "motion.bottom" },
        ".": { id: "repeat.last" },
        v: { id: "visual.toggle", label: "Select range" },
    },
};
