import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { AppApi } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";
import { refused_as } from "../../shared/swallow.ts";
import { MESSAGE_WINDOW_TYPE } from "../window_types.ts";

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
        move(tab_id: number, properties: { index: number }): Promise<unknown>;
        remove(tab_id: number): Promise<void>;
    };
    windows: {
        get(window_id: number): Promise<{ type?: string }>;
        remove(window_id: number): Promise<void>;
    };
    app: AppApi;
    /** The session store, which a build without it leaves out. `tab.alternate` refuses then. */
    storage: { session?: SessionStore };
}

export interface MainWindowApi {
    windows: {
        get(window_id: number): Promise<{ type?: string }>;
        getAll(query: { windowTypes: ["normal"] }): Promise<{ id?: number }[]>;
        update(window_id: number, properties: { focused: true }): Promise<unknown>;
    };
}

const WINDOWS_WITHOUT_TABS = new Set([MESSAGE_WINDOW_TYPE, "messageCompose"]);

/** The window a page opened by the key goes to. A message window and a compose window have no tab bar, and `tabs.create` refuses their ids, so the page opens in the first main window, which comes to the front. Any other window is its own. */
// Not `windows.getLastFocused`: Thunderbird ignores its `windowTypes` and answers the message window itself.
export async function main_window_of(api: MainWindowApi, window_id: number): Promise<number> {
    if (window_id < 0 || !WINDOWS_WITHOUT_TABS.has((await api.windows.get(window_id)).type ?? "")) return window_id;
    const main_id = (await refused_as(api.windows.getAll({ windowTypes: ["normal"] }), []))[0]?.id;
    if (main_id === undefined) throw new RuntimeRefusal("No main window is open to show the page in.");
    await api.windows.update(main_id, { focused: true });
    return main_id;
}

export interface SessionStore {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
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
const WHOLE_NUMBER = /^-?\d+$/;

// A whole title wins over a title that merely contains it ("Budget" before "Re: Budget").
function tab_titled(tabs: TabInfo[], wanted: string): TabInfo | undefined {
    const lowered = wanted.toLowerCase();
    const titled = (tab: TabInfo) => (tab.title ?? "").toLowerCase();
    return tabs.find((tab) => titled(tab) === lowered) ?? tabs.find((tab) => titled(tab).includes(lowered));
}

/** `tab` is a place in the tab bar counted from 1, or a tab title: a whole title first, else part of one. */
export async function switch_tab(scope: TabsScope, args: CheckedArgs): Promise<void> {
    const wanted = String(args["tab"]).trim();
    const tabs = await tabs_of_window(scope);
    const picked = TAB_NUMBER.test(wanted) ? tabs[Number(wanted) - 1] : tab_titled(tabs, wanted);
    if (picked === undefined) throw new RuntimeRefusal(`No tab matches "${wanted}".`);
    await activate(scope, picked);
}

/** `index` counts from 1 at the first tab and from -1 at the last. */
export async function goto_tab(scope: TabsScope, args: CheckedArgs): Promise<void> {
    const index = Number(args["index"]);
    const tabs = await tabs_of_window(scope);
    const picked = index > 0 ? tabs[index - 1] : index < 0 ? tabs[tabs.length + index] : undefined;
    if (picked === undefined) throw new RuntimeRefusal(`There is no tab ${index}.`);
    await activate(scope, picked);
}

/** One record per window: the tab that was in front before the current one. Only the id of that tab is stored, so a closed tab is told apart by its absence from the tab list. */
const last_tab_key = (window_id: number) => `desertbird_last_tab_${window_id}`;

/** The `tabs.onActivated` listener. A blind write of one key per window, so two events in a row never race on a shared record. */
export async function record_activation(session: SessionStore | undefined, info: { windowId: number; previousTabId?: number }): Promise<void> {
    if (session === undefined || info.previousTabId === undefined) return;
    await session.set({ [last_tab_key(info.windowId)]: info.previousTabId });
}

/** The tab of the window that was in front before this one. A press repeats the switch back, since the switch itself records the tab it left. */
export async function alternate_tab(scope: TabsScope): Promise<void> {
    const tabs = await tabs_of_window(scope);
    if (tabs.length === 1) throw new RuntimeRefusal("There is no other tab.");
    const session = scope.api.storage.session;
    if (session === undefined) throw new RuntimeRefusal("The last used tab needs session storage, which this Thunderbird lacks.");
    const key = last_tab_key(scope.window_id);
    const last_id = (await session.get(key))[key];
    const last = tabs.find((tab) => tab.id === last_id);
    if (last === undefined) throw new RuntimeRefusal("There is no earlier tab to go back to.");
    if (last.active) throw new RuntimeRefusal("There is no other tab.");
    await activate(scope, last);
}

/** Moves the front tab. `tab` is a place counted from 1 (negative from the end) or the title of a tab whose place it takes, and wins over `offset`. The first tab of the window is the mail tab, which stays first, so a move never reaches place 1. */
export async function move_tab(scope: TabsScope, args: CheckedArgs): Promise<void> {
    const tabs = await tabs_of_window(scope);
    const active = tabs.find((tab) => tab.active);
    if (active === undefined) throw new RuntimeRefusal("No tab is active.");
    if (tabs.length === 1) throw new RuntimeRefusal("There is no other tab.");
    if (active.index === 0) throw new RuntimeRefusal("The first tab stays where it is.");
    if (active.id === undefined) throw new RuntimeRefusal("That tab cannot be moved.");
    const wanted = String(args["tab"] ?? "").trim();
    let target = active.index + Number(args["offset"] ?? 0);
    if (WHOLE_NUMBER.test(wanted)) {
        const place = Number(wanted);
        if (place === 0) throw new RuntimeRefusal("There is no tab 0.");
        target = place > 0 ? place - 1 : tabs.length + place;
    } else if (wanted !== "") {
        const picked = tab_titled(tabs, wanted);
        if (picked === undefined) throw new RuntimeRefusal(`No tab matches "${wanted}".`);
        target = picked.index;
    }
    const clamped = Math.min(Math.max(target, 1), tabs.length - 1);
    if (clamped !== active.index) await scope.api.tabs.move(active.id, { index: clamped });
}

// `tabs.remove` on the first tab does nothing and reports no error, also when it is the only tab (measured). So the handler does not call it there. A message window has one tab at index 0 and closes as a window. Other non-main windows (a compose window, a popup) take the tab path, so a key never discards a draft. On the main mail tab `q` has no tab to close, so it moves the focus to the thread list, which is where `q` leaves a message in the reading pane.
export async function close_tab(scope: TabsScope): Promise<void> {
    if (scope.window_id >= 0 && (await scope.api.windows.get(scope.window_id)).type === MESSAGE_WINDOW_TYPE) return scope.api.windows.remove(scope.window_id);
    const active = (await tabs_of_window(scope)).find((tab) => tab.active);
    if (active === undefined) throw new RuntimeRefusal("No tab is active.");
    if (active.index === 0) return void (await scope.api.app.paneFocus({ windowId: scope.window_id, pane: "threads" }));
    if (active.id === undefined) throw new RuntimeRefusal("The tab has no id, so it cannot be closed.");
    await scope.api.tabs.remove(active.id);
}
