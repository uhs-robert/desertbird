import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { while_loading } from "./loading.ts";
import type { MailFolder } from "./displayed_folder.ts";
import type { HandlerScope } from "./message.ts";
import { APPLIED_FILTERS_STORAGE_KEY } from "../../shared/protocol.ts";

/** The `mailTabs.setQuickFilter` state. `{}` clears every filter. */
export interface QuickFilter {
    /** False hides the filter bar. Thunderbird shows the bar for any filter that leaves this out. */
    show?: boolean;
    unread?: true;
    flagged?: true;
    attachment?: true;
    tags?: { mode: "any"; tags: Record<string, true> };
    text?: { text: string; subject: true; author: true };
}

export interface MailTab {
    id: number;
    displayedFolder?: (MailFolder & { isRoot?: boolean }) | null;
    viewType?: string;
    sortType?: string;
    sortOrder?: string;
    folderPaneVisible?: boolean;
    messagePaneVisible?: boolean;
}

export interface MailTabUpdate {
    folderPaneVisible?: boolean;
    messagePaneVisible?: boolean;
    sortType?: string;
    sortOrder?: string;
}

export interface ViewApi {
    messages?: { tags: { list(): Promise<{ key: string; tag: string }[]> } };
    mailTabs: {
        query(query: { windowId: number; active: true }): Promise<MailTab[]>;
        update(tab_id: number, update: MailTabUpdate): Promise<unknown>;
        setQuickFilter(tab_id: number, filter: QuickFilter): Promise<void>;
    };
}

type ViewScope = HandlerScope<ViewApi>;

export async function active_mail_tab(scope: ViewScope): Promise<MailTab> {
    const [tab] = await while_loading(() => scope.api.mailTabs.query({ windowId: scope.window_id, active: true }));
    if (tab === undefined) throw new RuntimeRefusal("This window has no mail tab.");
    return tab;
}

// Account Central (a root folder) and a selection of several folders (no displayed folder) have no message list. Thunderbird then ignores a filter without a word, and a sort call throws.
export async function list_mail_tab(scope: ViewScope): Promise<MailTab> {
    const tab = await active_mail_tab(scope);
    if (!tab.displayedFolder || tab.displayedFolder.isRoot) throw new RuntimeRefusal("No message list is shown.");
    return tab;
}

// The API has no call that reads the quick filter, so the add-on remembers what it set for each tab. A filter the user sets by hand is unknown here: the live search restores the last one the add-on set, or a hidden empty bar when it set none.
// The map mirrors state that lives in the Thunderbird window. Session storage keeps a copy, so a restart of the background page (which leaves the window as it was) loses nothing. A restart of the application empties both, as it empties the window.
const applied_filters = new Map<number, QuickFilter>();

export interface FilterStorage {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
}

let filter_storage: FilterStorage | undefined;
let filters_loaded: Promise<void> = Promise.resolve();

/** Starts keeping the map in `storage`, and reads what an earlier page left. A search start waits for the read. */
export function keep_filters(storage: FilterStorage | undefined): void {
    filter_storage = storage;
    if (storage === undefined) return;
    filters_loaded = storage.get(APPLIED_FILTERS_STORAGE_KEY).then((stored) => {
        const saved = stored[APPLIED_FILTERS_STORAGE_KEY];
        if (typeof saved !== "object" || saved === null) return;
        // A filter set since the page started is newer than the stored one.
        for (const [tab_id, filter] of Object.entries(saved)) if (!applied_filters.has(Number(tab_id))) applied_filters.set(Number(tab_id), filter as QuickFilter);
    }, () => undefined);
}

export const filters_ready = (): Promise<void> => filters_loaded;

function save_filters(): void {
    filter_storage?.set({ [APPLIED_FILTERS_STORAGE_KEY]: Object.fromEntries(applied_filters) }).catch((error: unknown) => console.error("desertbird:", error));
}

