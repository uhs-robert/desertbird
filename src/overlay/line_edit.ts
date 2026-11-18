// The pure parts of the command line page: how a pick changes the text and how the highlight moves. The page file only reads events and draws.

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
export function enter_text(text: string, caret: number, answer: Answered, highlighted: number, previewed: boolean): string {
    if (previewed || answer.for_text !== text || answer.for_caret !== caret) return text;
    const row = answer.rows[shown_highlight(highlighted, answer.rows.length, answer.highlight_first)];
    return row === undefined ? text : apply_pick(text, { start: answer.start, end: answer.end, insert: row.insert }).text;
}

/** Waits until no newer refresh has started, so the answer in hand is for the text now in the line. */
export async function settle_latest(latest: () => Promise<unknown>): Promise<void> {
    let waited: Promise<unknown>;
    do {
        waited = latest();
        await waited.catch(() => undefined);
    } while (waited !== latest());
}

/** Runs each key after the keys queued before it, so held keys keep their order as in DesertFox. A failed key does not stop the keys after it. */
export function create_key_queue(): { add(run: () => Promise<void>): Promise<void>; done(): Promise<void> } {
    let tail: Promise<void> = Promise.resolve();
    return {
        add(run) {
            const ran = tail.then(run);
            tail = ran.catch(() => undefined);
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
