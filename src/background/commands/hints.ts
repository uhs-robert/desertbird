import { pick_in_window } from "../handlers/hint_window.ts";
import type { HintWindowApi } from "../handlers/hint_window.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `f` in a message document is `hint.pick` of the reading group, which labels the links of the message. This one labels the mail window itself: folders, messages, buttons, tabs and the quick filter. The Experiment holds the keys while the labels show, so the key runtime never sees a hint letter. `; f` focuses, `; c` activates like `f` and `; y` yanks, so `;` is a prefix and which-key lists the three. Typed as `hint` on the command line, which `; ;` opens with the word in place. `.` never replays it: the pick would replace the action `.` should repeat. A pick selects a row and acts on nothing else, so `bridge` is false.
export const hints: CommandGroup = {
    commands: {
        "hint.window": {
            bridge: false,
            repeatable: false,
            runs_in: "background",
            name: "hint",
            label: "Pick a target in the window",
            intent: "Label what is on screen, then act on the typed label.",
            needs: ["hints.pick"],
            count: "ignore",
            params: [{ name: "action", type: "enum", values: ["activate", "focus", "yank"], default: "activate", short: { focus: "f", yank: "y" }, description: { focus: "Focus the target.", yank: "Copy the address of the target, else its text." } }],
            run: scoped<HintWindowApi>(pick_in_window),
        },
    },
    normal_keys: {
        f: { id: "hint.window", label: "Pick a target" },
        ";f": { id: "hint.window", args: { action: "focus" }, label: "Focus target" },
        ";c": { id: "hint.window", args: { action: "activate" }, label: "Click target" },
        ";y": { id: "hint.window", args: { action: "yank" }, label: "Copy target" },
    },
};
