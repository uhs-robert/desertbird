import { pick_in_window } from "../handlers/hint_window.ts";
import type { HintWindowApi } from "../handlers/hint_window.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `f` in a message document is `hint.pick` of the reading group, which labels the links of the message. This one labels the mail window itself: folders, messages, buttons, tabs and the quick filter. The Experiment holds the keys while the labels show, so the key runtime never sees a hint letter. A pick selects a row and acts on nothing else, so `bridge` is false.
export const hints: CommandGroup = {
    commands: {
        "hint.window": {
            bridge: false,
            runs_in: "background",
            label: "Pick a target in the window",
            intent: "Label what is on screen, then act on the typed label.",
            needs: ["hints.pick"],
            count: "ignore",
            run: scoped<HintWindowApi>(pick_in_window),
        },
    },
    normal_keys: {
        f: { id: "hint.window" },
    },
};
