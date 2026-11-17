// The command line history in storage.local: the background writes it when a line runs, and the page only reads it.

import { CMDLINE_HISTORY_STORAGE_KEY } from "../../shared/protocol.ts";

export const HISTORY_LIMIT = 100;

/** The history after a run: the line moves to the newest place, a repeat is not kept twice and the oldest fall off. A blank line adds nothing. */
export function record_entry(entries: readonly string[], line: string): string[] {
    const text = line.trim();
    if (text === "") return [...entries];
    return [...entries.filter((entry) => entry !== text), text].slice(-HISTORY_LIMIT);
}

export interface HistoryStorage {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
}

export interface CmdlineHistory {
    /** Adds the line. The writes run one after another, each reading what the one before wrote, so two lines recorded together both stay. A failed write rejects its own call and lets the next one run. */
    record(line: string): Promise<void>;
}

export function create_cmdline_history(storage: HistoryStorage): CmdlineHistory {
    let last_write: Promise<void> = Promise.resolve();
    return {
        record(line) {
            const written = last_write.then(async () => {
                const stored = (await storage.get(CMDLINE_HISTORY_STORAGE_KEY))[CMDLINE_HISTORY_STORAGE_KEY];
                const entries = Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : [];
                await storage.set({ [CMDLINE_HISTORY_STORAGE_KEY]: record_entry(entries, line) });
            });
            last_write = written.catch(() => undefined);
            return written;
        },
    };
}
