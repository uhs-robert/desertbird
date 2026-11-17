import { open_help } from "../handlers/help.ts";
import type { HelpApi } from "../handlers/help.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

export const help: CommandGroup = {
    commands: {
        "help.open": { bridge: false, runs_in: "background", label: "Help", intent: "Open the help page: every command with its keys and usage.", run: scoped<HelpApi>(open_help) },
    },
    normal_keys: { "?": { id: "help.open" } },
    message_keys: { "?": { id: "help.open" } },
};
