import { close_tab, next_tab, previous_tab, switch_tab } from "../handlers/tabs.ts";
import type { TabsApi, TabsScope } from "../handlers/tabs.ts";
import type { CheckedArgs, CommandRun } from "../../../vendor/desertfox/command.ts";
import type { CommandGroup, ScopedContext } from "./define.ts";

// The router hands every handler the whole messenger object as `api`, so `tabs` is there at run time. `MessageApi` names only the message half, hence the cast.
const with_tabs = (handler: (scope: TabsScope, args: CheckedArgs) => Promise<void>): CommandRun => (ctx, args) => {
    const { api, window_id } = ctx as ScopedContext;
    return handler({ api: api as unknown as TabsApi, window_id: window_id ?? -1 }, args);
};

// Keys run in the mail tab only, so these keys work from there and nowhere else.
export const tabs: CommandGroup = {
    commands: {
        "tab.next": { bridge: true, runs_in: "background", label: "Next tab", count: "repeat", intent: "Switch to the next tab. It wraps from the last tab to the first.", run: with_tabs(next_tab) },
        "tab.prev": { bridge: true, runs_in: "background", label: "Previous tab", count: "repeat", intent: "Switch to the previous tab. It wraps from the first tab to the last.", run: with_tabs(previous_tab) },
        "tab.switch": {
            bridge: true,
            runs_in: "background",
            label: "Switch tab",
            intent: "Switch to a tab by its number or part of its title.",
            params: [{ name: "tab", type: "string", main: true, rest: true }],
            run: with_tabs(switch_tab),
        },
        "tab.close": { bridge: false, runs_in: "background", label: "Close tab", intent: "Close the current tab. The main mail tab stays open.", run: with_tabs(close_tab) },
    },
    normal_keys: {
        "<C-j>": { id: "tab.next" },
        "<C-k>": { id: "tab.prev" },
        q: { id: "tab.close" },
    },
};
