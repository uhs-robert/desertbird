// The search of `/` and `?` in the background. In the thread list a search is the Quick Filter: it narrows the rows while the user types, `Enter` keeps the filter and selects a row, `Escape` puts the earlier filter back. `n` and `N` step the rows the filter leaves.
// The matching is Thunderbird's own (a case-insensitive text in the subject and the sender). The vendored `find_match.ts` supplies the stepping and the wording.

import { ignore_refusal, keep_chain } from "../../shared/swallow.ts";
import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import { describe_match, opposite, step_match } from "../../../vendor/desertfox/find_match.ts";
import type { AppApi, CmdlineSearchNote, FilterApi, FolderpaneApi, SearchDirection, ViewRow } from "../../shared/protocol.ts";
import type { ThreadViewApi } from "../handlers/thread_view.ts";
import { active_mail_tab, apply_filter, filters_ready, forget_filter, list_mail_tab, remembered_filter } from "../handlers/view.ts";
import type { AppliedFilter } from "../handlers/view.ts";
import type { Timers } from "../hud/toasts.ts";
import { create_folder_search } from "./folder_search.ts";
import type { FolderSearchApi } from "./folder_search.ts";
import type { SearchRegisterStore } from "./register.ts";

/** How long the filter waits after a keystroke. A burst of typing filters once, and a slow folder is not asked for each letter. */
export const SEARCH_DEBOUNCE_MS = 150;

// How often a count asks whether Thunderbird still fills the filtered list, and how long it asks. A search that runs on past the limit (a saved search over remote folders, a search that never ends) stops the count with a message, so no poll outlives it.
const LIST_FILLED_POLL_MS = 100;
export const LIST_FILLED_LIMIT_MS = 5000;
const STILL_SEARCHING = "Thunderbird's search still runs after 5 s, so there is no count yet. Try again when it ends.";

export type SearchApi = { mailTabs: ThreadViewApi["mailTabs"] & { get(tab_id: number): Promise<{ displayedFolder?: { id: string } | null }> } } & { app?: Pick<AppApi, "viewRows" | "paneFocus">; folderpane?: ThreadViewApi["folderpane"]; filter?: FilterApi | undefined } & Partial<Pick<FolderSearchApi, "folders">>;

export interface SearchDeps {
    api: SearchApi;
    register: SearchRegisterStore;
    timers: Timers;
    /** Shows the text as a toast in the window, or as a system notification when no toast can show. */
    say(window_id: number, text: string, is_error: boolean): Promise<void>;
}

/** The part of the service the commands use. */
export interface SearchSessions {
    /** Opens a live search in the window. A forward search opened with the folder pane focused searches folder names. Otherwise it refuses when no message list is shown. */
    start(window_id: number, direction: SearchDirection): Promise<void>;
    /** `n` (the same way as the register) and `N` (the other way). */
    step(window_id: number, relation: "same" | "opposite"): Promise<void>;
}

export interface SearchService extends SearchSessions {
    /** One keystroke of the line. Resolves `stale` when a newer keystroke came while this one waited or ran. */
    type(window_id: number, text: string): Promise<CmdlineSearchNote>;
    /** `Enter`: keeps the filter, selects the first row (the last for `?`), stores the register and says where it stands. Refuses with the reason when the search cannot finish. */
    commit(window_id: number, text: string): Promise<void>;
    /** `Escape`, or the overlay left on its own: puts the filter the search found back. */
    cancel(window_id: number): Promise<void>;
}

interface LiveSearch {
    tab_id: number;
    folder_id: string;
    direction: SearchDirection;
    /** What the tab showed when the search began. */
    prior: AppliedFilter;
    /** Counts keystrokes. A wait or an apply that finds a newer number stops. */
    sequence: number;
    /** Every filter change of the search runs after the one before it, so a slow older filter never lands after a newer one or after the restore. */
    changes: Promise<unknown>;
}

const with_text = (base: AppliedFilter, text: string): AppliedFilter => {
    // The bar must show while text filters the list, so the hidden flag of the earlier filter is dropped.
    const kept = { ...base };
    delete kept.show;
    return { ...kept, text: { text, subject: true, author: true } };
};

function in_order<T>(search: LiveSearch, change: () => Promise<T>): Promise<T> {
    const run = search.changes.then(change);
    search.changes = keep_chain(run);
    return run;
}

