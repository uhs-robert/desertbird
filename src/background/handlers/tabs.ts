import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { KeysApi } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";

type TabsScope = HandlerScope<TabsApi>;

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
    windows: {
        get(window_id: number): Promise<{ type?: string }>;
        remove(window_id: number): Promise<void>;
    };
    keys: KeysApi;
}

// The tab list comes back in tab-bar order. The sort keeps the wrap-around right if an implementation ever returns another order.
async function sorted_tabs(api: { tabs: Pick<TabsApi["tabs"], "query"> }, window_id: number): Promise<TabInfo[]> {
    const tabs = await api.tabs.query(window_id >= 0 ? { windowId: window_id } : { currentWindow: true });
    return [...tabs].sort((left, right) => left.index - right.index);
}

const tabs_of_window = (scope: TabsScope): Promise<TabInfo[]> => sorted_tabs(scope.api, scope.window_id);

async function activate(scope: TabsScope, tab: TabInfo): Promise<void> {
    if (tab.id === undefined) throw new RuntimeRefusal("That tab cannot be selected.");
    await scope.api.tabs.update(tab.id, { active: true });
}

async function step_active(scope: TabsScope, direction: 1 | -1): Promise<void> {
    const tabs = await tabs_of_window(scope);
    const at = tabs.findIndex((tab) => tab.active);
    if (at < 0) throw new RuntimeRefusal("No tab is active.");
    if (tabs.length === 1) throw new RuntimeRefusal("There is no other tab.");
    // One update to the final tab, so a count never switches through the tabs in between. The extra modulo keeps a negative step positive.
    await activate(scope, tabs[(((at + direction * scope.count) % tabs.length) + tabs.length) % tabs.length]!);
}

/** Wraps from the last tab to the first. */
export const next_tab = (scope: TabsScope): Promise<void> => step_active(scope, 1);

/** Wraps from the first tab to the last. */
export const previous_tab = (scope: TabsScope): Promise<void> => step_active(scope, -1);

/** One row of the tab list: the place in the tab bar counted from 1, the title and whether the tab is the front one. */
export interface TabChoice {
    number: number;
    title: string;
    is_active: boolean;
}

export async function tab_choices(api: { tabs: Pick<TabsApi["tabs"], "query"> }, window_id: number): Promise<TabChoice[]> {
    return (await sorted_tabs(api, window_id)).map((tab, at) => ({ number: at + 1, title: tab.title ?? "", is_active: tab.active }));
}

const TAB_NUMBER = /^\d+$/;

/** `tab` is a place in the tab bar counted from 1, or a tab title: a whole title first, else part of one. */
export async function switch_tab(scope: TabsScope, args: CheckedArgs): Promise<void> {
    const wanted = String(args["tab"]).trim();
    const tabs = await tabs_of_window(scope);
    const lowered = wanted.toLowerCase();
    const titled = (tab: TabInfo) => (tab.title ?? "").toLowerCase();
    // A whole title wins over a title that merely contains it ("Budget" before "Re: Budget").
    const picked = TAB_NUMBER.test(wanted) ? tabs[Number(wanted) - 1] : (tabs.find((tab) => titled(tab) === lowered) ?? tabs.find((tab) => titled(tab).includes(lowered)));
    if (picked === undefined) throw new RuntimeRefusal(`No tab matches "${wanted}".`);
    await activate(scope, picked);
}

// `tabs.remove` on the first tab does nothing and reports no error, also when it is the only tab (measured). So the handler does not call it there. A message window has one tab at index 0 and closes as a window. Other non-main windows (a compose window, a popup) take the tab path, so a key never discards a draft. On the main mail tab `q` has no tab to close, so it moves the focus to the thread list, which is where `q` leaves a message in the reading pane.
export async function close_tab(scope: TabsScope): Promise<void> {
    if (scope.window_id >= 0 && (await scope.api.windows.get(scope.window_id)).type === "messageDisplay") return scope.api.windows.remove(scope.window_id);
    const active = (await tabs_of_window(scope)).find((tab) => tab.active);
    if (active === undefined) throw new RuntimeRefusal("No tab is active.");
    if (active.index === 0) return void (await scope.api.keys.paneFocus({ windowId: scope.window_id, pane: "threads" }));
    if (active.id === undefined) throw new RuntimeRefusal("The tab has no id, so it cannot be closed.");
    await scope.api.tabs.remove(active.id);
}
