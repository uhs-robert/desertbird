import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { MailFolder } from "./displayed_folder.ts";
import { is_first_display_error, while_loading } from "./loading.ts";
import type { HandlerScope } from "./message.ts";
import { special_folder } from "./special_folder.ts";
import type { SpecialFolderApi, SpecialUse } from "./special_folder.ts";
import type { FolderStateApi } from "./folder_state.ts";

export interface FolderMailTab {
    id: number;
    displayedFolder?: MailFolder | null;
}

export interface FolderApi extends SpecialFolderApi, FolderStateApi {
    mailTabs: {
        query(query: { windowId?: number; active: true }): Promise<FolderMailTab[]>;
        update(tab_id: number, update: { displayedFolder: MailFolder }): Promise<unknown>;
        onDisplayedFolderChanged: { addListener(listener: (tab: FolderMailTab, folder?: MailFolder) => void): void };
    };
}

export type FolderScope = HandlerScope<FolderApi>;

// The command's `archive` is the API's `archives`.
const SPECIAL_USE: Record<string, SpecialUse> = { inbox: "inbox", trash: "trash", drafts: "drafts", sent: "sent", archive: "archives", junk: "junk" };

export async function active_mail_tab(scope: FolderScope): Promise<FolderMailTab> {
    const [tab] = await while_loading(() => scope.api.mailTabs.query({ windowId: scope.window_id, active: true }));
    if (tab === undefined) throw new RuntimeRefusal("This window has no mail tab.");
    return tab;
}

/** Shows the folder in the mail tab of the key's window. A caller that already holds the tab passes it. */
export async function show_folder(scope: FolderScope, folder: MailFolder, tab?: FolderMailTab): Promise<void> {
    tab ??= await active_mail_tab(scope);
    try {
        await scope.api.mailTabs.update(tab.id, { displayedFolder: folder });
    } catch (error) {
        // Thunderbird throws on the first display of a folder it has not read yet, although the folder shows. The text alone proves nothing, so the tab must show the folder or still be loading it.
        if (!is_first_display_error(error) || !(await is_showing_or_loading(scope, folder))) throw error;
    }
}

async function is_showing_or_loading(scope: FolderScope, folder: MailFolder): Promise<boolean> {
    try {
        const [tab] = await scope.api.mailTabs.query({ windowId: scope.window_id, active: true });
        return tab?.displayedFolder?.id === folder.id;
    } catch (error) {
        if (is_first_display_error(error)) return true;
        throw error;
    }
}

/** The folder with this path, looked up in the shown folder's account first and then in any account. */
async function folder_by_path(scope: FolderScope, path: string, account_id: string | undefined): Promise<MailFolder | undefined> {
    const { folders } = scope.api;
    const [here] = account_id === undefined ? [] : await folders.query({ accountId: account_id, path });
    return here ?? (await folders.query({ path }))[0];
}

async function special_in_account_order(scope: FolderScope, special_use: SpecialUse, account_id: string | undefined): Promise<MailFolder> {
    if (account_id !== undefined) {
        const [here] = await scope.api.folders.query({ accountId: account_id, specialUse: [special_use] });
        if (here !== undefined) return here;
    }
    return special_folder(scope.api, special_use);
}

/** Resolves a stored folder reference. Undefined when the folder is gone, renamed or its account removed. */
export async function find_folder(api: FolderApi, account_id: string, path: string): Promise<MailFolder | undefined> {
    return (await api.folders.query({ accountId: account_id, path }))[0];
}

export async function open_folder(scope: FolderScope, args: CheckedArgs): Promise<void> {
    const tab = await active_mail_tab(scope);
    const account_id = tab.displayedFolder?.accountId;
    const special = String(args.special ?? "");
    if (special !== "") return show_folder(scope, await special_in_account_order(scope, SPECIAL_USE[special] as SpecialUse, account_id), tab);
    const path = String(args.folder);
    if (path === "") throw new RuntimeRefusal("Name a folder.");
    const folder = await folder_by_path(scope, path, account_id);
    if (folder === undefined) throw new RuntimeRefusal(`There is no folder ${path}.`);
    return show_folder(scope, folder, tab);
}
