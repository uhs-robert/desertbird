import { open_cmdline } from "../handlers/cmdline.ts";
import type { CmdlineApi } from "../handlers/cmdline.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `:` opens an empty line. The other keys open it with the start of a command typed in, for the commands that take a value the key cannot give. The text goes through the same parser as typed text.
export const cmdline: CommandGroup = {
    commands: {
        "cmdline.open": {
            bridge: false,
            // A `.` that reopened the line would only startle. The line has its own history.
            repeatable: false,
            runs_in: "background",
            label: "Command line",
            intent: "Open the command line, with text already typed in if given.",
            // Typing the command to open the line is circular, so the list leaves it out.
            completion: "hidden",
            needs: ["overlay.mount"],
            params: [{ name: "text", type: "string", main: true, rest: true, optional: true, description: "Start the line with this text." }],
            run: scoped<CmdlineApi>(open_cmdline),
        },
    },
    normal_keys: {
        ":": { id: "cmdline.open" },
        mt: { id: "cmdline.open", args: { text: "tag " } },
        mm: { id: "cmdline.open", args: { text: "move " } },
        Ft: { id: "cmdline.open", args: { text: "filter --tag --tag=" } },
        T: { id: "cmdline.open", args: { text: "tab " } },
        "/": { id: "cmdline.open", args: { text: "search " } },
    },
};
