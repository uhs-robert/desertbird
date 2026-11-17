// A versioned record in `storage.local` with a memory copy that mirrors it. Used by the snooze store and meant for the follow-up reminders.

export interface RecordStorageApi {
    storage: {
        local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
        onChanged: { addListener(listener: (changes: Record<string, unknown>, area: string) => void): void };
    };
}

export interface RecordStoreConfig<T> {
    key: string;
    /** What a missing or unreadable record reads as. Called on every use, so a caller never shares the object. */
    empty: () => T;
    /** Turns a stored value of any version into the current shape, or returns undefined when it cannot. The place to upgrade old records. */
    migrate: (stored: unknown) => T | undefined;
}

export interface RecordStore<T> {
    read(): Promise<T>;
    /** Reads storage afresh, applies `change` and writes the result. Updates and reads run one at a time, so two quick updates never lose a write. */
    update<R = void>(change: (value: T) => { value: T; result: R }): Promise<R>;
}

export function create_record_store<T>(api: RecordStorageApi, config: RecordStoreConfig<T>): RecordStore<T> {
    let cached: T | undefined;
    let queue: Promise<unknown> = Promise.resolve();

    api.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && config.key in changes) cached = undefined;
    });

    const load = async (): Promise<T> => config.migrate((await api.storage.local.get(config.key))[config.key]) ?? config.empty();
    // A failed step must not block the steps behind it.
    const run = <R>(step: () => Promise<R>): Promise<R> => {
        const result = queue.then(step);
        queue = result.catch(() => {});
        return result;
    };

    return {
        read: () => run(async () => (cached ??= await load())),
        update: (change) =>
            run(async () => {
                const { value, result } = change(await load());
                await api.storage.local.set({ [config.key]: value });
                cached = value;
                return result;
            }),
    };
}
