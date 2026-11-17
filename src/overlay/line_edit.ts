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

/** The next highlighted row, or -1 when there are no rows. The highlight wraps. From no highlight (-1), down goes to the first row and up to the last. */
export function move_highlight(current: number, step: 1 | -1, row_count: number): number {
    if (row_count === 0) return -1;
    if (current < 0) return step === 1 ? 0 : row_count - 1;
    return (current + step + row_count) % row_count;
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

export interface HistoryCursor {
    /** The older entry, or undefined at the oldest. `current` is the text in the line, kept as the draft on the first step back. */
    older(current: string): string | undefined;
    /** The newer entry, or the draft after the newest, or undefined when already at the draft. */
    newer(): string | undefined;
}

/** Walks `entries` (oldest first). The cursor lives for one open line. */
export function create_history_cursor(entries: readonly string[]): HistoryCursor {
    let position = entries.length;
    let draft = "";
    return {
        older(current) {
            if (position === 0) return undefined;
            if (position === entries.length) draft = current;
            position -= 1;
            return entries[position];
        },
        newer() {
            if (position >= entries.length) return undefined;
            position += 1;
            return position === entries.length ? draft : entries[position];
        },
    };
}

export const HISTORY_LIMIT = 100;

/** The history after a run: the line moves to the newest place, a repeat is not kept twice and the oldest fall off. A blank line adds nothing. */
export function record_entry(entries: readonly string[], line: string): string[] {
    const text = line.trim();
    if (text === "") return [...entries];
    return [...entries.filter((entry) => entry !== text), text].slice(-HISTORY_LIMIT);
}
