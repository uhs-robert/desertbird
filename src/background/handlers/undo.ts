import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { HandlerScope, MessageHeader, MessageUpdate } from "./message.ts";
import { for_each_message } from "./each_message.ts";
import { query_all } from "./message_query.ts";
import type { MessageQueryApi } from "./message_query.ts";
import type { SpecialFolderApi } from "./special_folder.ts";
import { notify_refusal, notify_result } from "../notify.ts";
import type { NotificationsApi } from "../notify.ts";
import type { MoveAction, MovedItem, StateField, StateItem, UndoEntry, UndoLog, UndoOutcome } from "../undo_log.ts";

/** What recording a change and undoing it need. */
export interface UndoApi extends NotificationsApi, SpecialFolderApi {
    messages: MessageQueryApi & {
        get(id: number): Promise<MessageHeader>;
        move(ids: number[], folder_id: string): Promise<void>;
        update(id: number, properties: MessageUpdate): Promise<void>;
    };
    /** `retry_delays_ms` spaces the lookups of a message an undo cannot find yet: an IMAP server shows a moved copy only after a sync. */
    undo: { log: UndoLog; retry_delays_ms: readonly number[] };
}

type UndoScope = HandlerScope<UndoApi>;

/** A message the log can find again: it has a Message-ID and a folder. */
type TracedMessage = MessageHeader & { headerMessageId: string; folder: { id: string; accountId: string; specialUse?: string[] } };

const is_traced = (message: MessageHeader): message is TracedMessage => typeof message.headerMessageId === "string" && message.headerMessageId !== "" && typeof message.folder?.id === "string";

/** Where a moved message went. Undefined when the move cannot be undone, with no folder to look in. */
export type Destination = Pick<MovedItem, "to_folder_ids" | "to_subfolders"> | undefined;

const plural = (count: number) => `${count} message${count === 1 ? "" : "s"}`;

// The change still runs. The warning tells the user that `u` will not bring these messages back.
async function warn_untraced(scope: UndoScope, untraced: number, total: number): Promise<void> {
    if (untraced === 0) return;
    const which = untraced === total ? (total === 1 ? "this message" : "these messages") : `${untraced} of ${plural(total)}`;
    await notify_refusal(scope.api, `u cannot undo this for ${which}: no Message-ID, or no copy DesertBird can find again.`, scope.window_id);
}

/** A delete, archive or move, as `prepare` works it out: the ids, the call that moves them, and where each message went. `destination_of` runs after `act`, since an archive makes its year folder only then. */
export interface PreparedMove {
    ids: number[];
    act(): Promise<void>;
    destination_of(message: TracedMessage): Promise<Destination>;
}

/**
 * Runs a delete, archive or move and records how to move each message back. The log is taken before the first await, so a `u` pressed after the key waits for this entry. The headers are read before `act`, because after the move the ids no longer name the messages.
 * The entry is kept only once `act` succeeds: a failed move leaves the messages where the log would not look.
 */
export async function record_moved(scope: UndoScope, action: MoveAction, prepare: () => Promise<PreparedMove>): Promise<void> {
    let untraced = 0;
    let total = 0;
    await scope.api.undo.log.record(async (keep) => {
        const { ids, act, destination_of } = await prepare();
        total = ids.length;
        const messages = await Promise.all(ids.map((id) => scope.api.messages.get(id)));
        await act();
        const items: MovedItem[] = [];
        for (const message of messages) {
            const destination = is_traced(message) ? await destination_of(message) : undefined;
            if (destination === undefined || !is_traced(message)) untraced++;
            else items.push({ header_message_id: message.headerMessageId, from_folder_id: message.folder.id, ...destination });
        }
        keep({ kind: "moved", action, items });
    });
    await warn_untraced(scope, untraced, total);
}

