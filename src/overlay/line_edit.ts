// The pure parts of the command line page: how a pick changes the text and how the highlight moves. The page file only reads events and draws.

import { keep_chain } from "../shared/swallow.ts";

export interface Pick {
    /** The span of the text the pick replaces. */
    start: number;
    end: number;
    insert: string;
}

/** The text after the pick and where the caret goes: just after what was inserted. */
export function apply_pick(text: string, pick: Pick): { text: string; caret: number } {
    return { text: text.slice(0, pick.start) + pick.insert + text.slice(pick.end), caret: pick.start + pick.insert.length };
}

/** The next highlighted row, or -1 when there are no rows. The highlight stops at the ends, as in DesertFox. From no highlight (-1), down goes to the first row and up to the last. */
export function move_highlight(current: number, step: 1 | -1, row_count: number): number {
    if (row_count === 0) return -1;
    if (current < 0) return step === 1 ? 0 : row_count - 1;
    return Math.min(row_count - 1, Math.max(0, current + step));
}

/** The row a cycle key (Tab, C-n, A-Down for step 1, S-Tab, C-p, A-Up for step -1) previews next. The saved list wraps, and from no row C-n starts at the first and C-p at the last. */
export function cycle_index(current: number, step: 1 | -1, row_count: number): number {
    if (row_count === 0) return -1;
    if (current < 0) return step === 1 ? 0 : row_count - 1;
    return (current + step + row_count) % row_count;
}

/** True when a cycle key puts the only row in the line for good: one row and none selected yet. With the row already selected, the key only previews it again. */
export function accepts_single_row(row_count: number, highlighted: number): boolean {
    return row_count === 1 && highlighted < 0;
}

