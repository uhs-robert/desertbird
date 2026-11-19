// The `act` frame of the bridge: a program outside Thunderbird asks to archive, trash or move messages, and a person answers y or n in the Thunderbird window first. Nothing moves without a yes. The moves run through the same handlers as the keys, so `msg.undo` reverses them. Every refusal is a fixed text, and the reply carries only a count.

import { ignore_refusal, refused_as, warn_and_go } from "../../shared/swallow.ts";
import type { ConfirmAction } from "../../shared/protocol.ts";
import type { ConfirmRequest, ConfirmResult } from "./confirm.ts";
import { archive } from "../handlers/message.ts";
import type { HandlerScope, MessageHeader, TrashApi } from "../handlers/message.ts";
import { move_to_folder } from "../handlers/message_state.ts";
import { record_moved } from "../handlers/undo.ts";
import { MAX_FOLDER_ID_CHARS, is_message_id } from "./reads.ts";

export interface ActSettings {
    bridge: boolean;
    bridge_allow_actions: boolean;
    bridge_share_folders: boolean;
}

/** A header with the sender, which the prompt lists. */
type ActHeader = MessageHeader & { author?: string };

interface ActFolder {
    id: string;
    name?: string;
    path?: string;
    accountId?: string;
    isRoot?: boolean;
    isVirtual?: boolean;
    isUnified?: boolean;
}

/** The handlers' API, plus the folder lookup by id. */
export type ActsApi = TrashApi & {
    messages: TrashApi["messages"] & { get(id: number): Promise<ActHeader> };
    folders: TrashApi["folders"] & { get(folder_id: string): Promise<ActFolder> };
};

export interface BridgeActsDeps {
    api: ActsApi;
    read_settings(): Promise<ActSettings>;
    request_confirm(request: ConfirmRequest): Promise<ConfirmResult>;
    /** The last focused main window, where a warning about a move `u` cannot undo shows. */
    target_window(): Promise<number | undefined>;
}

type Reply = { ok: true; count: number } | { ok: false; message: string };

const refuse = (message: string): Reply => ({ ok: false, message });

export const ACT_REFUSALS = {
    off: refuse("off"),
    bad_request: refuse("the request has a missing or bad field"),
    no_such_message: refuse("no such message"),
    no_such_folder: refuse("no such folder"),
    denied: refuse("denied"),
    timed_out: refuse("timed out"),
    busy: refuse("busy"),
} as const;

const CONFIRM_REFUSALS: Record<Exclude<ConfirmResult, "yes">, Reply> = { no: ACT_REFUSALS.denied, timeout: ACT_REFUSALS.timed_out, busy: ACT_REFUSALS.busy };

export const MAX_ACT_IDS = 50;
const ACTIONS: readonly ConfirmAction[] = ["archive", "trash", "move"];
const ACT_FIELDS = new Set(["verb", "request_id", "action", "ids", "folder"]);

interface CheckedAct {
    action: ConfirmAction;
    ids: number[];
    folder_id?: string;
}

/** The checks that need no API call. `folder` comes with a move and with nothing else. */
function check_fields(request: Record<string, unknown>): CheckedAct | undefined {
    if (Object.keys(request).some((field) => !ACT_FIELDS.has(field))) return undefined;
    const { action, ids, folder } = request;
    if (!ACTIONS.includes(action as ConfirmAction)) return undefined;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_ACT_IDS || !ids.every(is_message_id) || new Set(ids).size !== ids.length) return undefined;
    if (action !== "move") return folder === undefined ? { action: action as ConfirmAction, ids } : undefined;
    return typeof folder === "string" && folder.length > 0 && folder.length <= MAX_FOLDER_ID_CHARS ? { action, ids, folder_id: folder } : undefined;
}

const allows = (settings: ActSettings, act: CheckedAct): boolean => settings.bridge && settings.bridge_allow_actions && (act.action !== "move" || settings.bridge_share_folders);

