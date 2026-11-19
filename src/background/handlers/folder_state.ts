// The one stored record of the folder commands: marks and the jump history. Reads and writes go through a queue, so two jumps in a row (a held <C-o>) and the display events that follow them never overwrite each other.

import { keep_chain } from "../../shared/swallow.ts";

export interface FolderRef {
    account_id: string;
    path: string;
}

export interface JumpHistory {
    entries: FolderRef[];
    /** Index of the entry the view sits on, -1 while the history is empty. */
    cursor: number;
}

export interface FolderState {
    record_version: number;
    marks: Record<string, FolderRef>;
    history: JumpHistory;
}

export interface FolderStateApi {
    storage: {
        local: {
            get(key: string): Promise<Record<string, unknown>>;
            set(items: Record<string, unknown>): Promise<void>;
        };
    };
}

export const FOLDER_STATE_KEY = "desertbird_folder_state";
export const FOLDER_STATE_VERSION = 1;

type Migration = (record: Record<string, unknown>) => Record<string, unknown>;

/** Entry n turns a version n record into a version n + 1 record. A change to the record shape adds an entry here and raises `FOLDER_STATE_VERSION`. */
export const FOLDER_STATE_MIGRATIONS: Record<number, Migration> = {};

export const empty_folder_state = (): FolderState => ({ record_version: FOLDER_STATE_VERSION, marks: {}, history: { entries: [], cursor: -1 } });

const is_object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const is_folder_ref = (value: unknown): value is FolderRef => is_object(value) && typeof value.account_id === "string" && typeof value.path === "string";

function is_folder_state(value: Record<string, unknown>): value is Record<string, unknown> & FolderState {
    const { marks, history } = value;
    if (!is_object(marks) || !Object.values(marks).every(is_folder_ref) || !is_object(history)) return false;
    const { entries, cursor } = history;
    return Array.isArray(entries) && entries.every(is_folder_ref) && Number.isInteger(cursor) && (cursor as number) >= -1 && (cursor as number) < entries.length;
}

/** Brings a stored value to the current shape. A value that is missing, damaged, of a version with no migration path, or from a newer add-on reads as an empty state. */
export function migrate_folder_state(stored: unknown, migrations: Record<number, Migration> = FOLDER_STATE_MIGRATIONS, current = FOLDER_STATE_VERSION): FolderState {
    if (!is_object(stored) || !Number.isInteger(stored.record_version)) return empty_folder_state();
    let record: Record<string, unknown> = stored;
    for (let version = record.record_version as number; version < current; version++) {
        const migrate = migrations[version];
        if (migrate === undefined) return empty_folder_state();
        record = { ...migrate(record), record_version: version + 1 };
    }
    return record.record_version === current && is_folder_state(record) ? record : empty_folder_state();
}

// A queue per storage area: the add-on has one storage, and a test brings its own.
const queues = new WeakMap<object, Promise<unknown>>();

/** Reads the state, runs the task on it and stores the state the task returns. A task that returns nothing or throws stores nothing. Tasks run one at a time. */
export function modify_folder_state<T>(api: FolderStateApi, task: (state: FolderState) => Promise<{ state?: FolderState; result: T }>): Promise<T> {
    const area = api.storage.local;
    const run = (queues.get(area) ?? Promise.resolve()).then(async () => {
        const state = migrate_folder_state((await area.get(FOLDER_STATE_KEY))[FOLDER_STATE_KEY]);
        const { state: next, result } = await task(state);
        if (next !== undefined) await area.set({ [FOLDER_STATE_KEY]: next });
        return result;
    });
    // A failed task ends only its own caller's promise.
    queues.set(area, keep_chain(run));
    return run;
}

export async function read_folder_state(api: FolderStateApi): Promise<FolderState> {
    return modify_folder_state(api, async (state) => ({ result: state }));
}
