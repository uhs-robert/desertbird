import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { MailFolder } from "./displayed_folder.ts";
import { find_folder, show_folder } from "./folder_open.ts";
import type { FolderApi, FolderScope } from "./folder_open.ts";
import { modify_folder_state } from "./folder_state.ts";

const MAX_ENTRIES = 100;

/** Adds a folder the view moved to. The history keeps its place when the folder is the one the cursor already sits on: that is how a jump's own display event, and a repeated event, leave no entry. */
export function record_displayed_folder(api: FolderApi, folder: MailFolder): Promise<void> {
    return modify_folder_state(api, async (state) => {
        const { entries, cursor } = state.history;
        const current = entries[cursor];
        if (current?.account_id === folder.accountId && current.path === folder.path) return { result: undefined };
        // A new display drops the entries ahead of the cursor, as a browser's history does.
        const kept = [...entries.slice(0, cursor + 1), { account_id: folder.accountId, path: folder.path }].slice(-MAX_ENTRIES);
        return { state: { ...state, history: { entries: kept, cursor: kept.length - 1 } }, result: undefined };
    });
}

/** Starts recording every folder the mail tab shows, whoever moved it: a key, a click or the API. */
export function start_jump_history(api: FolderApi): void {
    api.mailTabs.onDisplayedFolderChanged.addListener((_tab, folder) => {
        // Account Central and a selection of several folders have no folder to record.
        if (folder && !(folder as { isRoot?: boolean }).isRoot) record_displayed_folder(api, folder).catch(console.error);
    });
}

/** Moves `count` entries along the history, over entries whose folder is gone, and as far as the history reaches. */
async function jump(scope: FolderScope, step: 1 | -1): Promise<void> {
    await modify_folder_state(scope.api, async (state) => {
        const { entries, cursor } = state.history;
        let target: { at: number; folder: MailFolder } | undefined;
        let left = scope.count;
        for (let at = cursor + step; at >= 0 && at < entries.length && left > 0; at += step) {
            const entry = entries[at] as (typeof entries)[number];
            const folder = await find_folder(scope.api, entry.account_id, entry.path);
            if (folder === undefined) continue;
            target = { at, folder };
            left--;
        }
        if (target === undefined) throw new RuntimeRefusal(step === -1 ? "There is no earlier folder in the history." : "There is no later folder in the history.");
        // The cursor is stored before the display event arrives. The event handler waits in the same queue, finds the cursor on its folder and adds nothing.
        await show_folder(scope, target.folder);
        return { state: { ...state, history: { entries, cursor: target.at } }, result: undefined };
    });
}

export const jump_back = (scope: FolderScope): Promise<void> => jump(scope, -1);
export const jump_forward = (scope: FolderScope): Promise<void> => jump(scope, 1);