export function create_search_service(deps: SearchDeps): SearchService {
    const live = new Map<number, LiveSearch>();
    const folder_search = create_folder_search(deps as unknown as Parameters<typeof create_folder_search>[0]);

    const scope_of = (window_id: number) => ({ api: deps.api as unknown as ThreadViewApi, window_id, message_ids: [], count: 1 });

    function viewer(): { app: Pick<AppApi, "viewRows">; folderpane: Pick<FolderpaneApi, "viewRowCount"> } {
        const { app, folderpane } = deps.api;
        if (app === undefined || folderpane === undefined) throw new RuntimeRefusal("Search needs the DesertBird Experiment, which is not loaded.");
        return { app, folderpane };
    }

    // One read of the view in chrome, so the count is of one list and not of blocks read while a filter changed it. The caller waits for `list_filled` first: the list is complete only then.
    const count_rows = (window_id: number): Promise<number> => viewer().folderpane.viewRowCount({ windowId: window_id });

    // `setQuickFilter` returns once the search starts, and Thunderbird adds rows until `filter.searching` turns false. A count before then is of part of the list. `still_wanted` runs before every poll and after the last one, so a newer keystroke, Escape or a change of tab or folder stops the wait and the caller counts nothing. Without the filter script there is nothing to ask, so the count reads what it finds.
    async function list_filled(tab_id: number, still_wanted: () => Promise<boolean>): Promise<"filled" | "stopped" | "timed_out"> {
        const filter = deps.api.filter;
        for (let waited = 0; ; waited += LIST_FILLED_POLL_MS) {
            if (!(await still_wanted())) return "stopped";
            if (filter === undefined || !(await filter.searching({ tabId: tab_id }))) return (await still_wanted()) ? "filled" : "stopped";
            if (waited >= LIST_FILLED_LIMIT_MS) return "timed_out";
            await wait(LIST_FILLED_POLL_MS);
        }
    }

    // The tab a search or an `n` began in is still the one in front with the same folder.
    async function shows(window_id: number, tab_id: number, folder_id: string): Promise<boolean> {
        const tab = await active_mail_tab(scope_of(window_id));
        return tab.id === tab_id && tab.displayedFolder?.id === folder_id;
    }

    async function row_at(window_id: number, index: number): Promise<ViewRow | undefined> {
        return (await viewer().app.viewRows({ windowId: window_id, first: index, last: index })).rows[0];
    }

    // The search belongs to the tab and folder it began in. Another tab or folder holds a filter that is not the search's, so nothing of it is touched.
    const still_here = (window_id: number, search: LiveSearch): Promise<boolean> => shows(window_id, search.tab_id, search.folder_id);

    // The restore goes to the tab the search began in, even when another tab is in front now. That tab still shows the filter the search left.
    async function owns_tab(search: LiveSearch): Promise<boolean> {
        const tab = await ignore_refusal(deps.api.mailTabs.get(search.tab_id));
        return tab?.displayedFolder?.id === search.folder_id;
    }

    // A search job rechecks right before it changes the tab, because it can wait in the tab's apply chain behind another filter key.
    const owns_search = (window_id: number, search: LiveSearch) => async () => live.get(window_id) === search && (await still_here(window_id, search));

    function leave_search(window_id: number, search: LiveSearch): void {
        search.sequence++;
        if (live.get(window_id) === search) live.delete(window_id);
    }

    const wait = (ms: number) => new Promise<void>((resolve) => deps.timers.set(resolve, ms));

    // The start of a search job refuses the same way, so a folder change during a wait never commits in the new folder.
    async function refuse_unless_here(window_id: number, search: LiveSearch): Promise<void> {
        if (await still_here(window_id, search)) return;
        forget_filter(search.tab_id);
        leave_search(window_id, search);
        throw new RuntimeRefusal("The folder changed, so the search ended.");
    }

    // A commit counts and selects the final rows, so it waits for the search of its filter. `filter.set` stops waiting after 5 s and a plain text filter never waits, so the search can still run here. Escape and a folder change end the wait. A search past the limit keeps the line open for another Enter.
    async function search_ended(window_id: number, search: LiveSearch): Promise<void> {
        const ended = await list_filled(search.tab_id, async () => {
            if (live.get(window_id) !== search) throw new RuntimeRefusal("The search was cancelled.");
            await refuse_unless_here(window_id, search);
            return true;
        });
        if (ended === "timed_out") throw new RuntimeRefusal(STILL_SEARCHING);
    }

    // The selection goes to the tab the search or the `n` began in, which the caller has just checked is still in front.
    async function show_match(window_id: number, tab_id: number, text: string, index: number, count: number, wrapped: boolean): Promise<void> {
        const row = await row_at(window_id, index);
        if (row === undefined || row.id === null) throw new RuntimeRefusal("The list changed under the search.");
        await deps.api.mailTabs.setSelectedMessages(tab_id, [row.id]);
        await deps.say(window_id, describe_match(text, count, index, undefined, wrapped), false);
    }

    return {
        async start(window_id, direction) {
            if (direction === "forward" && (await folder_search.start(window_id))) return;
            const tab = await list_mail_tab(scope_of(window_id));
            viewer();
            await filters_ready();
            live.set(window_id, { tab_id: tab.id, folder_id: tab.displayedFolder!.id, direction, prior: remembered_filter(tab.id), sequence: 0, changes: Promise.resolve() });
        },

        async type(window_id, text) {
            if (folder_search.is_open(window_id)) return folder_search.type(window_id, text);
            const search = live.get(window_id);
            if (search === undefined) throw new RuntimeRefusal("The search is not open.");
            const mine = ++search.sequence;
            await wait(SEARCH_DEBOUNCE_MS);
            if (mine !== search.sequence) return { stale: true };
            return in_order<CmdlineSearchNote>(search, async () => {
                if (mine !== search.sequence) return { stale: true };
                if (!(await still_here(window_id, search))) {
                    forget_filter(search.tab_id);
                    leave_search(window_id, search);
                    return { note: "The folder changed, so the search ended.", is_error: true };
                }
                if (!(await apply_filter(deps.api, search.tab_id, text === "" ? search.prior : with_text(search.prior, text), owns_search(window_id, search)))) return { stale: true };
                if (text === "") return { note: "", is_error: false };
                const filled = await list_filled(search.tab_id, async () => mine === search.sequence && (await still_here(window_id, search)));
                if (mine !== search.sequence) return { stale: true };
                if (filled === "stopped") {
                    forget_filter(search.tab_id);
                    leave_search(window_id, search);
                    return { note: "The folder changed, so the search ended.", is_error: true };
                }
                if (filled === "timed_out") return { note: STILL_SEARCHING, is_error: true };
                const count = await count_rows(window_id);
                if (mine !== search.sequence) return { stale: true };
                return { note: describe_match(text, count, search.direction === "forward" ? 0 : count - 1, undefined), is_error: count === 0 };
            });
        },

        async commit(window_id, text) {
            if (folder_search.is_open(window_id)) return folder_search.commit(window_id, text);
            const search = live.get(window_id);
            if (search === undefined) throw new RuntimeRefusal("The search ended before it could finish.");
            // A newer keystroke or the end of the search stops any filter still in flight.
            search.sequence++;
            const register = await deps.register.read();
            if (live.get(window_id) !== search) throw new RuntimeRefusal("The search was cancelled.");
            const query = text === "" ? register?.text : text;
            if (query === undefined) throw new RuntimeRefusal("No earlier search to repeat.");
            await in_order(search, async () => {
                if (!(await still_here(window_id, search))) {
                    forget_filter(search.tab_id);
                    leave_search(window_id, search);
                    throw new RuntimeRefusal("The folder changed, so the search ended.");
                }
                const wanted = with_text(search.prior, query);
                // Enter right after the last keystroke finds its filter applied, and the search of that filter may still run. A second apply would restart it.
                if (JSON.stringify(remembered_filter(search.tab_id)) !== JSON.stringify(wanted) && !(await apply_filter(deps.api, search.tab_id, wanted, owns_search(window_id, search)))) throw new RuntimeRefusal("The search was cancelled.");
                await search_ended(window_id, search);
                const count = await count_rows(window_id);
                // Escape came while the filter ran. Its restore is queued behind this job, so the committed text must not stay.
                if (live.get(window_id) !== search) throw new RuntimeRefusal("The search was cancelled.");
                // No match keeps the search open, so the user can edit the text. Escape still restores the earlier filter.
                if (count === 0) throw new RuntimeRefusal(describe_match(query, 0, 0, undefined));
                await deps.register.write({ text: query, direction: search.direction, kind: "threads" });
                await show_match(window_id, search.tab_id, query, search.direction === "forward" ? 0 : count - 1, count, false);
                // The search ends only now, so a failed write or selection leaves it open for another Enter.
                leave_search(window_id, search);
            });
        },

        async cancel(window_id) {
            if (folder_search.is_open(window_id)) return folder_search.cancel(window_id);
            const search = live.get(window_id);
            if (search === undefined) return;
            leave_search(window_id, search);
            await in_order(search, async () => {
                if (!(await owns_tab(search)) || !(await apply_filter(deps.api, search.tab_id, search.prior, () => owns_tab(search)))) forget_filter(search.tab_id);
            }).catch((error: unknown) => console.error("desertbird:", error));
        },

        async step(window_id, relation) {
            const register = await deps.register.read();
            if (register === undefined) throw new RuntimeRefusal("No search to repeat. Press / first.");
            if (register.kind === "folders") return folder_search.step(window_id, register, relation);
            const tab = await list_mail_tab(scope_of(window_id));
            // After Escape the list is no longer narrowed to the search, so `n` narrows it again.
            if (remembered_filter(tab.id).text?.text !== register.text) await apply_filter(deps.api, tab.id, with_text(remembered_filter(tab.id), register.text));
            const folder_id = tab.displayedFolder!.id;
            const filled = await list_filled(tab.id, () => shows(window_id, tab.id, folder_id));
            if (filled === "stopped") throw new RuntimeRefusal("The tab or folder changed, so n stopped.");
            if (filled === "timed_out") throw new RuntimeRefusal(STILL_SEARCHING);
            const count = await count_rows(window_id);
            if (count === 0) throw new RuntimeRefusal(describe_match(register.text, 0, 0, undefined));
            const direction = relation === "same" ? register.direction : opposite(register.direction);
            const { current } = await viewer().app.viewRows({ windowId: window_id, first: 0, last: 0 });
            const stepped = current < 0 ? { index: direction === "forward" ? 0 : count - 1, wrapped: false } : step_match(current, count, direction);
            await show_match(window_id, tab.id, register.text, stepped.index, count, stepped.wrapped);
        },
    };
}
