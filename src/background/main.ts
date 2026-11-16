// Background entry. Compiles the default keymap once, keeps it in storage and hands it to the Experiment on every start.

import { COMPILED_KEYMAP_VERSION } from "../shared/protocol.ts";
import type { KeymapTree, KeysApi } from "../shared/protocol.ts";
import { DEFAULT_KEYMAP, compile_default_keymap } from "./default_keymap.ts";
import { notify_refusal } from "./notify.ts";
import { registry } from "./registry.ts";
import { create_router } from "./router.ts";
import type { RouterApi } from "./router.ts";

const KEYMAP_STORAGE_KEY = "desertbird_compiled_keymap";

/** Bumped when the stored record changes shape, so an old record is rebuilt and never read. */
const KEYMAP_RECORD_VERSION = 2;

interface KeymapRecord {
    record_version: number;
    /** The hash of `DEFAULT_KEYMAP` the tree was compiled from. A new add-on version with other default bindings rebuilds the tree. */
    source_hash: string;
    tree: KeymapTree;
}

interface StorageChange {
    newValue?: unknown;
}

interface Messenger extends Omit<RouterApi, "keys"> {
    storage: {
        local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
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

function compile_record(source_hash: string): KeymapRecord {
    const { compiled, warnings } = compile_default_keymap();
    for (const warning of warnings) console.warn(`desertbird keymap: ${warning}`);
    const root: KeymapTree["root"] = JSON.parse(JSON.stringify(compiled.modes.normal ?? { kind: "branch", children: {} }));
    return { record_version: KEYMAP_RECORD_VERSION, source_hash, tree: { version: COMPILED_KEYMAP_VERSION, root } };
}

// The memory copy only mirrors storage: it refills from storage and drops on `storage.onChanged`.
let cached_record: KeymapRecord | undefined;
// The tree last handed to the Experiment, as JSON. The add-on's own write fires `storage.onChanged` too, and that tree is already installed.
let installed_tree_json: string | undefined;

async function load_record(): Promise<KeymapRecord> {
    if (cached_record !== undefined) return cached_record;
    const source_hash = await hash_of(DEFAULT_KEYMAP);
    const stored = (await messenger.storage.local.get(KEYMAP_STORAGE_KEY))[KEYMAP_STORAGE_KEY];
    if (is_current_record(stored, source_hash)) return (cached_record = stored);
    const record = compile_record(source_hash);
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

const router = create_router(registry, { ...messenger, keys: messenger.keys });

messenger.keys?.onInvocation.addListener((invocation) => {
    router.run(invocation).catch(console.error);
});

messenger.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(KEYMAP_STORAGE_KEY in changes)) return;
    cached_record = undefined;
    queue_install(true);
});

queue_install(false);