/** The stored history as a list of lines. A failed read or data of another shape gives an empty list, so a broken store never stops the line. */
export async function read_history(get: () => Promise<unknown>): Promise<string[]> {
    try {
        const stored = await get();
        return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

/** Where Up and Down go. A fresh line (nothing typed, no completion key used) keeps them for the history, and so does a line with no rows. */
export function arrow_target(walking_history: boolean, row_count: number): "history" | "highlight" {
    return walking_history || row_count === 0 ? "history" : "highlight";
}

/** Splits a row name at the letters the query matched, so the page can mark them. */
export function name_parts(name: string, positions: readonly number[]): { text: string; matched: boolean }[] {
    const marked = new Set(positions);
    const parts: { text: string; matched: boolean }[] = [];
    [...name].forEach((character, index) => {
        const matched = marked.has(index);
        const last = parts.at(-1);
        if (last?.matched === matched) last.text += character;
        else parts.push({ text: character, matched });
    });
    return parts;
}

/** The row the page highlights: the one the user moved to, else the first when the completion asks for that, else none. */
export function shown_highlight(highlighted: number, row_count: number, highlight_first: boolean | undefined): number {
    if (highlighted >= 0) return highlighted;
    return highlight_first === true && row_count > 0 ? 0 : -1;
}

/** A completion answer with the text and caret it was computed for. */
export interface Answered {
    for_text: string;
    for_caret: number;
    rows: { insert: string }[];
    start: number;
    end: number;
    highlight_first?: boolean | undefined;
}

/** The text Enter runs. Enter takes the row the user moved to, else the first row when the completion asks for that, in place of the typed word. An answer for older text or another caret is ignored, because its span no longer fits the line. A row a row key already put in the line is in the text. */
export function enter_text(text: string, caret: number, answer: Answered, highlighted: number, previewed: boolean, list_shown = true): string {
    // A hidden list offers no row, so the typed text runs, as in DesertFox.
    if (!list_shown || previewed || answer.for_text !== text || answer.for_caret !== caret) return text;
    const row = answer.rows[shown_highlight(highlighted, answer.rows.length, answer.highlight_first)];
    return row === undefined ? text : apply_pick(text, { start: answer.start, end: answer.end, insert: row.insert }).text;
}

/** Waits until no newer refresh has started, so the answer in hand is for the text now in the line. */
export async function settle_latest(latest: () => Promise<unknown>): Promise<void> {
    let waited: Promise<unknown>;
    do {
        waited = latest();
        await keep_chain(waited);
    } while (waited !== latest());
}

/** Runs each key after the keys queued before it, so held keys keep their order as in DesertFox. A failed key does not stop the keys after it. */
export function create_key_queue(): { add(run: () => Promise<void>): Promise<void>; done(): Promise<void> } {
    let tail: Promise<void> = Promise.resolve();
    return {
        add(run) {
            const ran = tail.then(run);
            tail = keep_chain(ran);
            return ran;
        },
        done: () => tail,
    };
}

/** Whether the rows fit the line, waiting once for the newest answer when they do not. It checks only once more, because a failed request never brings rows for the line. */
export async function rows_fit_after_wait(fits: () => boolean, wait: () => Promise<void>): Promise<boolean> {
    if (fits()) return true;
    await wait();
    return fits();
}

/** The most rows the list draws. The ranked rows can be more, and the list shows a window of them. */
export const LIST_ROWS = 10;

/** Moves the window over the ranked rows the least that keeps the selected row inside it. A selected row of -1 keeps the window where it is. */
export function window_top(top: number, selected: number, row_count: number): number {
    const kept = selected < 0 ? top : selected < top ? selected : selected >= top + LIST_ROWS ? selected - LIST_ROWS + 1 : top;
    return Math.max(0, Math.min(kept, row_count - LIST_ROWS));
}

/** The width of the name column, in characters: the widest visible name, cut at 28 so one long name cannot take the row. */
export function name_width(names: readonly string[]): number {
    return Math.min(28, Math.max(0, ...names.map((name) => name.length)));
}

/** The prompt the line draws for the `cmdline_prompt` setting. `caret` is `> ` in the secondary color, `colon` is `:` in the primary color, and any other text is drawn as it is in the caret look. */
export function prompt_look(setting: string): { text: string; colon: boolean } {
    if (setting === "colon") return { text: ":", colon: true };
    return { text: setting === "caret" ? "> " : setting, colon: false };
}

/** What the note row says. A message (an error or a search count) wins. Otherwise a selected row gives its usage, then the usage of the typed command, and an empty list says so. */
export function note_text(message: string | undefined, selected_usage: string | undefined, typed_usage: string | undefined, row_count: number, line: string): string {
    if (message !== undefined) return message;
    if (selected_usage !== undefined) return selected_usage;
    if (typed_usage !== undefined) return typed_usage;
    return row_count === 0 && line.trim() !== "" ? "no match" : "";
}

const WHEEL_NOTCH_ROWS = 3;
const WHEEL_PAGE_ROWS = 10;
const WHEEL_MODE_LINE = 1;
const WHEEL_MODE_PAGE = 2;

/** Turns a wheel event into whole rows, negative up. A mouse notch moves 3 rows. A trackpad sends many small pixel deltas, so `state` keeps the remainder until it adds up to a row. */
export function wheel_rows(state: { remainder_px: number }, delta_y: number, delta_mode: number, row_height_px: number): number {
    if (delta_mode === WHEEL_MODE_LINE && Number.isInteger(delta_y)) return Math.sign(delta_y) * WHEEL_NOTCH_ROWS * Math.ceil(Math.abs(delta_y) / WHEEL_NOTCH_ROWS);
    const unit_px = delta_mode === WHEEL_MODE_PAGE ? row_height_px * WHEEL_PAGE_ROWS : delta_mode === WHEEL_MODE_LINE ? row_height_px : 1;
    const total_px = state.remainder_px + delta_y * unit_px;
    const rows = Math.trunc(total_px / row_height_px);
    state.remainder_px = total_px - rows * row_height_px;
    return rows;
}

/** Whether the list shows after a completion answer. An edit or row key that started the request after the last Escape shows it, and an Escape since the request keeps it hidden. `hides_since_request` counts the Escapes that hid the list. */
export function list_shown_after_answer(hides_at_request: number, hides_now: number, shown_now: boolean): boolean {
    return hides_at_request === hides_now || shown_now;
}

/** The row a click picks: the one it showed, and only while the rows on the page are still the ones that were drawn. Otherwise -1, and the click is dropped. */
export function row_for_click<Rows>(drawn: Rows, current: Rows, index: number, row_count: number): number {
    return drawn === current && index >= 0 && index < row_count ? index : -1;
}
