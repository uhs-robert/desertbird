import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

export interface MailFolder {
    accountId: string;
    path: string;
    specialUse?: string[];
}

export interface DisplayedFolderApi {
    mailTabs: { query(query: { active: true; currentWindow: true }): Promise<{ displayedFolder?: MailFolder }[]> };
}

/** The folder shown in the active mail tab of the current window. */
export async function displayed_folder(api: DisplayedFolderApi): Promise<MailFolder> {
    const [tab] = await api.mailTabs.query({ active: true, currentWindow: true });
    if (tab?.displayedFolder === undefined) throw new RuntimeRefusal("No folder is displayed.");
    return tab.displayedFolder;
}
