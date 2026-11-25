import { open_help, open_options, show_root_keys } from "../handlers/help.ts";
import type { HelpApi, OptionsApi, WhichKeyApi } from "../handlers/help.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const help: CommandGroup = {
    commands: needing("tab", {
        "help.open": { bridge: false, runs_in: "background", needs: ["main"], name: "help", label: "Help", intent: "Open the help page: every command with its keys and usage.", run: scoped<HelpApi>(open_help) },
        "options.open": { bridge: false, runs_in: "background", needs: ["main"], name: "options", label: "Options", intent: "Open the DesertBird options page.", run: scoped<OptionsApi>(open_options) },
        // Hidden from completion: typed on the line it leaves a panel that no key ends, since only the key press arms the report.
        "help.whichkey": { bridge: false, runs_in: "background", completion: "hidden", label: "Key list", intent: "Show the top-level keys in a panel in the window.", run: scoped<WhichKeyApi>(show_root_keys) },
    }),
    normal_keys: {
        "g?": { id: "help.open", label: "Help" },
        ",h": { id: "help.open", label: "Help" },
        ",s": { id: "options.open", label: "Options" },
        ",?": { id: "help.whichkey", label: "Show keys" },
        "<A-?>": { id: "help.whichkey", label: "Show keys" },
    },
    // A message document does not report typed keys, so nothing there could close the panel. The which-key keys open the help page instead.
    message_keys: {
        ",h": { id: "help.open", label: "Help" },
        ",s": { id: "options.open", label: "Options" },
        ",?": { id: "help.open", label: "Open help" },
        "<A-?>": { id: "help.open", label: "Open help" },
    },
};