export const EMPTY_HIDDEN_FILTER: QuickFilter = { show: false };

export const remembered_filter = (tab_id: number): QuickFilter => applied_filters.get(tab_id) ?? EMPTY_HIDDEN_FILTER;

export function forget_filter(tab_id: number): boolean {
    const had = applied_filters.delete(tab_id);
    if (had) save_filters();
    return had;
}

export async function apply_filter(api: Pick<ViewApi["mailTabs"], "setQuickFilter">, tab_id: number, filter: QuickFilter): Promise<void> {
    await api.setQuickFilter(tab_id, filter);
    applied_filters.set(tab_id, filter);
    save_filters();
}

const FIXED_FILTERS: Record<string, QuickFilter> = {
    all: {},
    unread: { unread: true },
    starred: { flagged: true },
    attachment: { attachment: true },
};

// The typed text is a tag key or a tag name in any letter case, as for `msg.tag`. An unknown text passes through as a key.
async function tag_key(scope: ViewScope, wanted: string): Promise<string> {
    const known = (await scope.api.messages?.tags.list()) ?? [];
    return (known.find((entry) => entry.key === wanted) ?? known.find((entry) => entry.tag.toLowerCase() === wanted.toLowerCase()))?.key ?? wanted;
}

// Only the star changes, so an unread, tag or text filter stays. The hidden-bar marker goes when the star comes on, because Thunderbird should show the bar for a filter the user can see.
function toggled_starred({ show: _hidden, flagged, ...rest }: QuickFilter): QuickFilter {
    return flagged ? rest : { ...rest, flagged: true };
}

export async function set_filter(scope: ViewScope, args: CheckedArgs): Promise<void> {
    const state = args["state"] as string;
    const tab = await list_mail_tab(scope);
    const filter = state === "tag" ? { tags: { mode: "any" as const, tags: { [await tag_key(scope, args["tag"] as string)]: true as const } } } : state === "toggle_starred" ? toggled_starred(remembered_filter(tab.id)) : FIXED_FILTERS[state]!;
    await apply_filter(scope.api.mailTabs, tab.id, filter);
}

export async function search_threads(scope: ViewScope, args: CheckedArgs): Promise<void> {
    const tab = await list_mail_tab(scope);
    await apply_filter(scope.api.mailTabs, tab.id, { text: { text: args["query"] as string, subject: true, author: true } });
}

// A view grouped by its sort column cannot group by size or by read state. Thunderbird swaps in date without an error, so the handler refuses first.
const NOT_GROUPABLE_SORTS = ["size", "unread"];

// `current` and `toggle` read the tab here, at the key press, because the user can also change the sort with the mouse and no stored flag would know.
export async function set_sort(scope: ViewScope, args: CheckedArgs): Promise<void> {
    const tab = await list_mail_tab(scope);
    const by = args["by"] === "current" ? tab.sortType : (args["by"] as string);
    if (by === undefined) throw new RuntimeRefusal("The list has no sort column to keep.");
    if (tab.viewType === "groupedBySortType" && NOT_GROUPABLE_SORTS.includes(by)) throw new RuntimeRefusal(`This view is grouped by its sort column, which cannot group by ${by}.`);
    const order = args["order"] === "toggle" ? (tab.sortOrder === "ascending" ? "descending" : "ascending") : (args["order"] as string);
    await scope.api.mailTabs.update(tab.id, { sortType: by, sortOrder: order });
}

// The pane state is read here, at the key press, because the user can also toggle a pane with the mouse and no stored flag would know.
export async function toggle_pane(scope: ViewScope, args: CheckedArgs): Promise<void> {
    const tab = await active_mail_tab(scope);
    if (args["pane"] === "message") await scope.api.mailTabs.update(tab.id, { messagePaneVisible: !tab.messagePaneVisible });
    else await scope.api.mailTabs.update(tab.id, { folderPaneVisible: !tab.folderPaneVisible });
}
