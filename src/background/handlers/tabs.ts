import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";

/** A tab as `tabs.query` returns it. Only the members the handlers read are listed. */
export interface TabInfo {
    id?: number;
    index: number;
    active: boolean;
    title?: string;
}

export interface TabsApi {
    tabs: {
        query(query: { windowId: number } | { currentWindow: true }): Promise<TabInfo[]>;
        update(tab_id: number, properties: { active: true }): Promise<unknown>;
        remove(tab_id: number): Promise<void>;
    };
}

export interface TabsScope {
    api: TabsApi;
    /** The window of the key press. It is -1 when the Experiment could not name the window. */
    window_id: number;
}

// The tab list comes back in tab-bar order. The sort keeps the wrap-around right if an implementation ever returns another order.
async function tabs_of_window(scope: TabsScope): Promise<TabInfo[]> {
    const tabs = await scope.api.tabs.query(scope.window_id >= 0 ? { windowId: scope.window_id } : { currentWindow: true });
    return [...tabs].sort((left, right) => left.index - right.index);
}

async function activate(scope: TabsScope, tab: TabInfo): Promise<void> {
    if (tab.id === undefined) throw new RuntimeRefusal("That tab cannot be selected.");
    await scope.api.tabs.update(tab.id, { active: true });
}

async function step_active(scope: TabsScope, direction: 1 | -1): Promise<void> {
    const tabs = await tabs_of_window(scope);
    const at = tabs.findIndex((tab) => tab.active);
    if (at < 0) throw new RuntimeRefusal("No tab is active.");
    if (tabs.length === 1) throw new RuntimeRefusal("There is no other tab.");
    await activate(scope, tabs[(at + direction + tabs.length) % tabs.length]!);
}

/** Wraps from the last tab to the first. */
export const next_tab = (scope: TabsScope): Promise<void> => step_active(scope, 1);

/** Wraps from the first tab to the last. */
export const previous_tab = (scope: TabsScope): Promise<void> => step_active(scope, -1);

const TAB_NUMBER = /^\d+$/;

/** `tab` is a place in the tab bar counted from 1, or part of a tab title. */
export async function switch_tab(scope: TabsScope, args: CheckedArgs): Promise<void> {
    const wanted = String(args["tab"]).trim();
    const tabs = await tabs_of_window(scope);
    const picked = TAB_NUMBER.test(wanted) ? tabs[Number(wanted) - 1] : tabs.find((tab) => (tab.title ?? "").toLowerCase().includes(wanted.toLowerCase()));
    if (picked === undefined) throw new RuntimeRefusal(`No tab matches "${wanted}".`);
    await activate(scope, picked);
}

// `tabs.remove` on the first tab does nothing and reports no error, also when it is the only tab (measured). So the handler refuses there instead of looking like it worked.
export async function close_tab(scope: TabsScope): Promise<void> {
    const active = (await tabs_of_window(scope)).find((tab) => tab.active);
    if (active === undefined) throw new RuntimeRefusal("No tab is active.");
    if (active.id === undefined) throw new RuntimeRefusal("The tab has no id, so it cannot be closed.");
    if (active.index === 0) throw new RuntimeRefusal("The main mail tab cannot be closed.");
    await scope.api.tabs.remove(active.id);
}