/** Gives each message `prepare` names the new value of `field`, one call each, and records the old value of each message that changed. A failure part way keeps the items of the messages already changed. The log is taken before the first await, as in `record_moved`. */
export async function record_state(scope: UndoScope, field: StateField, prepare: () => Promise<{ messages: MessageHeader[]; value: boolean }>): Promise<void> {
    let untraced = 0;
    let total = 0;
    await scope.api.undo.log.record(async (keep) => {
        const { messages, value } = await prepare();
        total = messages.length;
        const items: StateItem[] = [];
        keep({ kind: "state", field, items });
        const by_id = new Map(messages.map((message) => [message.id, message]));
        await for_each_message([...by_id.keys()], async (id) => {
            await scope.api.messages.update(id, { [field]: value });
            const message = by_id.get(id)!;
            if ((message[field] === true) === value) return;
            if (is_traced(message)) items.push({ header_message_id: message.headerMessageId, folder_id: message.folder.id, old: !value });
            else untraced++;
        });
    });
    await warn_untraced(scope, untraced, total);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The items that share a Message-ID and the folders to look in, so two copies of one message are matched by count. */
interface Group<Item> {
    header_message_id: string;
    folder_ids: string[];
    subfolders: boolean;
    items: Item[];
}

function group_items<Item>(items: Item[], where: (item: Item) => Omit<Group<Item>, "items">): Group<Item>[] {
    const groups = new Map<string, Group<Item>>();
    for (const item of items) {
        const place = where(item);
        const key = JSON.stringify(place);
        const group = groups.get(key) ?? { ...place, items: [] };
        group.items.push(item);
        groups.set(key, group);
    }
    return [...groups.values()];
}

// Only the destination is searched, so a copy elsewhere (a sent copy, a filed copy) is never taken. Newest first: a moved message gets a new id, larger than an older copy's.
async function copies_in(api: UndoApi, group: Group<unknown>): Promise<MessageHeader[]> {
    const found = new Map<number, MessageHeader>();
    for (const folder_id of group.folder_ids) {
        for (const message of await query_all(api.messages, { headerMessageId: group.header_message_id, folderId: folder_id, ...(group.subfolders && { includeSubFolders: true }), autoPaginationTimeout: 0 })) found.set(message.id, message);
    }
    return [...found.values()].sort((a, b) => b.id - a.id);
}

/** The copies of every group, at least as many as the group has items, or the number of messages still missing after the last try. */
async function find_copies<Item>(api: UndoApi, groups: Group<Item>[]): Promise<{ copies: MessageHeader[][] } | { missing: number }> {
    const copies: MessageHeader[][] = groups.map(() => []);
    const short = () => groups.flatMap((group, index) => (copies[index]!.length < group.items.length ? [index] : []));
    for (const delay_ms of [0, ...api.undo.retry_delays_ms]) {
        if (delay_ms > 0) await sleep(delay_ms);
        for (const index of short()) copies[index] = await copies_in(api, groups[index]!);
        if (short().length === 0) return { copies };
    }
    return { missing: short().reduce((sum, index) => sum + groups[index]!.items.length - copies[index]!.length, 0) };
}

const MOVED_TO: Record<MoveAction, string> = { delete: "Trash", archive: "the Archives folders", move: "the folder of the move" };

function missing_refusal(missing: number, total: number, where: string): string {
    return `${missing === total ? (total === 1 ? "The message is" : "The messages are") : `${missing} of ${plural(total)} are`} no longer in ${where}, so nothing changed. The step stays, and u tries it again.`;
}

const reason_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Undo only ever moves a message back: every lookup runs first, and a missing message stops the whole undo before anything moves.
async function undo_moved(api: UndoApi, items: MovedItem[], action: MoveAction): Promise<UndoOutcome> {
    const groups = group_items(items, (item) => ({ header_message_id: item.header_message_id, folder_ids: item.to_folder_ids, subfolders: item.to_subfolders }));
    const found = await find_copies(api, groups);
    if ("missing" in found) return { left: items, refusal: missing_refusal(found.missing, items.length, MOVED_TO[action]) };
    const by_origin = new Map<string, { ids: number[]; items: MovedItem[] }>();
    groups.forEach((group, index) => {
        group.items.forEach((item, at) => {
            const copy = found.copies[index]![at]!;
            if (copy.folder?.id === item.from_folder_id) return;
            const batch = by_origin.get(item.from_folder_id) ?? { ids: [], items: [] };
            batch.ids.push(copy.id);
            batch.items.push(item);
            by_origin.set(item.from_folder_id, batch);
        });
    });
    const left: MovedItem[] = [];
    let refusal: string | undefined;
    for (const [folder_id, batch] of by_origin) {
        try {
            await api.messages.move(batch.ids, folder_id);
        } catch (error) {
            left.push(...batch.items);
            refusal = `${plural(batch.items.length)} could not go back: ${reason_of(error)} The step keeps ${left.length === 1 ? "it" : "them"}.`;
        }
    }
    return refusal === undefined ? { left } : { left, refusal };
}

// Of two copies in one folder, the one that still has the new value is the one the change touched.
async function undo_state(api: UndoApi, items: StateItem[], field: StateField): Promise<UndoOutcome> {
    const groups = group_items(items, (item) => ({ header_message_id: item.header_message_id, folder_ids: [item.folder_id], subfolders: false }));
    const found = await find_copies(api, groups);
    if ("missing" in found) return { left: items, refusal: missing_refusal(found.missing, items.length, "the folder of the change") };
    const left: StateItem[] = [];
    let refusal: string | undefined;
    for (const [index, group] of groups.entries()) {
        const copies = [...found.copies[index]!].sort((a, b) => Number((a[field] === true) === group.items[0]!.old) - Number((b[field] === true) === group.items[0]!.old));
        for (const [at, item] of group.items.entries()) {
            try {
                await api.messages.update(copies[at]!.id, { [field]: item.old });
            } catch (error) {
                left.push(item);
                refusal = `${plural(left.length)} could not change back: ${reason_of(error)} The step keeps ${left.length === 1 ? "it" : "them"}.`;
            }
        }
    }
    return refusal === undefined ? { left } : { left, refusal };
}

const UNDONE: Record<MoveAction | StateField, string> = { delete: "delete", archive: "archive", move: "move", read: "read change", flagged: "star change", junk: "junk change" };

const undo_entry = (api: UndoApi) => (entry: UndoEntry) => (entry.kind === "moved" ? undo_moved(api, entry.items, entry.action) : undo_state(api, entry.items, entry.field));

export async function undo(scope: UndoScope): Promise<void> {
    const done = await scope.api.undo.log.undo_newest(undo_entry(scope.api));
    if (done === undefined) throw new RuntimeRefusal("Nothing to undo.");
    const { entry, outcome } = done;
    if (outcome.refusal !== undefined) throw new RuntimeRefusal(outcome.refusal);
    await notify_result(scope.api, `Undid the ${UNDONE[entry.kind === "moved" ? entry.action : entry.field]} of ${plural(entry.items.length)}.`, scope.window_id);
}
