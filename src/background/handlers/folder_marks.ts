import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { active_mail_tab, find_folder, show_folder } from "./folder_open.ts";
import type { FolderScope } from "./folder_open.ts";
import { modify_folder_state } from "./folder_state.ts";

// Marks name the folder by account id and path and never by folder id, which Thunderbird does not promise to keep.
export async function set_mark(scope: FolderScope, args: CheckedArgs): Promise<void> {
    const slot = String(args.slot);
    const folder = (await active_mail_tab(scope)).displayedFolder;
    if (!folder) throw new RuntimeRefusal("No folder is displayed.");
    await modify_folder_state(scope.api, async (state) => ({ state: { ...state, marks: { ...state.marks, [slot]: { account_id: folder.accountId, path: folder.path } } }, result: undefined }));
}

export async function jump_to_mark(scope: FolderScope, args: CheckedArgs): Promise<void> {
    const slot = String(args.slot);
    const mark = await modify_folder_state(scope.api, async (state) => ({ result: state.marks[slot] }));
    if (mark === undefined) throw new RuntimeRefusal(`Mark ${slot} is not set.`);
    const folder = await find_folder(scope.api, mark.account_id, mark.path);
    if (folder === undefined) throw new RuntimeRefusal(`Mark ${slot} points to ${mark.path}, which no longer exists.`);
    await show_folder(scope, folder);
}
