// The settings and the user's key bindings in `storage.local`. The background page and the options page each build one store. The memory copy refills from storage and drops on `storage.onChanged`, so an edit from either side applies at once.

import type { Settings } from "../../../vendor/desertfox/config.ts";
import { sanitize_user_keymap } from "./keymap.ts";
import type { UserKeymap } from "./keymap.ts";
import { FIRST_VERSION, MIGRATIONS, migrate } from "./migrations.ts";
import type { Migration, StoredConfig } from "./migrations.ts";
import { sanitize_settings, settings_with_defaults } from "./settings.ts";

export const VERSION_KEY = "desertbird_config_version";
export const SETTINGS_KEY = "desertbird_settings";
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
        const from_version = typeof stored[VERSION_KEY] === "number" ? stored[VERSION_KEY] : FIRST_VERSION;
        const result = migrate(stored, from_version, migrations);
        if (result.changed || stored[VERSION_KEY] === undefined) {
            await api.storage.local.set({ ...result.stored, [VERSION_KEY]: result.version });
        }
        const setting_overrides = sanitize_settings(result.stored[SETTINGS_KEY], report);
        return { setting_overrides, settings: settings_with_defaults(setting_overrides), user_keymap: sanitize_user_keymap(result.stored[USER_KEYMAP_KEY]) };
    }

    return {
        async read() {
            if (cached !== undefined) return cached;
            const started_at = generation;
            const config = await load();
            if (generation === started_at) cached = config;
            return config;
        },
        write_settings: (overrides) => api.storage.local.set({ [SETTINGS_KEY]: overrides}),
        write_user_keymap: (user_keymap) => api.storage.local.set({ [USER_KEYMAP_KEY]: user_keymap}),
    };
}
