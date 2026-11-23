import { needing } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// Motions run in the chrome runtime from its fixed motion table, so they carry no handler here. `repeat.last`, `visual.toggle`, `select.toggle` and `pane.resize_mode` are handled in the runtime itself, because they read what the runtime last ran and the mode it holds.
export const motion: CommandGroup = {
    commands: needing("list", {
        "motion.down": { runs_in: "chrome", bridge: true, label: "Move down", intent: "Select the next row in the message list.", count: "repeat" },
        "motion.up": { runs_in: "chrome", bridge: true, label: "Move up", intent: "Select the previous row in the message list.", count: "repeat" },
        "motion.top": { runs_in: "chrome", bridge: true, label: "Go to first row", intent: "Select the first row in the message list." },
        "repeat.last": { runs_in: "chrome", bridge: true, label: "Repeat", intent: "Run the last motion or command again. A count replaces the count it ran with. A move to a typed folder, a snooze and an undo are never repeated.", count: "repeat" },
        "visual.toggle": { runs_in: "chrome", bridge: true, label: "Select a range of rows", intent: "Start or end visual mode. While it is on, a motion selects the range from the row where it started and keeps the rows that were selected before. A command such as archive or delete acts on the selection and ends the mode. Escape also ends it. Ending the mode keeps the selection." },
        "select.toggle": { runs_in: "chrome", bridge: false, repeatable: false, label: "Select or unselect the row", intent: "Add the current row to the selection or take it out. The cursor stays on it, and a closed thread goes in or out whole. The first Space on the one selected row keeps it and starts a pick. In a pick, or with two or more rows selected, `j`, `k`, `g g` and `G` move only the cursor. Escape ends the pick and drops the selection to the current row." },
        "pane.resize_mode": { runs_in: "chrome", bridge: false, label: "Resize panes", intent: "Start the resize mode. In it, `h`, `l`, `j` and `k` move the border of the focused pane left, right, down and up, a count multiplies the step, `=` resets the sizes, and Escape or Enter ends the mode." },
        "motion.bottom": { runs_in: "chrome", bridge: true, label: "Go to last row", intent: "Select the last row in the message list." },
    }),
    normal_keys: {
        j: { id: "motion.down" },
        k: { id: "motion.up" },
        gg: { id: "motion.top", label: "First row" },
        G: { id: "motion.bottom" },
        ".": { id: "repeat.last" },
        v: { id: "visual.toggle", label: "Select range" },
        "<Space>": { id: "select.toggle", label: "Toggle row" },
        wr: { id: "pane.resize_mode", label: "Resize mode" },
    },
};
