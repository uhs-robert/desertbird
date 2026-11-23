// The add-on's own quick filter: a List-Id term and a same-day term, which `mailTabs.setQuickFilter` cannot set. It is a filter of Thunderbird's quick filter manager, so `F r` and the bar clear it with the others, and the bar counts it as active.
// Nothing here reads a Thunderbird global, so node tests drive it with fakes. `parent_filter.ts` passes the real manager and constants.

/** The filter's value in a tab's quick filter state. Thunderbird keeps the state as JSON, so it holds plain values only. */
export interface MessageFilterState {
    listId?: string;
    dateUs?: number;
}

export const MESSAGE_FILTER_NAME = "desertbird_by_message";

interface SearchValue {
    attrib: number;
    str: string;
    date: number;
}

interface SearchTerm {
    attrib: number;
    op: number;
    booleanAnd: boolean;
    arbitraryHeader: string;
    value: SearchValue;
}

interface TermCreator {
    createTerm(): SearchTerm;
}

/** The members of `Ci` the terms use. */
export interface SearchConstants {
    nsMsgSearchAttrib: { OtherHeader: number; Date: number };
    nsMsgSearchOp: { Contains: number; Is: number };
}

export interface QuickFilterManagerLike {
    filterDefsByName: Record<string, unknown>;
    defineFilter(definition: { name: string; appendTerms(creator: TermCreator, terms: SearchTerm[], state: MessageFilterState): void }): void;
    killFilter(name: string): void;
}

export interface QuickFilterBarLike {
    filterer: { visible: boolean; setFilterValue(name: string, value: MessageFilterState): void };
    reflectFiltererState(): void;
    updateSearch(): Promise<void>;
}

/** The `about:3pane` of a mail tab: its bar, the view that runs the search, and its timer. */
export interface FilterPaneLike {
    quickFilterBar?: QuickFilterBarLike;
    gViewWrapper?: { searching: boolean } | null;
    setTimeout(run: () => void, ms: number): unknown;
}

// A slow search (a large folder, a server search) ends the wait here, and the rows read later may still change.
export const SEARCH_WAIT_LIMIT_MS = 5000;
const SEARCH_POLL_MS = 10;

// A term's value is a copy: it takes effect only when assigned back.
function add_term(creator: TermCreator, terms: SearchTerm[], attrib: number, op: number, fill: (value: SearchValue) => void, header?: string): void {
    const term = creator.createTerm();
    term.attrib = attrib;
    term.op = op;
    term.booleanAnd = true;
    if (header !== undefined) term.arbitraryHeader = header;
    const value = term.value;
    value.attrib = attrib;
    fill(value);
    term.value = value;
    terms.push(term);
}

/** Builds the terms of one state. The quick filter ANDs them with the other filters. */
export function append_message_terms(constants: SearchConstants, creator: TermCreator, terms: SearchTerm[], state: MessageFilterState): void {
    const { nsMsgSearchAttrib: attrib, nsMsgSearchOp: op } = constants;
    if (state.listId !== undefined) add_term(creator, terms, attrib.OtherHeader, op.Contains, (value) => (value.str = state.listId!), "List-Id");
    // A date term compares local calendar days, not instants, so one `Is` term with the message's own date is the whole day (measured on Betterbird 153, midnight and daylight saving edges included).
    if (state.dateUs !== undefined) add_term(creator, terms, attrib.Date, op.Is, (value) => (value.date = state.dateUs!));
}

/** Defines the filter once per process. A second add-on load finds it gone, because `shutdown` removes it. */
export function define_message_filter(manager: QuickFilterManagerLike, constants: SearchConstants): void {
    if (MESSAGE_FILTER_NAME in manager.filterDefsByName) return;
    manager.defineFilter({ name: MESSAGE_FILTER_NAME, appendTerms: (creator, terms, state) => append_message_terms(constants, creator, terms, state) });
}

// `updateSearch` resolves once the search starts, and the rows change until `searching` turns false: 88 ms later on 10,000 messages (measured). The `/` count and commit read the rows right after the call, so the call ends with the search.
async function search_done(pane: FilterPaneLike): Promise<void> {
    for (let waited = 0; pane.gViewWrapper?.searching === true && waited < SEARCH_WAIT_LIMIT_MS; waited += SEARCH_POLL_MS) await new Promise<void>((resolve) => pane.setTimeout(resolve, SEARCH_POLL_MS));
}

/** Sets the filter's state in the bar, runs the search and waits for it to end. The bar must be visible, as `setQuickFilter` makes it, or the toggle stays unpressed and the count does not show. */
export async function show_message_filter(pane: FilterPaneLike, bar: QuickFilterBarLike, state: MessageFilterState): Promise<void> {
    bar.filterer.visible = true;
    bar.filterer.setFilterValue(MESSAGE_FILTER_NAME, state);
    bar.reflectFiltererState();
    await bar.updateSearch();
    await search_done(pane);
}
