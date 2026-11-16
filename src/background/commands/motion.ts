import type { CommandGroup } from "./define.ts";

// Motions run in the chrome runtime from its fixed motion table, so they carry no handler here.
export const motion: CommandGroup = {
    commands: {
        "motion.down": { runs_in: "chrome", bridge: true, label: "Move down", intent: "Select the next row in the message list.", count: "repeat" },
        "motion.up": { runs_in: "chrome", bridge: true, label: "Move up", intent: "Select the previous row in the message list.", count: "repeat" },
        "motion.top": { runs_in: "chrome", bridge: true, label: "Go to first row", intent: "Select the first row in the message list." },
        "motion.bottom": { runs_in: "chrome", bridge: true, label: "Go to last row", intent: "Select the last row in the message list." },
    },
    normal_keys: {
        j: { id: "motion.down" },
        k: { id: "motion.up" },
        gg: { id: "motion.top" },
        G: { id: "motion.bottom" },
    },
};
