import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

export interface MailFolder {
    id: string;
    accountId: string;
    path: string;
    specialUse?: string[];
    isVirtual?: boolean;
    canAddSubfolders?: boolean;
    isUnified?: boolean;
}

export interface DisplayedFolderApi {
    mailTabs: { query(query: { windowId: number; active: true }): Promise<{ displayedFolder?: MailFolder }[]> };
}

/** The folder shown in the active mail tab of the window the key was pressed in. The focused window can change before the handler runs, so the caller passes the window id. */
export async function displayed_folder(api: DisplayedFolderApi, window_id: number): Promise<MailFolder> {
    const [tab] = await api.mailTabs.query({ windowId: window_id, active: true });
    if (tab?.displayedFolder === undefined) throw new RuntimeRefusal("No folder is displayed.");
    return tab.displayedFolder;
}
