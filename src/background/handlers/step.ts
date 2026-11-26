import { refused_as } from "../../shared/swallow.ts";
import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { flags_have } from "../../shared/protocol.ts";
import type { FolderpaneApi, RowFlag, ViewRow } from "../../shared/protocol.ts";
import type { MailFolder } from "./displayed_folder.ts";
import { active_mail_tab, show_folder_and_focus_threads } from "./folder_open.ts";
import type { FolderApi } from "./folder_open.ts";
import type { MessageHeader } from "./message.ts";
import { select_row } from "./thread_view.ts";
import type { ThreadScope, ThreadViewApi } from "./thread_view.ts";

interface UnreadPage {
    id?: string | null;
    messages: Pick<MessageHeader, "id">[];
}

// An intersection, as in the router: the parts share `mailTabs` with different members.
export type StepApi = ThreadViewApi &
    FolderApi & {
        folderpane: FolderpaneApi;
        folders: { getFolderInfo(folder_id: string): Promise<{ unreadMessageCount?: number }> };
        messages: {
            query(query: { folderId: string; unread: true; messagesPerPage: number; autoPaginationTimeout: number }): Promise<UnreadPage>;
            continueList(list_id: string): Promise<UnreadPage>;
        };
    };

type StepScope = ThreadScope & { api: StepApi };

// Trash and Junk hold unread mail nobody wants to visit, so `] U` skips them.
const SKIPPED_FOLDERS = ["trash", "junk"];

// The rows are in the order the user sees, with the sort and the open threads, which a query does not give. A row holds the flags of its own message only: an unread reply inside a closed thread is found once the thread opens.
// The chrome side walks the list and answers the `wanted`th match, or the last one it found when the list runs out. The scan also gives the found message's id. The reread gives the full row, which the check compares and the select uses.
async function find_row(scope: StepScope, flag: RowFlag, from: number, forward: boolean, wanted: number): Promise<ViewRow | undefined> {
    const found = await scope.api.folderpane.viewFindRow({ windowId: scope.window_id, from, forward, flag, wanted });
    if (found.index < 0) return undefined;
    const [row] = (await scope.api.app.viewRows({ windowId: scope.window_id, first: found.index, last: found.index })).rows;
    // A quick filter or a new message between the two calls moves the rows, so the index can hold another message, even one with the same flag.
    if (row === undefined || row.id !== found.id || !flags_have(row.flags, flag)) throw new RuntimeRefusal("The list changed during the step. Press the key again.");
    return row;
}

// Folders come in the order of `folders.query`. The search starts after the shown folder and wraps once, so `] U` in the last folder with unread mail goes round to the first.
async function folder_with_unread(scope: StepScope, forward: boolean): Promise<MailFolder | undefined> {
    const tab = await active_mail_tab(scope);
    const all = (await scope.api.folders.query({})).filter((folder) => !folder.isRoot && !folder.isVirtual && !folder.specialUse?.some((use) => SKIPPED_FOLDERS.includes(use)));
    const here = all.findIndex((folder) => folder.id === tab.displayedFolder?.id);
    const before = all.slice(0, Math.max(here, 0));
    const after = all.slice(here + 1);
    const around = forward ? [...after, ...before] : [...before.reverse(), ...after.reverse()];
    // The unread counts only pick the folder, because a query over every folder takes seconds. Thunderbird throws for a folder it has not opened yet, which counts as none.
    const counts = await Promise.all(around.map((folder) => refused_as(scope.api.folders.getFolderInfo(folder.id).then((info) => info.unreadMessageCount ?? 0), 0)));
    return around.find((_, index) => counts[index]! > 0);
}

// One result is enough here: the message only has to be unread in that folder. A full query of a folder of 10,000 takes seconds, the first page of one result milliseconds.
async function show_first_unread(scope: StepScope, folder: MailFolder): Promise<void> {
    let page = await scope.api.messages.query({ folderId: folder.id, unread: true, messagesPerPage: 1, autoPaginationTimeout: 0 });
    // With no wait, a page can come back empty while the search goes on.
    while (page.messages[0] === undefined && page.id) page = await scope.api.messages.continueList(page.id);
    if (page.messages[0] === undefined) throw new RuntimeRefusal("No unread mail.");
    await show_folder_and_focus_threads(scope, folder);
    await select_row(scope, { id: page.messages[0].id });
}

// With no row selected, `[` starts after the last row.
async function last_row_index(scope: StepScope): Promise<number> {
    return (await scope.api.folderpane.viewRowCount({ windowId: scope.window_id })) - 1;
}

async function step(scope: StepScope, flag: RowFlag, args: CheckedArgs): Promise<void> {
    const forward = args["direction"] === "next";
    const { current } = await scope.api.app.viewRows({ windowId: scope.window_id, first: 0, last: 0 });
    // With no row selected (`current` is -1) `]` starts before the first row, which `current + 1` already gives.
    const target = await find_row(scope, flag, forward ? current + 1 : (current < 0 ? await last_row_index(scope) : current - 1), forward, scope.count);
    if (target) return select_row(scope, target);
    if (args["scope"] === "all_folders") {
        const folder = await folder_with_unread(scope, forward);
        if (folder) return show_first_unread(scope, folder);
    }
    throw new RuntimeRefusal(`No ${forward ? "later" : "earlier"} ${flag === "flagged" ? "starred" : flag} message.`);
}

export const step_unread = (scope: StepScope, args: CheckedArgs): Promise<void> => step(scope, "unread", args);
export const step_starred = (scope: StepScope, args: CheckedArgs): Promise<void> => step(scope, "flagged", args);
export const step_attachment = (scope: StepScope, args: CheckedArgs): Promise<void> => step(scope, "attachment", args);
