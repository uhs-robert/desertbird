// Background entry. Compiles the default keymap once, keeps it in storage and hands it to the Experiment on every start.

import { COMPILED_KEYMAP_VERSION } from "../shared/protocol.ts";
import type { KeymapTree, KeysApi, ViewApi } from "../shared/protocol.ts";
import { compile_default_keymap } from "./default_keymap.ts";
import { notify_refusal } from "./notify.ts";
import { registry } from "./registry.ts";
import { create_router } from "./router.ts";
import type { RouterApi } from "./router.ts";

const KEYMAP_STORAGE_KEY = "desertbird_compiled_keymap";

/** Bumped when the stored record changes shape, so an old record is rebuilt and never read. */
const KEYMAP_RECORD_VERSION = 1;

interface KeymapRecord {
    record_version: number;
    tree: KeymapTree;
}

interface StorageChange {
    newValue?: unknown;
}

interface Messenger extends Omit<RouterApi, "view"> {
    storage: {
        local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
        onChanged: { addListener(listener: (changes: Record<string, StorageChange>, area: string) => void): void };
    };
    // The Experiment namespaces are absent when it fails to load.
    keys?: KeysApi;
    view?: ViewApi;
}

declare const messenger: Messenger;

function is_current_record(value: unknown): value is KeymapRecord {
    const record = value as Partial<KeymapRecord> | null | undefined;
    return record?.record_version === KEYMAP_RECORD_VERSION && record.tree?.version === COMPILED_KEYMAP_VERSION;
}

function compile_record(): KeymapRecord {
    const { compiled, warnings } = compile_default_keymap();
    for (const warning of warnings) console.warn(`desertbird keymap: ${warning}`);
    const root: KeymapTree["root"] = JSON.parse(JSON.stringify(compiled.modes.normal ?? { kind: "branch", children: {} }));
    return { record_version: KEYMAP_RECORD_VERSION, tree: { version: COMPILED_KEYMAP_VERSION, root } };
}

// The memory copy only mirrors storage: it refills from storage and drops on `storage.onChanged`.
let cached_record: KeymapRecord | undefined;

async function load_record(): Promise<KeymapRecord> {
    if (cached_record !== undefined) return cached_record;
    const stored = (await messenger.storage.local.get(KEYMAP_STORAGE_KEY))[KEYMAP_STORAGE_KEY];
    if (is_current_record(stored)) return (cached_record = stored);
    const record = compile_record();
    await messenger.storage.local.set({ [KEYMAP_STORAGE_KEY]: record });
    return (cached_record = record);
}

async function install_keymap(): Promise<void> {
    const keys = messenger.keys;
    if (keys === undefined) throw new Error("the DesertBird Experiment is not loaded");
    const { tree } = await load_record();
    await keys.install({ tree, settings: {} });
}

function report_failure(error: unknown): void {
    console.error("desertbird:", error);
    notify_refusal(messenger, `DesertBird could not start its keys: ${error instanceof Error ? error.message : String(error)}`).catch(console.error);
}

const router = create_router(registry, { ...messenger, view: messenger.view });

messenger.keys?.onInvocation.addListener((invocation) => {
    router.run(invocation).catch(console.error);
});

messenger.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(KEYMAP_STORAGE_KEY in changes)) return;
    cached_record = undefined;
    install_keymap().catch(report_failure);
});

install_keymap().catch(report_failure);
