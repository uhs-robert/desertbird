import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { ignore_refusal } from "../../shared/swallow.ts";
import { focus_pane } from "./app.ts";
import type { AppHandlerApi } from "./app.ts";
import type { MailFolder } from "./displayed_folder.ts";
import { is_first_display_error, while_loading } from "./loading.ts";
import type { HandlerScope } from "./message.ts";
import { special_folder } from "./special_folder.ts";
import type { SpecialFolderApi, SpecialUse } from "./special_folder.ts";
import type { FolderStateApi } from "./folder_state.ts";
import { account_id_named } from "./account_choice.ts";
import type { AccountsApi } from "./account_choice.ts";

export interface FolderMailTab {
    id: number;
    displayedFolder?: MailFolder | null;
}

export interface FolderApi extends SpecialFolderApi, FolderStateApi, AccountsApi {
    mailTabs: {
        query(query: { windowId?: number; active: true }): Promise<FolderMailTab[]>;
        update(tab_id: number, update: { displayedFolder: MailFolder }): Promise<unknown>;
        create(create: { displayedFolder: MailFolder }): Promise<unknown>;
        onDisplayedFolderChanged: { addListener(listener: (tab: FolderMailTab, folder?: MailFolder) => void): void };
    };
}

export type FolderScope = HandlerScope<FolderApi>;
export type FolderFocusApi = FolderApi & AppHandlerApi;
export type FolderFocusScope = HandlerScope<FolderFocusApi>;

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
    const { id } = tab;
    await display_despite_first_display_error(scope, folder, () => scope.api.mailTabs.update(id, { displayedFolder: folder }));
}

// Thunderbird throws on the first display of a folder it has not read yet, although the folder shows. The text alone proves nothing, so the tab must show the folder or still be loading it.
async function display_despite_first_display_error(scope: FolderScope, folder: MailFolder, display: () => Promise<unknown>): Promise<void> {
    try {
        await display();
    } catch (error) {
        if (!is_first_display_error(error) || !(await is_showing_or_loading(scope, folder))) throw error;
    }
}

/** Shows the folder, then moves keyboard focus to its thread list: a key that jumps to a folder asks to work in its messages. A hidden list refuses the focus, and the folder still shows. Folder search uses `show_folder` alone, to keep the folder pane focused. */
export async function show_folder_and_focus_threads(scope: FolderFocusScope, folder: MailFolder, tab?: FolderMailTab): Promise<void> {
    await show_folder(scope, folder, tab);
    await ignore_refusal(focus_pane(scope, { pane: "threads" }));
}

/** Opens the folder in a new mail tab. `mailTabs.create` takes no window and no `active`: the tab opens in front, in the window the app has current, which is the window of the key. The new tab is the front tab, so its thread list takes the focus. */
async function show_folder_in_new_tab(scope: FolderFocusScope, folder: MailFolder): Promise<void> {
    await display_despite_first_display_error(scope, folder, () => scope.api.mailTabs.create({ displayedFolder: folder }));
    await ignore_refusal(focus_pane(scope, { pane: "threads" }));
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

async function special_in_account_order(scope: FolderScope, special_use: SpecialUse, account_id: string | undefined, only_account = false): Promise<MailFolder> {
    // A named account is the only place to look, so its missing folder is a refusal, not another account's.
    if (only_account) return special_folder(scope.api, special_use, account_id);
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

export async function open_folder(scope: FolderFocusScope, args: CheckedArgs): Promise<void> {
    const tab = await active_mail_tab(scope);
    const account_id = tab.displayedFolder?.accountId;
    // An omitted optional string reaches the handler as the empty text.
    const account_name = String(args.account ?? "");
    const named = account_name === "" ? undefined : await account_id_named(scope.api, account_name);
    const special = String(args.special ?? "");
    const show = (folder: MailFolder) => (args.tab === true ? show_folder_in_new_tab(scope, folder) : show_folder_and_focus_threads(scope, folder, tab));
    if (special !== "") return show(await special_in_account_order(scope, SPECIAL_USE[special] as SpecialUse, named ?? account_id, named !== undefined));
    const path = String(args.folder);
    if (path === "") throw new RuntimeRefusal("Name a folder.");
    // A named account is the only place to look: the same path in another account is a different folder.
    const folder = named === undefined ? await folder_by_path(scope, path, account_id) : (await scope.api.folders.query({ accountId: named, path }))[0];
    if (folder === undefined) throw new RuntimeRefusal(`There is no folder ${path}${named === undefined ? "" : ` in account ${account_name}`}.`);
    return show(folder);
}
