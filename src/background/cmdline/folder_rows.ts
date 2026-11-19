import { ignore_refusal, refused_as } from "../../shared/swallow.ts";
import type { AccountsApi } from "../handlers/account_choice.ts";
import type { MailFolder } from "../handlers/displayed_folder.ts";
import { read_folder_state } from "../handlers/folder_state.ts";
import type { FolderStateApi } from "../handlers/folder_state.ts";

/** One folder a value list offers. */
export interface FolderChoice {
    path: string;
    account_id: string;
    account_name: string;
}

/** What the list is for: the messages selected when the line opened, and whether every account is offered or only the selection's. */
export interface FolderQuery {
    window_id: number;
    message_ids: number[];
    all_accounts: boolean;
}

export interface FolderSourceApi extends AccountsApi, FolderStateApi {
    folders: { query(query: Record<string, never>): Promise<MailFolder[]> };
    mailTabs: { query(query: { windowId: number; active: true }): Promise<{ displayedFolder?: { accountId: string } | null }[]> };
    messages: { get(id: number): Promise<{ folder?: { accountId: string } }> };
}

const by_path = (left: FolderChoice, right: FolderChoice) => (left.path < right.path ? -1 : left.path > right.path ? 1 : left.account_name < right.account_name ? -1 : left.account_name > right.account_name ? 1 : 0);

// Only the first message names the account. A selection across accounts refuses on Enter anyway, so the list need not read every message of a long selection per keystroke.
async function shown_account(api: FolderSourceApi, window_id: number): Promise<string | undefined> {
    return (await refused_as(api.mailTabs.query({ windowId: window_id, active: true }), []))[0]?.displayedFolder?.accountId;
}

// Among folders with one path, the shown account's comes first, so a path typed in full opens where the user is.
function shown_account_first(choices: FolderChoice[], shown: string | undefined): FolderChoice[] {
    if (shown === undefined) return choices;
    const ordered = [...choices];
    ordered.forEach((choice, at) => {
        if (choice.account_id !== shown) return;
        const first = ordered.findIndex((other) => other.path === choice.path);
        if (first < at) ordered.splice(first, 0, ...ordered.splice(at, 1));
    });
    return ordered;
}

async function selection_account(api: FolderSourceApi, message_ids: number[]): Promise<string | undefined> {
    if (message_ids[0] === undefined) return undefined;
    return (await ignore_refusal(api.messages.get(message_ids[0])))?.folder?.accountId;
}

/**
 * The folders for the value rows, the recently shown ones first and then the rest by path. Recent means the folders of the jump history, newest first, so the list needs no store of its own.
 * A path held by two accounts appears twice, once per account.
 */
export function create_folder_source(api: FolderSourceApi): (query: FolderQuery) => Promise<FolderChoice[]> {
    return async ({ window_id, message_ids, all_accounts }) => {
        const [folders, accounts, state, only_account, shown] = await Promise.all([api.folders.query({}), api.accounts.list(), read_folder_state(api), all_accounts ? undefined : selection_account(api, message_ids), shown_account(api, window_id)]);
        const names = new Map(accounts.map((account) => [account.id, account.name ?? account.id]));
        const choices = folders.filter((folder) => only_account === undefined || folder.accountId === only_account).map((folder): FolderChoice => ({ path: folder.path, account_id: folder.accountId, account_name: names.get(folder.accountId) ?? folder.accountId }));
        const key = (choice: { path: string; account_id: string }) => `${choice.account_id}\n${choice.path}`;
        const by_key = new Map(choices.map((choice) => [key(choice), choice]));
        const recent: FolderChoice[] = [];
        for (const entry of [...state.history.entries].reverse()) {
            const found = by_key.get(key(entry));
            if (found !== undefined) {
                recent.push(found);
                by_key.delete(key(entry));
            }
        }
        return shown_account_first([...recent, ...[...by_key.values()].sort(by_path)], shown);
    };
}
