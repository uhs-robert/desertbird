import { open_cmdline } from "../handlers/cmdline.ts";
import type { CmdlineApi } from "../handlers/cmdline.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// `:` opens an empty line. The other keys open it with the start of a command typed in, for the commands that take a value the key cannot give. The text goes through the same parser as typed text.
export const cmdline: CommandGroup = {
    commands: needing("tab", {
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
    }),
    normal_keys: {
        ":": { id: "cmdline.open", label: "Command line" },
        mt: { id: "cmdline.open", args: { text: "tag " }, label: "Tag" },
        o: { id: "cmdline.open", args: { text: "open " }, label: "Open folder" },
        mm: { id: "cmdline.open", args: { text: "move " }, label: "Move to" },
        mc: { id: "cmdline.open", args: { text: "copy " }, label: "Copy to" },
        Ff: { id: "cmdline.open", args: { text: "filter " }, label: "By text" },
        ss: { id: "cmdline.open", args: { text: "sort " }, label: "Sort by" },
        Ft: { id: "cmdline.open", args: { text: "filter --tag --tag=" }, label: "By tag" },
        T: { id: "cmdline.open", args: { text: "tab " }, label: "Switch tab" },
        ";;": { id: "cmdline.open", args: { text: "hint " }, label: "Hint command line" },
    },
};
