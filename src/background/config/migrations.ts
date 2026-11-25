// Stored data carries a version. Each change to its shape adds one step here, so an installed copy keeps working after an update.

import { parse_sequence } from "../../../vendor/desertfox/keys/notation.ts";
import { SETTINGS_STORAGE_KEY } from "../../shared/protocol.ts";
import { TOAST_MAX_MS, TOAST_MIN_MS } from "./settings.ts";

export type StoredConfig = Record<string, unknown>;

const SETTINGS_KEY = SETTINGS_STORAGE_KEY;

/** Version 2 bounds the toast times and checks `which_key_skip`, which version 1 stored unchecked. A stored value that breaks the new rule would be dropped and reset to the default, so the toast times are clamped and rounded instead, and only the skip entries that are not key sequences go. */
const bound_settings: Migration = (stored) => {
    const settings = stored[SETTINGS_KEY];
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return stored;
    const next: Record<string, unknown> = { ...settings };
    for (const name of ["toast_ms", "toast_error_ms"]) {
        const value = next[name];
        if (typeof value === "number" && Number.isFinite(value)) next[name] = Math.min(TOAST_MAX_MS, Math.max(TOAST_MIN_MS, Math.round(value)));
    }
    const skip = next["which_key_skip"];
    if (Array.isArray(skip)) next["which_key_skip"] = skip.filter((entry) => typeof entry === "string" && parse_sequence(entry).error === undefined);
    return { ...stored, [SETTINGS_KEY]: next };
};

/** `MIGRATIONS[n]` turns data at version `n + 1` into version `n + 2`. Version 1 is the first shape, so the list starts empty. */
export type Migration = (stored: StoredConfig) => StoredConfig;
export const MIGRATIONS: readonly Migration[] = [bound_settings];

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
