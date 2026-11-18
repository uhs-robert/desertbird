import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { displayed_folder } from "./displayed_folder.ts";
import type { DisplayedFolderApi } from "./displayed_folder.ts";
import { require_messages } from "./each_message.ts";
import type { HandlerScope, MessageApi, MessageHeader } from "./message.ts";
import { account_id_named } from "./account_choice.ts";
import type { MailFolder } from "./displayed_folder.ts";
import { record_moved, record_state, record_tag } from "./undo.ts";
import type { PreparedMove, UndoApi } from "./undo.ts";
import type { StateField } from "../undo_log.ts";

/** What `folder.read_all` needs: the displayed folder and the call that marks it. */
export interface ReadAllApi extends DisplayedFolderApi {
    folders: { markAsRead(folder_id: string): Promise<void> };
}

type StateScope = HandlerScope<MessageApi & UndoApi>;

// A toggle on a mixed selection follows the first message: if it is read, every message becomes unread, and the reverse. One answer for the whole selection beats each message flipping on its own.
// The headers are read up front, since the undo item needs the old value and the Message-ID of each message.
function set_state(scope: StateScope, field: StateField, value: boolean | "toggle"): Promise<void> {
    return record_state(scope, field, async () => {
        const messages = await Promise.all(require_messages(scope.message_ids).map((id) => scope.api.messages.get(id)));
        return { messages, value: value === "toggle" ? messages[0]![field] !== true : value };
    });
}

export const set_read = (scope: StateScope, args: CheckedArgs): Promise<void> => set_state(scope, "read", args["state"] === "toggle" ? "toggle" : args["state"] === "read");
export const toggle_flag = (scope: StateScope): Promise<void> => set_state(scope, "flagged", "toggle");
export const toggle_junk = (scope: StateScope): Promise<void> => set_state(scope, "junk", "toggle");

// The displayed folder, not the selection: the command marks the whole folder, and needs no selected message.
export async function read_all(scope: HandlerScope<ReadAllApi>): Promise<void> {
    const folder = await displayed_folder(scope.api, scope.window_id);
    // The API marks every message of the source folders of a saved search read, with no undo, not only the ones the search shows. A unified folder is virtual too and marks correctly.
    if (folder.isVirtual === true && folder.isUnified !== true) throw new RuntimeRefusal("Mark folder read does not work in a saved search, since it would mark every message in the folders it searches. Open the folder itself and try again.");
    await scope.api.folders.markAsRead(folder.id);
}

// The typed text is a tag key (`$label1`) or a tag name, in any letter case. `messages.update` replaces the whole tag list of a message, so each message keeps its own tags and gains or loses this one. As with the star, the first message decides: it has the tag, so the tag comes off every message, else it goes on every message.
export function toggle_tag(scope: HandlerScope<MessageApi & UndoApi>, args: CheckedArgs): Promise<void> {
    return record_tag(scope, async () => {
        const wanted = String(args["tag"]);
        const known = await scope.api.messages.tags.list();
        const match = known.find((entry) => entry.key === wanted) ?? known.find((entry) => entry.tag.toLowerCase() === wanted.toLowerCase());
        if (match === undefined) throw new RuntimeRefusal(`There is no tag named ${wanted}.`);
        const [first] = require_messages(scope.message_ids);
        const removes = ((await scope.api.messages.get(first!)).tags ?? []).includes(match.key);
        return { ids: scope.message_ids, tag_key: match.key, removes };
    });
}

// The folder is a path such as `/Archive/2026`. It is looked up in the account `--account` names, else in the one account the selected messages share. The path stays unchecked until now, because only the account knows which folders exist.
async function destination_folder(scope: StateScope, args: CheckedArgs, selected: MessageHeader[]): Promise<MailFolder> {
    let account_id: string | undefined;
    const named = String(args["account"] ?? "");
    if (named !== "") account_id = await account_id_named(scope.api, named);
    else {
        const account_ids = new Set(selected.map((message) => message.folder?.accountId));
        if (account_ids.size > 1) throw new RuntimeRefusal("The selected messages belong to more than one account, so they cannot go to one folder. Select messages of one account.");
        [account_id] = account_ids;
    }
    const path = String(args["folder"]);
    const [folder] = await scope.api.folders.query({ ...(account_id !== undefined && { accountId: account_id }), path });
    if (folder === undefined) throw new RuntimeRefusal(`There is no folder ${path} in this account.`);
    return folder;
}

const headers_of = (scope: StateScope): Promise<MessageHeader[]> => Promise.all(require_messages(scope.message_ids).map((id) => scope.api.messages.get(id)));

const move_into = (scope: StateScope, folder_id: string): PreparedMove => ({ ids: scope.message_ids, act: () => scope.api.messages.move(scope.message_ids, folder_id), destination_of: async () => ({ to_folder_ids: [folder_id], to_subfolders: false }) });

export function move_messages(scope: StateScope, args: CheckedArgs): Promise<void> {
    return record_moved(scope, "move", async () => move_into(scope, (await destination_folder(scope, args, await headers_of(scope))).id));
}

/** The move of `move_messages` to a folder already found by its id, with the same undo entry. The bridge `act` frame uses it. */
export const move_to_folder = (scope: StateScope, folder_id: string): Promise<void> => record_moved(scope, "move", async () => move_into(scope, folder_id));

// A copy leaves every original where it is, so there is nothing for `u` to move back and no undo item. Undo never deletes, and the new copy is not a move.
export async function copy_messages(scope: StateScope, args: CheckedArgs): Promise<void> {
    const folder = await destination_folder(scope, args, await headers_of(scope));
    await scope.api.messages.copy(scope.message_ids, folder.id);
}
