import { close_tab, next_tab, previous_tab, switch_tab } from "../handlers/tabs.ts";
import type { TabsApi } from "../handlers/tabs.ts";
import { scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// These keys work in the mail tab, the reading pane, a message tab and a message window. In a message window there is no other tab, so `tab.next` and `tab.prev` refuse there.
export const tabs: CommandGroup = {
    commands: {
        "tab.next": { bridge: true, runs_in: "background", label: "Next tab", count: "repeat", intent: "Switch to the next tab. It wraps from the last tab to the first.", run: scoped<TabsApi>(next_tab) },
        "tab.prev": { bridge: true, runs_in: "background", label: "Previous tab", count: "repeat", intent: "Switch to the previous tab. It wraps from the first tab to the last.", run: scoped<TabsApi>(previous_tab) },
        "tab.switch": {
            bridge: true,
            runs_in: "background",
            name: "tab",
            label: "Switch tab",
            intent: "Switch to a tab by number or title. The list shows this window's tabs.",
            params: [{ name: "tab", type: "string", main: true, rest: true, values: { from: "tabs" } }],
            run: scoped<TabsApi>(switch_tab),
        },
        "tab.close": { bridge: false, runs_in: "background", label: "Close tab", intent: "Close the current tab, or the message window. On the main mail tab it moves the focus to the thread list.", needs: ["keys.paneFocus"], run: scoped<TabsApi>(close_tab) },
    },
    normal_keys: {
        "<C-j>": { id: "tab.next" },
        "<C-k>": { id: "tab.prev" },
        q: { id: "tab.close" },
        "<C-x>": { id: "tab.close" },
        "<C-c>": { id: "tab.close" },
        "<C-h>": { id: "tab.close" },
        "<A-q>": { id: "tab.close" },
    },
};