export function create_bridge_acts(deps: BridgeActsDeps) {
    const { api } = deps;

    const header_of = (id: number): Promise<ActHeader | undefined> => ignore_refusal(api.messages.get(id)).then((header) => header ?? undefined);

    // A folder the `folders` read never lists (an account root, a saved search, a unified folder) is no target either.
    async function target_folder(folder_id: string): Promise<ActFolder | undefined> {
        const folder = await ignore_refusal(api.folders.get(folder_id));
        return folder === undefined || folder.isRoot === true || folder.isVirtual === true || folder.isUnified === true ? undefined : folder;
    }

    // The Trash of each account the messages sit in. Undefined when an account has none, so the act is refused before the prompt.
    async function trash_folders(headers: ActHeader[]): Promise<Map<string, string> | undefined> {
        const trash_of = new Map<string, string>();
        for (const account_id of new Set(headers.map((header) => header.folder?.accountId))) {
            if (account_id === undefined) return undefined;
            const [trash] = await refused_as(api.folders.query({ accountId: account_id, specialUse: ["trash"] }), []);
            if (trash === undefined) return undefined;
            trash_of.set(account_id, trash.id);
        }
        return trash_of;
    }

    // Trash is a move to the Trash of each message's own account, never `messages.delete`, which deletes a message already in Trash for good. A message already in Trash stays where it is.
    function trash(scope: HandlerScope<ActsApi>, headers: ActHeader[], trash_of: Map<string, string>): Promise<void> {
        return record_moved(scope, "delete", async () => {
            const to_move = headers.filter((header) => header.folder?.specialUse?.includes("trash") !== true);
            return {
                ids: to_move.map((header) => header.id),
                async act() {
                    for (const [account_id, trash_id] of trash_of) {
                        const ids = to_move.filter((header) => header.folder?.accountId === account_id).map((header) => header.id);
                        if (ids.length > 0) await api.messages.move(ids, trash_id);
                    }
                },
                destination_of: async (message) => ({ to_folder_ids: [trash_of.get(message.folder.accountId)!], to_subfolders: false }),
            };
        });
    }

    // Two accounts can each hold an Archive, so the prompt names the account too.
    async function folder_with_account(folder: ActFolder): Promise<string> {
        const name = folder.name ?? folder.path ?? "";
        const account = (await refused_as(api.accounts.list(), [])).find((entry) => entry.id === folder.accountId);
        return account?.name === undefined ? name : `${name} (${account.name})`;
    }

    function run_move(act: CheckedAct, scope: HandlerScope<ActsApi>, headers: ActHeader[], trash_of: Map<string, string>, folder_id: string | undefined): Promise<void> {
        if (act.action === "archive") return archive(scope);
        if (act.action === "trash") return trash(scope, headers, trash_of);
        return move_to_folder(scope, folder_id!);
    }

    // A message counts as moved only when it is gone from where it sat. The archiver skips a message whose identity has archiving off and still resolves, and a message already in Trash stays, so a resolved call alone proves nothing.
    async function moved_count(headers: ActHeader[]): Promise<number> {
        const now = await Promise.all(headers.map((header) => header_of(header.id)));
        return now.filter((header, index) => header === undefined || header.folder?.id !== headers[index]!.folder?.id).length;
    }

    async function act(request: Record<string, unknown>): Promise<Reply> {
        const checked = check_fields(request);
        if (checked === undefined) return ACT_REFUSALS.bad_request;
        if (!allows(await deps.read_settings(), checked)) return ACT_REFUSALS.off;
        // Every id and the folder are found before the prompt, so a person never approves a list the add-on cannot act on.
        const headers = await Promise.all(checked.ids.map(header_of));
        if (headers.some((header) => header === undefined)) return ACT_REFUSALS.no_such_message;
        const found = headers as ActHeader[];
        const folder = checked.folder_id === undefined ? undefined : await target_folder(checked.folder_id);
        if (checked.folder_id !== undefined && folder === undefined) return ACT_REFUSALS.no_such_folder;
        const trash_of = checked.action === "trash" ? await trash_folders(found) : new Map<string, string>();
        if (trash_of === undefined) return ACT_REFUSALS.no_such_folder;

        const answer = await deps.request_confirm({
            action: checked.action,
            count: checked.ids.length,
            items: found.map((header) => ({ subject: header.subject ?? "", from: header.author ?? "" })),
            ...(folder !== undefined && { target_folder_name: await folder_with_account(folder) }),
        });
        if (answer !== "yes") return CONFIRM_REFUSALS[answer];

        // The prompt took up to 30 s. A setting turned off meanwhile stops the act, and a message moved meanwhile is left out.
        if (!allows(await deps.read_settings(), checked)) return ACT_REFUSALS.off;
        if (folder !== undefined && (await target_folder(folder.id)) === undefined) return ACT_REFUSALS.no_such_folder;
        // A message that left its folder by another hand during the prompt counts toward the total but not as moved.
        const still_there = (await Promise.all(found.map((header) => header_of(header.id)))).filter((header, index): header is ActHeader => header !== undefined && header.folder?.id === found[index]!.folder?.id);
        const total = checked.ids.length;
        if (still_there.length > 0) {
            const scope: HandlerScope<ActsApi> = { api, window_id: (await ignore_refusal(deps.target_window())) ?? -1, message_ids: still_there.map((header) => header.id), count: 1 };
            await run_move(checked, scope, still_there, trash_of, folder?.id).catch(warn_and_go("act move after confirm"));
        }
        const moved = still_there.length === 0 ? 0 : await moved_count(still_there);
        return moved === total ? { ok: true, count: total } : refuse(`moved ${moved} of ${total}`);
    }

    return { act };
}
