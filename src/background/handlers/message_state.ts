import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { displayed_folder } from "./displayed_folder.ts";
import type { DisplayedFolderApi } from "./displayed_folder.ts";
import { for_each_message, require_messages } from "./each_message.ts";
import type { HandlerScope } from "./message.ts";

/** What `folder.read_all` needs: the displayed folder and the call that marks it. */
export interface ReadAllApi extends DisplayedFolderApi {
    folders: { markAsRead(folder_id: string): Promise<void> };
}

// A toggle on a mixed selection follows the first message: if it is read, every message becomes unread, and the reverse. One answer for the whole selection beats each message flipping on its own.
async function first_message_state(scope: HandlerScope, field: "read" | "flagged" | "junk"): Promise<boolean> {
    const [first_id] = require_messages(scope.message_ids);
    return (await scope.api.messages.get(first_id!))[field] === true;
}

export async function set_read(scope: HandlerScope, args: CheckedArgs): Promise<void> {
    const state = args["state"];
    const read = state === "toggle" ? !(await first_message_state(scope, "read")) : state === "read";
    await for_each_message(scope.message_ids, (id) => scope.api.messages.update(id, { read }));
}

export async function toggle_flag(scope: HandlerScope): Promise<void> {
    const flagged = !(await first_message_state(scope, "flagged"));
    await for_each_message(scope.message_ids, (id) => scope.api.messages.update(id, { flagged }));
}

export async function toggle_junk(scope: HandlerScope): Promise<void> {
    const junk = !(await first_message_state(scope, "junk"));
    await for_each_message(scope.message_ids, (id) => scope.api.messages.update(id, { junk }));
}

// The displayed folder, not the selection: the command marks the whole folder, and needs no selected message.
export async function read_all(scope: HandlerScope<ReadAllApi>): Promise<void> {
    const folder = await displayed_folder(scope.api, scope.window_id);
    // The API marks every message of the source folders of a saved search read, with no undo, not only the ones the search shows. A unified folder is virtual too and marks correctly.
    if (folder.isVirtual === true && folder.isUnified !== true) throw new RuntimeRefusal("Mark folder read does not work in a saved search, since it would mark every message in the folders it searches. Open the folder itself and try again.");
    await scope.api.folders.markAsRead(folder.id);
}

// The typed text is a tag key (`$label1`) or a tag name, in any letter case. `messages.update` replaces the whole tag list of a message, so each message keeps its own tags and gains this one.
export async function add_tag(scope: HandlerScope, args: CheckedArgs): Promise<void> {
    const wanted = String(args["tag"]);
    const known = await scope.api.messages.tags.list();
    const match = known.find((entry) => entry.key === wanted) ?? known.find((entry) => entry.tag.toLowerCase() === wanted.toLowerCase());
    if (match === undefined) throw new RuntimeRefusal(`There is no tag named ${wanted}.`);
    await for_each_message(scope.message_ids, async (id) => {
        const { tags = [] } = await scope.api.messages.get(id);
        if (!tags.includes(match.key)) await scope.api.messages.update(id, { tags: [...tags, match.key] });
    });
}

// The folder is a path such as `/Archive/2026`, looked up in the one account the selected messages share. The path stays unchecked until now, because only the account knows which folders exist.
export async function move_messages(scope: HandlerScope, args: CheckedArgs): Promise<void> {
    const selected = await Promise.all(require_messages(scope.message_ids).map((id) => scope.api.messages.get(id)));
    const account_ids = new Set(selected.map((message) => message.folder?.accountId));
    if (account_ids.size > 1) throw new RuntimeRefusal("The selected messages belong to more than one account, so they cannot move to one folder. Select messages of one account.");
    const [account_id] = account_ids;
    const path = String(args["folder"]);
    const [folder] = await scope.api.folders.query({ ...(account_id !== undefined && { accountId: account_id }), path });
    if (folder === undefined) throw new RuntimeRefusal(`There is no folder ${path} in this account.`);
    await scope.api.messages.move(scope.message_ids, folder.id);
}
