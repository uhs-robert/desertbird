import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { MailFolder } from "./displayed_folder.ts";

export type SpecialUse = "inbox" | "drafts" | "sent" | "trash" | "templates" | "archives" | "junk" | "outbox";

export interface SpecialFolderApi {
    folders: { query(query: { accountId?: string; specialUse: SpecialUse[] }): Promise<MailFolder[]> };
}

/** The first folder with the given special use, in one account when `account_id` is set. An account without one is a refusal. */
export async function special_folder(api: SpecialFolderApi, special_use: SpecialUse, account_id?: string): Promise<MailFolder> {
    const [folder] = await api.folders.query({ ...(account_id !== undefined && { accountId: account_id }), specialUse: [special_use] });
    if (folder === undefined) throw new RuntimeRefusal(`There is no ${special_use} folder${account_id === undefined ? "" : " in this account"}.`);
    return folder;
}
