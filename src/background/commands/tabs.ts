import { alternate_tab, close_tab, goto_tab, move_tab, next_tab, previous_tab, switch_tab } from "../handlers/tabs.ts";
import type { TabsApi } from "../handlers/tabs.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// These keys work in every tab (`J`, `K`, `<A-j>`, `<A-k>` and the `t` group). In a message window there is no other tab, so `tab.next` and `tab.prev` refuse there.
export const tabs: CommandGroup = {
    commands: needing("tab", {
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
        "tab.goto": {
            bridge: true,
            runs_in: "background",
            label: "Go to tab",
            intent: "Switch to the tab at a place: 1 is first, -1 is last.",
            params: [{ name: "index", type: "int", description: "Place from 1, or from the end if negative." }],
            run: scoped<TabsApi>(goto_tab),
        },
        "tab.alternate": { bridge: true, runs_in: "background", label: "Last used tab", intent: "Switch to the last used tab. A message window has no other tab, so it refuses there.", run: scoped<TabsApi>(alternate_tab) },
        "tab.move": {
            bridge: false,
            runs_in: "background",
            label: "Move tab",
            intent: "Move the tab. Name a place number (1 is first, -1 last) or a tab, whose place it takes. --offset moves it along the bar, positive later and negative earlier. With both, the place wins. The first tab is the mail tab and stays first.",
            params: [
                { name: "tab", type: "string", main: true, rest: true, optional: true, values: { from: "tabs" }, description: "Take this place number, or the place of this tab." },
                { name: "offset", type: "int", short: "o", default: 0, description: "Move this many places, positive later and negative earlier." },
            ],
            run: scoped<TabsApi>(move_tab),
        },
        "tab.close": { bridge: false, runs_in: "background", label: "Close tab", intent: "Close the current tab, or the message window. On the main mail tab it moves the focus to the thread list.", needs: ["app.paneFocus"], run: scoped<TabsApi>(close_tab) },
        // A second id for the chords that copy, cut and go back elsewhere. The chrome runs only `PAGE_COMMANDS` ids in other tabs, so these chords close a tab from the mail tab alone.
        "tab.close_mail": { bridge: false, runs_in: "background", label: "Close tab (mail tab keys)", intent: "Close the current tab or message window. Its default keys are chords that run in the mail tab only, so copy and cut still work in message and web page tabs.", needs: ["list", "app.paneFocus"], run: scoped<TabsApi>(close_tab) },
    }),
    normal_keys: {
        J: { id: "tab.next", label: "Next tab" },
        K: { id: "tab.prev", label: "Previous tab" },
        "<A-j>": { id: "tab.next", label: "Next tab" },
        "<A-k>": { id: "tab.prev", label: "Previous tab" },
        tn: { id: "tab.next", label: "Next tab" },
        tp: { id: "tab.prev", label: "Previous tab" },
        t0: { id: "tab.switch", args: { tab: "1" }, label: "First tab" },
        "t$": { id: "tab.goto", args: { index: -1 }, label: "Last tab" },
        tl: { id: "tab.alternate", label: "Last used tab" },
        q: { id: "tab.close", label: "Close tab" },
        "<C-x>": { id: "tab.close_mail", label: "Close tab" },
        "<C-c>": { id: "tab.close_mail", label: "Close tab" },
        "<A-q>": { id: "tab.close", label: "Close tab" },
    },
};
