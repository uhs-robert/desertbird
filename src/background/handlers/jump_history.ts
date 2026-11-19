import { ignore_refusal } from "../../shared/swallow.ts";
import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { MailFolder } from "./displayed_folder.ts";
import { active_mail_tab, find_folder, show_folder } from "./folder_open.ts";
import type { FolderApi, FolderScope } from "./folder_open.ts";
import { modify_folder_state } from "./folder_state.ts";
import type { FolderRef } from "./folder_state.ts";

const MAX_ENTRIES = 100;

/** The jump now showing its folder. Its display event fires before `mailTabs.update` returns, while a later jump already waits in the queue, so the listener drops the event by this mark and never queues it. */
let own_jump: { tab_id: number; ref: FolderRef } | undefined;

const is_same_folder = (ref: FolderRef | undefined, folder: MailFolder): boolean => ref?.account_id === folder.accountId && ref.path === folder.path;

/** Adds a folder the view moved to. The history keeps its place when the folder is the one the cursor already sits on, so a repeated event leaves no entry. */
export function record_displayed_folder(api: FolderApi, folder: MailFolder): Promise<void> {
    return modify_folder_state(api, async (state) => {
        const { entries, cursor } = state.history;
        if (is_same_folder(entries[cursor], folder)) return { result: undefined };
        // A new display drops the entries ahead of the cursor, as a browser's history does.
        const kept = [...entries.slice(0, cursor + 1), { account_id: folder.accountId, path: folder.path }].slice(-MAX_ENTRIES);
        return { state: { ...state, history: { entries: kept, cursor: kept.length - 1 } }, result: undefined };
    });
}

const is_recordable = (folder: (MailFolder & { isRoot?: boolean }) | null | undefined): folder is MailFolder => !!folder && !folder.isRoot;

/** Starts recording every folder the mail tab shows, whoever moved it: a key, a click or the API. The folder shown now is recorded first, since no event announces it. */
export function start_jump_history(api: FolderApi): void {
    api.mailTabs.onDisplayedFolderChanged.addListener((tab, folder) => {
        // Account Central and a selection of several folders have no folder to record.
        if (!is_recordable(folder)) return;
        if (own_jump?.tab_id === tab.id && is_same_folder(own_jump.ref, folder)) return;
        record_displayed_folder(api, folder).catch(console.error);
    });
    // The window can have no mail tab yet or still be loading its first folder. The first event then records it.
    ignore_refusal(api.mailTabs.query({ active: true }))
        .then((tabs) => {
            const folder = tabs?.[0]?.displayedFolder;
            return is_recordable(folder) ? record_displayed_folder(api, folder) : undefined;
        })
        .catch(console.error);
}

/** Moves `count` entries along the history, over entries whose folder is gone, and as far as the history reaches. */
async function jump(scope: FolderScope, step: 1 | -1): Promise<void> {
    await modify_folder_state(scope.api, async (state) => {
        const { entries, cursor } = state.history;
        let target: { at: number; folder: MailFolder } | undefined;
        let left = scope.count;
        for (let at = cursor + step; at >= 0 && at < entries.length && left > 0; at += step) {
            const entry = entries[at] as FolderRef;
            const folder = await find_folder(scope.api, entry.account_id, entry.path);
            if (folder === undefined) continue;
            target = { at, folder };
            left--;
        }
        if (target === undefined) throw new RuntimeRefusal(step === -1 ? "There is no earlier folder in the history." : "There is no later folder in the history.");
        const tab = await active_mail_tab(scope);
        own_jump = { tab_id: tab.id, ref: { account_id: target.folder.accountId, path: target.folder.path } };
        try {
            await show_folder(scope, target.folder, tab);
        } finally {
            own_jump = undefined;
        }
        return { state: { ...state, history: { entries, cursor: target.at } }, result: undefined };
    });
}

export const jump_back = (scope: FolderScope): Promise<void> => jump(scope, -1);
export const jump_forward = (scope: FolderScope): Promise<void> => jump(scope, 1);
