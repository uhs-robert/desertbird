import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { HandlerScope } from "./message.ts";

/** The `mailTabs.setQuickFilter` state. `{}` clears every filter. */
export interface QuickFilter {
    unread?: true;
    flagged?: true;
    attachment?: true;
    tags?: { mode: "any"; tags: Record<string, true> };
    text?: { text: string; subject: true; author: true };
}

export interface MailTab {
    id: number;
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
    mailTabs: {
        query(query: { windowId: number; active: true }): Promise<MailTab[]>;
        update(tab_id: number, update: MailTabUpdate): Promise<unknown>;
        setQuickFilter(tab_id: number, filter: QuickFilter): Promise<void>;
    };
}

type ViewScope = HandlerScope<ViewApi>;

async function active_mail_tab(scope: ViewScope): Promise<MailTab> {
    const [tab] = await scope.api.mailTabs.query({ windowId: scope.window_id, active: true });
    if (tab === undefined) throw new RuntimeRefusal("This window has no mail tab.");
    return tab;
}

const FIXED_FILTERS: Record<string, QuickFilter> = {
    all: {},
    unread: { unread: true },
    starred: { flagged: true },
    attachment: { attachment: true },
};

export async function set_filter(scope: ViewScope, args: CheckedArgs): Promise<void> {
    const state = args["state"] as string;
    const filter = state === "tag" ? { tags: { mode: "any" as const, tags: { [args["tag"] as string]: true as const } } } : FIXED_FILTERS[state]!;
    await scope.api.mailTabs.setQuickFilter((await active_mail_tab(scope)).id, filter);
}

export async function search_threads(scope: ViewScope, args: CheckedArgs): Promise<void> {
    await scope.api.mailTabs.setQuickFilter((await active_mail_tab(scope)).id, { text: { text: args["query"] as string, subject: true, author: true } });
}

export async function set_sort(scope: ViewScope, args: CheckedArgs): Promise<void> {
    await scope.api.mailTabs.update((await active_mail_tab(scope)).id, { sortType: args["by"] as string, sortOrder: args["order"] as string });
}

// The pane state is read here, at the key press, because the user can also toggle a pane with the mouse and no stored flag would know.
export async function toggle_pane(scope: ViewScope, args: CheckedArgs): Promise<void> {
    const tab = await active_mail_tab(scope);
    if (args["pane"] === "message") await scope.api.mailTabs.update(tab.id, { messagePaneVisible: !tab.messagePaneVisible });
    else await scope.api.mailTabs.update(tab.id, { folderPaneVisible: !tab.folderPaneVisible });
}
