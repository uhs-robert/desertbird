// Stored data carries a version. Each change to its shape adds one step here, so an installed copy keeps working after an update.

export type StoredConfig = Record<string, unknown>;

/** `MIGRATIONS[n]` turns data at version `n + 1` into version `n + 2`. Version 1 is the first shape, so the list starts empty. */
export type Migration = (stored: StoredConfig) => StoredConfig;
export const MIGRATIONS: readonly Migration[] = [];

export const CONFIG_VERSION = MIGRATIONS.length + 1;

/** A record with no version key is version 1: the key came with the first shape. */
export const FIRST_VERSION = 1;

export interface MigrationResult {
    stored: StoredConfig;
    /** The version the data ends at. A version above `target` means a newer add-on wrote it: the data stays as it is. */
    version: number;
    changed: boolean;
}

export function migrate(stored: StoredConfig, from_version: number, migrations: readonly Migration[] = MIGRATIONS): MigrationResult {
    const target = migrations.length + 1;
    if (from_version >= target) return { stored, version: from_version, changed: false };
    let current = stored;
    for (let version = from_version; version < target; version++) current = migrations[version - 1]!(current);
    return { stored: current, version: target, changed: true };
}
