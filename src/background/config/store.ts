// The settings and the user's key bindings in `storage.local`. The background page and the options page each build one store. The memory copy refills from storage and drops on `storage.onChanged`, so an edit from either side applies at once.

import { SETTINGS_STORAGE_KEY } from "../../shared/protocol.ts";
import type { Settings } from "./settings.ts";
import { sanitize_user_keymap } from "./keymap.ts";
import type { UserKeymap } from "./keymap.ts";
import { FIRST_VERSION, MIGRATIONS, migrate } from "./migrations.ts";
import type { Migration, StoredConfig } from "./migrations.ts";
import { sanitize_settings, settings_with_defaults } from "./settings.ts";

export const VERSION_KEY = "desertbird_config_version";
export const SETTINGS_KEY = SETTINGS_STORAGE_KEY;
export const USER_KEYMAP_KEY = "desertbird_user_keymap";
export const CONFIG_KEYS = [VERSION_KEY, SETTINGS_KEY, USER_KEYMAP_KEY];

export interface ConfigStorage {
    storage: {
        local: { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
        onChanged: { addListener(listener: (changes: Record<string, unknown>, area: string) => void): void };
    };
}

export interface Config {
    /** Only what the user changed. */
    setting_overrides: Partial<Settings>;
    /** Every setting: the overrides over the defaults. */
    settings: Settings;
    user_keymap: UserKeymap;
    /** The version stamp the data carries. Above `CONFIG_VERSION` means a newer add-on wrote it. */
    stored_version: number;
}

export interface ConfigStore {
    read(): Promise<Config>;
    write_settings(overrides: Partial<Settings>): Promise<void>;
    write_user_keymap(user_keymap: UserKeymap): Promise<void>;
}

export interface StoreOptions {
    migrations?: readonly Migration[];
    report?: (message: string) => void;
}

export function create_config_store(api: ConfigStorage, options: StoreOptions = {}): ConfigStore {
    const migrations = options.migrations ?? MIGRATIONS;
    const report = options.report ?? ((message: string) => console.warn(`desertbird config: ${message}`));
    let cached: Config | undefined;
    // Counts storage changes, so a read that began before a change never fills the copy with data older than the change.
    let generation = 0;

    api.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !CONFIG_KEYS.some((key) => key in changes)) return;
        generation++;
        cached = undefined;
    });

    // A write leaves the version key alone: the next read stamps it after any migration, and a newer add-on's stamp is never lowered.
    async function load(): Promise<Config> {
        const stored: StoredConfig = await api.storage.local.get(CONFIG_KEYS);
        const stamp = stored[VERSION_KEY];
        const from_version = typeof stamp === "number" && Number.isInteger(stamp) && stamp >= FIRST_VERSION ? stamp : FIRST_VERSION;
        const result = migrate(stored, from_version, migrations);
        // Only the version and the keys a migration changed go back. The rest was read before the await and an edit may have replaced it since.
        const changed_keys = CONFIG_KEYS.filter((key) => key !== VERSION_KEY && JSON.stringify(result.stored[key]) !== JSON.stringify(stored[key]));
        if (stamp !== result.version) {
            await api.storage.local.set({ ...Object.fromEntries(changed_keys.map((key) => [key, result.stored[key]])), [VERSION_KEY]: result.version });
        }
        const setting_overrides = sanitize_settings(result.stored[SETTINGS_KEY], report);
        return { setting_overrides, settings: settings_with_defaults(setting_overrides), user_keymap: sanitize_user_keymap(result.stored[USER_KEYMAP_KEY]), stored_version: result.version };
    }

    /** A newer add-on's data is only read. A write would put old-shape data under the newer stamp. */
    async function refuse_newer(): Promise<void> {
        const { stored_version } = await read();
        if (stored_version > migrations.length + 1) throw new Error("the settings were saved by a newer DesertBird and are read only");
    }

    const read = async (): Promise<Config> => {
        if (cached !== undefined) return cached;
        const started_at = generation;
        const config = await load();
        if (generation === started_at) cached = config;
        return config;
    };

    return {
        read,
        write_settings: async (overrides) => {
            await refuse_newer();
            await api.storage.local.set({ [SETTINGS_KEY]: overrides });
        },
        write_user_keymap: async (user_keymap) => {
            await refuse_newer();
            await api.storage.local.set({ [USER_KEYMAP_KEY]: user_keymap });
        },
    };
}
