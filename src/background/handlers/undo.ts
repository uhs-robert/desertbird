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
        const { ids: given_ids, act, destination_of } = await prepare();
        // A count can reach rows the selection already holds. An id given twice would ask the undo for a second copy that does not exist.
        const ids = [...new Set(given_ids)];
        total = ids.length;
        const messages = await Promise.all(ids.map((id) => scope.api.messages.get(id)));
        await act();
        const items: MovedItem[] = [];
        for (const message of messages) {
            // The mail has moved by now, so a failed lookup here costs this message its undo, not the change.
            const destination = is_traced(message) ? await destination_of(message).catch(() => undefined) : undefined;
            if (destination === undefined || !is_traced(message)) untraced++;
            else items.push({ header_message_id: message.headerMessageId, from_folder_id: message.folder.id, ...destination, date_ms: message.date.getTime(), ...(message.size !== undefined && { size: message.size }) });
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

/** The items that share a Message-ID and the folders to look in, so two copies of one message are matched as a set. */
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

const groups_of = (entry: UndoEntry): Group<MovedItem | StateItem>[] =>
    entry.kind === "moved"
        ? group_items<MovedItem | StateItem>(entry.items, (item) => ({ header_message_id: item.header_message_id, folder_ids: (item as MovedItem).to_folder_ids, subfolders: (item as MovedItem).to_subfolders }))
        : group_items<MovedItem | StateItem>(entry.items, (item) => ({ header_message_id: item.header_message_id, folder_ids: [(item as StateItem).folder_id], subfolders: false }));

// Only the destination is searched, so a copy elsewhere (a sent copy, a filed copy) is never taken.
async function copies_in(api: UndoApi, group: Group<unknown>): Promise<MessageHeader[]> {
    const found = new Map<number, MessageHeader>();
    for (const folder_id of group.folder_ids) {
        for (const message of await query_all(api.messages, { headerMessageId: group.header_message_id, folderId: folder_id, ...(group.subfolders && { includeSubFolders: true }), autoPaginationTimeout: 0 })) found.set(message.id, message);
    }
    return [...found.values()];
}

/**
 * Picks the copy each moved item names. Two copies of one message (a sent copy and a received copy with cc to self) share a Message-ID, so the Date header tells them apart and the size breaks a tie. An item with no copy of its date gets none, so `u` never moves an unrelated copy back. The ids give no order: the API numbers a message when it first sees it.
 */
function match_moved(items: MovedItem[], copies: MessageHeader[]): (MessageHeader | undefined)[] {
    const free = [...copies];
    const take = (copy: MessageHeader | undefined) => (copy === undefined ? undefined : free.splice(free.indexOf(copy), 1)[0]);
    return items.map((item) => {
        if (item.date_ms === undefined) return take(free[0]);
        const same_date = free.filter((copy) => copy.date.getTime() === item.date_ms);
        return take(same_date.find((copy) => copy.size === item.size) ?? same_date[0]);
    });
}

// Of two copies in one folder, the one that still has the new value is the one the change touched.
function match_state(items: StateItem[], copies: MessageHeader[], field: StateField): (MessageHeader | undefined)[] {
    const carrying_change_first = [...copies].sort((a, b) => Number((a[field] === true) === items[0]!.old) - Number((b[field] === true) === items[0]!.old));
    return items.map((_, index) => carrying_change_first[index]);
}

/** Each item of the entry with the copy it names, or undefined when that copy is not there. */
async function find_copies(api: UndoApi, entry: UndoEntry): Promise<{ item: MovedItem | StateItem; copy: MessageHeader | undefined }[]> {
    const found = [];
    for (const group of groups_of(entry)) {
        const copies = await copies_in(api, group);
        const matched = entry.kind === "moved" ? match_moved(group.items as MovedItem[], copies) : match_state(group.items as StateItem[], copies, entry.field);
        found.push(...group.items.map((item, index) => ({ item, copy: matched[index] })));
    }
    return found;
}

/** Waits, without the log, until every copy of the entry shows up or the retries run out: an IMAP server shows a moved copy only after a sync. A step that refused once is not waited for again. */
async function wait_for_copies(api: UndoApi, entry: UndoEntry): Promise<void> {
    if (entry.refused === true) return;
    for (const delay_ms of [0, ...api.undo.retry_delays_ms]) {
        if (delay_ms > 0) await sleep(delay_ms);
        if ((await find_copies(api, entry)).every((found) => found.copy !== undefined)) return;
    }
}

const WHERE: Record<MoveAction, string> = { delete: "Trash", archive: "the Archives folders", move: "the folder of the move" };
const where_of = (entry: UndoEntry) => (entry.kind === "moved" ? WHERE[entry.action] : "the folder of the change");

const reason_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Undoes the entry with the log held, after one last lookup, so each message is checked in its destination right before it moves. Undo only ever moves a message back or writes an old value back.
 * A message still missing stops the whole first try: nothing moves and the entry is marked refused. The next `u` on a refused entry moves back what it finds and drops the rest, so a message gone for good never blocks the older entries.
 */
async function undo_entry(api: UndoApi, entry: UndoEntry): Promise<UndoOutcome> {
    const found = await find_copies(api, entry);
    const missing = found.filter(({ copy }) => copy === undefined).length;
    if (missing > 0 && entry.refused !== true) {
        const which = missing === found.length ? (found.length === 1 ? "The message is" : "The messages are") : `${missing} of ${plural(found.length)} are`;
        return { left: entry.items, refused: true, refusal: `${which} no longer in ${where_of(entry)}, so nothing changed. Press u again to drop this step.` };
    }
    const present = found.filter((pair): pair is { item: MovedItem | StateItem; copy: MessageHeader } => pair.copy !== undefined);
    const failed = entry.kind === "moved" ? await move_back(api, present as { item: MovedItem; copy: MessageHeader }[]) : await write_back(api, present as { item: StateItem; copy: MessageHeader }[], entry.field);
    return { left: failed.items, undone: present.length - failed.items.length, dropped: missing, ...(failed.reason !== undefined && { refusal: `${plural(failed.items.length)} could not go back: ${failed.reason} The step keeps ${failed.items.length === 1 ? "it" : "them"}.` }) };
}

async function move_back(api: UndoApi, present: { item: MovedItem; copy: MessageHeader }[]): Promise<{ items: MovedItem[]; reason?: string }> {
    const by_origin = new Map<string, { ids: number[]; items: MovedItem[] }>();
    for (const { item, copy } of present) {
        if (copy.folder?.id === item.from_folder_id) continue;
        const batch = by_origin.get(item.from_folder_id) ?? { ids: [], items: [] };
        batch.ids.push(copy.id);
        batch.items.push(item);
        by_origin.set(item.from_folder_id, batch);
    }
    const failed: { items: MovedItem[]; reason?: string } = { items: [] };
    for (const [folder_id, batch] of by_origin) {
        try {
            await api.messages.move(batch.ids, folder_id);
        } catch (error) {
            failed.items.push(...batch.items);
            failed.reason = reason_of(error);
        }
    }
    return failed;
}

async function write_back(api: UndoApi, present: { item: StateItem; copy: MessageHeader }[], field: StateField): Promise<{ items: StateItem[]; reason?: string }> {
    const failed: { items: StateItem[]; reason?: string } = { items: [] };
    for (const { item, copy } of present) {
        try {
            await api.messages.update(copy.id, { [field]: item.old });
        } catch (error) {
            failed.items.push(item);
            failed.reason = reason_of(error);
        }
    }
    return failed;
}

const UNDONE: Record<MoveAction | StateField, string> = { delete: "delete", archive: "archive", move: "move", read: "read change", flagged: "star change", junk: "junk change" };

export async function undo(scope: UndoScope): Promise<void> {
    const done = await scope.api.undo.log.undo_newest(
        (entry) => wait_for_copies(scope.api, entry),
        (entry) => undo_entry(scope.api, entry),
    );
    if (done === undefined) throw new RuntimeRefusal("Nothing to undo.");
    const { entry, outcome } = done;
    if (outcome.refusal !== undefined) throw new RuntimeRefusal(outcome.refusal);
    const step = UNDONE[entry.kind === "moved" ? entry.action : entry.field];
    const dropped = outcome.dropped ?? 0;
    const undid = (outcome.undone ?? 0) > 0 ? `Undid the ${step} of ${plural(outcome.undone ?? 0)}.` : `Dropped the ${step} step.`;
    const note = dropped === 0 ? "" : ` Dropped ${plural(dropped)} that ${dropped === 1 ? "is" : "are"} no longer in ${where_of(entry)}.`;
    await notify_result(scope.api, undid + note, scope.window_id);
}
