// The list filters by the selected message that `mailTabs.setQuickFilter` cannot carry: its mailing list (List-Id) and its day. The `filter` Experiment applies them.

import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { AppApi, FilterSetArgs } from "../../shared/protocol.ts";
import type { HandlerScope, MessageHeader } from "./message.ts";

/** The filters a tab shows beside its quick filter. Both can show at once, and the quick filter ANDs them with its own. */
export interface MessageTerms {
    /** A List-Id with its angle brackets. */
    list_id?: string;
    /** A message date in microseconds. The filter shows its local calendar day. */
    date_us?: number;
}

export type MessageTermField = "list" | "date";

export interface FilterTermsApi {
    messages: { get(id: number): Promise<MessageHeader>; getFull(id: number): Promise<{ headers?: Record<string, string[]> }> };
    /** Names the cursor row. Absent when the Experiment did not load, and the first selected message stands in. */
    app?: Pick<AppApi, "viewRows"> | undefined;
}

export const is_message_term_field = (field: string): field is MessageTermField => field === "list" || field === "date";

// The message at the cursor row, or none. The row moves with j and k while nothing is selected.
async function cursor_row_message_id(scope: HandlerScope<FilterTermsApi>): Promise<number | null> {
    if (scope.api.app === undefined) return null;
    const { current } = await scope.api.app.viewRows({ windowId: scope.window_id, first: 0, last: 0 });
    if (current < 0) return null;
    return (await scope.api.app.viewRows({ windowId: scope.window_id, first: current, last: current })).rows[0]?.id ?? null;
}

/** The messages a filter by the message reads: the selection, or the cursor message when nothing is selected. */
export async function selected_or_cursor_ids(scope: HandlerScope<FilterTermsApi>): Promise<number[]> {
    if (scope.message_ids.length > 0) return scope.message_ids;
    const cursor_id = await cursor_row_message_id(scope);
    return cursor_id === null ? [] : [cursor_id];
}

/** The one message of `ids` a filter by the message reads: the cursor row while it is part of the selection, else the first selected. A closed thread selects its replies too, and its cursor row is the root. */
// The selection comes with the key, and its order is the list's, not the cursor's.
export async function cursor_message_id(scope: HandlerScope<FilterTermsApi>, ids: number[]): Promise<number> {
    if (ids.length === 1) return ids[0]!;
    const cursor_id = await cursor_row_message_id(scope);
    return cursor_id !== null && ids.includes(cursor_id) ? cursor_id : ids[0]!;
}

/** The `<...>` part of a List-Id header. RFC 2919 puts the id in angle brackets after an optional phrase, so the last such part is the id even when the phrase holds brackets. */
export function list_id_of(headers: Record<string, string[]>): string | undefined {
    const value = Object.entries(headers).find(([name]) => name.toLowerCase() === "list-id")?.[1]?.[0] ?? "";
    return [...value.matchAll(/<[^<>]+>/g)].at(-1)?.[0];
}

/** The term of `field` from the cursor message, or a refusal when that message has none. */
export async function message_term(scope: HandlerScope<FilterTermsApi>, ids: number[], field: MessageTermField): Promise<MessageTerms> {
    const id = await cursor_message_id(scope, ids);
    if (field === "date") return { date_us: (await scope.api.messages.get(id)).date.getTime() * 1000 };
    const list_id = list_id_of((await scope.api.messages.getFull(id)).headers ?? {});
    if (list_id === undefined) throw new RuntimeRefusal("The selected message is not from a mailing list.");
    return { list_id };
}

/** The `filter.set` call of the terms. */
export function filter_set_args(tab_id: number, terms: MessageTerms): FilterSetArgs {
    const args: FilterSetArgs = { tabId: tab_id };
    if (terms.list_id !== undefined) args.listId = terms.list_id;
    if (terms.date_us !== undefined) args.dateUs = terms.date_us;
    return args;
}
