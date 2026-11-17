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
