// The search of `/` when the folder pane has the focus. The text matches folder names, and nothing moves while the user types: Enter selects the first match and opens it, `n` and `N` step the matches, and Escape leaves the folder that was selected before the line opened.
// The matches come from `folders.query` in its order, which is the order of the tree, and cover folders inside closed parents. Showing a folder with `mailTabs.update` opens its parents and selects its row, and `keys.paneFocus` then returns the focus to the folder pane.

import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import { describe_match, opposite, step_match } from "../../../vendor/desertfox/find_match.ts";
import type { CmdlineSearchNote, FolderpaneApi, KeysApi } from "../../shared/protocol.ts";
import type { MailFolder } from "../handlers/displayed_folder.ts";
import { show_folder } from "../handlers/folder_open.ts";
import type { FolderApi, FolderScope } from "../handlers/folder_open.ts";
import type { SearchRegister, SearchRegisterStore } from "./register.ts";

export interface FolderSearchApi extends FolderApi {
    folders: FolderApi["folders"] & { query(query: Record<string, never>): Promise<MailFolder[]> };
    folderpane: Pick<FolderpaneApi, "focused"> | undefined;
    keys?: Pick<KeysApi, "paneFocus">;
}

export interface FolderSearchDeps {
    api: FolderSearchApi;
    register: SearchRegisterStore;
    say(window_id: number, text: string, is_error: boolean): Promise<void>;
}

export interface FolderSearch {
    /** Opens the search when the folder pane has the focus and answers true. Answers false, changing nothing, when it does not, or when its script is missing or fails. */
    start(window_id: number): Promise<boolean>;
    is_open(window_id: number): boolean;
    type(window_id: number, text: string): Promise<CmdlineSearchNote>;
    commit(window_id: number, text: string): Promise<void>;
    cancel(window_id: number): void;
    step(window_id: number, register: SearchRegister, relation: "same" | "opposite"): Promise<void>;
}

interface OpenFolderSearch {
    /** The folder the tab showed when the line opened. */
    origin: MailFolder | undefined;
    /** Counts keystrokes, so an older answer comes back stale. */
    sequence: number;
}

const folder_name = (folder: MailFolder): string => folder.path.slice(folder.path.lastIndexOf("/") + 1);

export function create_folder_search(deps: FolderSearchDeps): FolderSearch {
    const open = new Map<number, OpenFolderSearch>();
    const scope_of = (window_id: number) => ({ api: deps.api, window_id, message_ids: [], count: 1 }) as unknown as FolderScope;

    async function pane_has_focus(window_id: number): Promise<boolean> {
        try {
            return (await deps.api.folderpane?.focused({ windowId: window_id })) === true;
        } catch (error) {
            console.error("folderpane.focused failed", error);
            return false;
        }
    }

    async function matches(text: string): Promise<MailFolder[]> {
        const needle = text.toLowerCase();
        return (await deps.api.folders.query({})).filter((folder) => !folder.isRoot && folder_name(folder).toLowerCase().includes(needle));
    }

    async function displayed_folder(window_id: number): Promise<MailFolder | undefined> {
        return (await deps.api.mailTabs.query({ windowId: window_id, active: true }))[0]?.displayedFolder ?? undefined;
    }

    // Showing the folder selects its tree row. The focus then goes back to the folder pane, since opening a folder can leave it elsewhere.
    async function go_to(window_id: number, folder: MailFolder): Promise<void> {
        await show_folder(scope_of(window_id), folder);
        if (!(await deps.api.keys?.paneFocus({ windowId: window_id, pane: "folders" }))) throw new RuntimeRefusal("The folder opened, but the folder pane did not take the focus.");
    }

    return {
        async start(window_id) {
            // A line left over from an earlier start must not outlive a start that answers false.
            open.delete(window_id);
            if (!(await pane_has_focus(window_id))) return false;
            // The entry exists before the next await, so an Escape during it finds the search and ends it.
            const search: OpenFolderSearch = { origin: undefined, sequence: 0 };
            open.set(window_id, search);
            try {
                search.origin = await displayed_folder(window_id);
            } catch (error) {
                if (open.get(window_id) === search) open.delete(window_id);
                throw error;
            }
            return true;
        },

        is_open: (window_id) => open.has(window_id),

        async type(window_id, text) {
            const search = open.get(window_id);
            if (search === undefined) throw new RuntimeRefusal("The search is not open.");
            const mine = ++search.sequence;
            if (text === "") return { note: "", is_error: false };
            const found = await matches(text);
            if (mine !== search.sequence) return { stale: true };
            return { note: describe_match(text, found.length, 0, undefined), is_error: found.length === 0 };
        },

        async commit(window_id, text) {
            const search = open.get(window_id);
            if (search === undefined) throw new RuntimeRefusal("The search ended before it could finish.");
            search.sequence++;
            const register = await deps.register.read();
            const query = text === "" && register?.kind === "folders" ? register.text : text;
            if (query === "") throw new RuntimeRefusal("No earlier search to repeat.");
            const found = await matches(query);
            if (open.get(window_id) !== search) throw new RuntimeRefusal("The search was cancelled.");
            // No match keeps the line open, so the user can edit the text.
            if (found.length === 0) throw new RuntimeRefusal(describe_match(query, 0, 0, undefined));
            await deps.register.write({ text: query, direction: "forward", kind: "folders" });
            await go_to(window_id, found[0]!);
            // Escape came while the folder opened, so the folder from before the line comes back.
            if (open.get(window_id) !== search) {
                if (search.origin) await go_to(window_id, search.origin);
                throw new RuntimeRefusal("The search was cancelled.");
            }
            open.delete(window_id);
            await deps.say(window_id, describe_match(query, found.length, 0, undefined), false);
        },

        cancel(window_id) {
            const search = open.get(window_id);
            if (search === undefined) return;
            search.sequence++;
            open.delete(window_id);
        },

        async step(window_id, register, relation) {
            if (!(await pane_has_focus(window_id))) throw new RuntimeRefusal("The last search was a folder search. Press / in the folder pane to search again.");
            const found = await matches(register.text);
            if (found.length === 0) throw new RuntimeRefusal(describe_match(register.text, 0, 0, undefined));
            const direction = relation === "same" ? register.direction : opposite(register.direction);
            const shown = (await displayed_folder(window_id))?.id;
            const at = found.findIndex((folder) => folder.id === shown);
            const stepped = at < 0 ? { index: direction === "forward" ? 0 : found.length - 1, wrapped: false } : step_match(at, found.length, direction);
            await go_to(window_id, found[stepped.index]!);
            await deps.say(window_id, describe_match(register.text, found.length, stepped.index, undefined, stepped.wrapped), false);
        },
    };
}
