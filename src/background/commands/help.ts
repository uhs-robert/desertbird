import { open_help, show_root_keys } from "../handlers/help.ts";
import type { HelpApi, WhichKeyApi } from "../handlers/help.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const help: CommandGroup = {
    commands: {
        "help.open": { bridge: false, runs_in: "background", label: "Help", intent: "Open the help page: every command with its keys and usage.", run: scoped<HelpApi>(open_help) },
        // Hidden from completion: typed on the line it leaves a panel that no key ends, since only the key press arms the report.
        "help.whichkey": { bridge: false, runs_in: "background", completion: "hidden", label: "Key list", intent: "Show the top-level keys in a panel in the window.", run: scoped<WhichKeyApi>(show_root_keys) },
    },
    normal_keys: { "g?": { id: "help.whichkey" } },
    // A message document does not report typed keys, so nothing there could close the panel. The key opens the help page instead.
    message_keys: { "g?": { id: "help.open" } },
};
