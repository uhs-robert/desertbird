// Background entry. Compiles the default keymap once, keeps it in storage and hands it to the Experiment on every start.

import { COMPILED_KEYMAP_VERSION } from "../shared/protocol.ts";
import type { KeymapTree, KeysApi } from "../shared/protocol.ts";
import { registry } from "./commands/index.ts";
import { compile_effective_keymap, effective_keymap } from "./config/keymap.ts";
import { SETTINGS_KEY, USER_KEYMAP_KEY, create_config_store } from "./config/store.ts";
import type { Config } from "./config/store.ts";
import { notify_refusal } from "./notify.ts";
import { create_router } from "./router.ts";
import { create_scheduler } from "./scheduler.ts";
import type { SchedulerApi } from "./scheduler.ts";
import type { RouterApi } from "./router.ts";

const KEYMAP_STORAGE_KEY = "desertbird_compiled_keymap";

/** Bumped when the stored record changes shape, so an old record is rebuilt and never read. */
const KEYMAP_RECORD_VERSION = 2;

interface KeymapRecord {
    record_version: number;
    /** The hash of the effective keymap (defaults plus user bindings) and the setting overrides the tree was compiled from. Other default bindings or an edit of the user bindings or settings rebuild the tree. */
    source_hash: string;
    tree: KeymapTree;
}

interface StorageChange {
    newValue?: unknown;
}

interface Messenger extends Omit<RouterApi, "keys">, Pick<SchedulerApi, "alarms"> {
    storage: {
        local: { get(key: string | string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
        onChanged: { addListener(listener: (changes: Record<string, StorageChange>, area: string) => void): void };
    };
    // The Experiment namespace is absent when it fails to load.
    keys?: KeysApi;
}

declare const messenger: Messenger;

async function hash_of(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function is_current_record(value: unknown, source_hash: string): value is KeymapRecord {
    const record = value as Partial<KeymapRecord> | null | undefined;
    return record?.record_version === KEYMAP_RECORD_VERSION && record.source_hash === source_hash && record.tree?.version === COMPILED_KEYMAP_VERSION;
}

function compile_record(source_hash: string, config: Config): KeymapRecord {
    const { compiled, warnings } = compile_effective_keymap(config.user_keymap, config.setting_overrides);
    for (const warning of warnings) console.warn(`desertbird keymap: ${warning}`);
    const root: KeymapTree["root"] = JSON.parse(JSON.stringify(compiled.modes.normal ?? { kind: "branch", children: {} }));
    return { record_version: KEYMAP_RECORD_VERSION, source_hash, tree: { version: COMPILED_KEYMAP_VERSION, root } };
}

// Registered before the listener below, so the store has dropped its copy by the time an install reads it.
const config_store = create_config_store(messenger);

// The memory copy only mirrors storage: it refills from storage and drops on `storage.onChanged`.
let cached_record: KeymapRecord | undefined;
// The tree last handed to the Experiment, as JSON. The add-on's own write fires `storage.onChanged` too, and that tree is already installed.
let installed_tree_json: string | undefined;

async function load_record(): Promise<KeymapRecord> {
    if (cached_record !== undefined) return cached_record;
    const config = await config_store.read();
    const source_hash = await hash_of({ keymap: effective_keymap(config.user_keymap), settings: config.setting_overrides });
    const stored = (await messenger.storage.local.get(KEYMAP_STORAGE_KEY))[KEYMAP_STORAGE_KEY];
    if (is_current_record(stored, source_hash)) return (cached_record = stored);
    const record = compile_record(source_hash, config);
    await messenger.storage.local.set({ [KEYMAP_STORAGE_KEY]: record });
    return (cached_record = record);
}

async function install_keymap(): Promise<void> {
    const keys = messenger.keys;
    if (keys === undefined) throw new Error("the DesertBird Experiment is not loaded");
    const { tree } = await load_record();
    const tree_json = JSON.stringify(tree);
    if (tree_json === installed_tree_json) return;
    await keys.install({ tree, settings: {} });
    installed_tree_json = tree_json;
}

function report_failure(error: unknown): void {
    console.error("desertbird:", error);
    notify_refusal(messenger, `DesertBird could not start its keys: ${error instanceof Error ? error.message : String(error)}`).catch(console.error);
}

// Installs run one at a time. Each one that follows a storage change drops the memory copy when it starts, so a read that began before the change cannot install or keep the old tree.
let install_queue: Promise<void> = Promise.resolve();
function queue_install(drop_cache: boolean): void {
    install_queue = install_queue
        .then(() => {
            if (drop_cache) cached_record = undefined;
            return install_keymap();
        })
        .catch(report_failure);
}

// Exported so a feature adds its `on_due` listener before `start` runs below.
export const scheduler = create_scheduler(messenger);

const router = create_router(registry, { ...messenger, keys: messenger.keys });

messenger.keys?.onInvocation.addListener((invocation) => {
    router.run(invocation).catch(console.error);
});

messenger.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(KEYMAP_STORAGE_KEY in changes || USER_KEYMAP_KEY in changes || SETTINGS_KEY in changes)) return;
    cached_record = undefined;
    queue_install(true);
});

queue_install(false);

scheduler.start().catch(console.error);
