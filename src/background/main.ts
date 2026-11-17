// Background entry. Compiles the default keymap once, keeps it in storage and hands it to the Experiment on every start.

import { COMPILED_KEYMAP_VERSION, KEYMAP_STORAGE_KEY } from "../shared/protocol.ts";
import type { TreeBranch } from "../../vendor/desertfox/prefix_tree.ts";
import type { HudChanged, KeymapTree, KeysApi, OverlayApi } from "../shared/protocol.ts";
import { MESSAGE_KEYMAP, UNREPEATABLE_IDS, compile_message_keymap, message_background_commands, registry } from "./commands/index.ts";
import { create_cmdline_service } from "./cmdline/service.ts";
import { NORMAL_MODE, create_hud_service } from "./hud/service.ts";
import { compile_effective_keymap, effective_keymap, mark_unrepeatable } from "./config/keymap.ts";
import { SETTINGS_KEY, USER_KEYMAP_KEY, create_config_store } from "./config/store.ts";
import type { Config } from "./config/store.ts";
import type { CompileResult } from "../../vendor/desertfox/keys/compiler.ts";
import { start_jump_history } from "./handlers/jump_history.ts";
import { create_body_requests } from "./body_requests.ts";
import type { BodyRequestApi } from "./body_requests.ts";
import { notify_refusal } from "./notify.ts";
import { create_new_mail_notifier } from "./new_mail_notify.ts";
import type { NewMailApi } from "./new_mail_notify.ts";
import { create_router } from "./router.ts";
import { fire_followup, open_followup_anchor, past_start_grace } from "./handlers/followup.ts";
import type { FollowupOpenApi } from "./handlers/followup.ts";
import { wake_snoozed } from "./handlers/snooze.ts";
import { create_scheduler } from "./scheduler.ts";
import type { SchedulerApi } from "./scheduler.ts";
import { create_quick_reply_store } from "./quick_reply_store.ts";
import { create_followup_store } from "./followup_store.ts";
import { create_snooze_store } from "./snooze_store.ts";
import type { RouterApi } from "./router.ts";

/** The wait for a server to confirm a new folder. A server that refuses the create never answers. */
const CREATE_FOLDER_TIMEOUT_MS = 10_000;

/** Bumped when the stored record changes shape, so an old record is rebuilt and never read. */
const KEYMAP_RECORD_VERSION = 4;

interface KeymapRecord {
    record_version: number;
    /** The hash of the effective keymap (defaults plus user bindings), the message keys and the setting overrides the tree was compiled from. Other default bindings or an edit of the user bindings or settings rebuild the tree. */
    source_hash: string;
    tree: KeymapTree;
    /** The keys of the message document. The Experiment never sees it: the body script reads it from storage. */
    message_tree: KeymapTree;
}

interface StorageChange {
    newValue?: unknown;
}

interface Messenger extends Omit<RouterApi, "keys" | "overlay" | "cmdline" | "snooze" | "quick_replies" | "followup" | "windows">, Pick<SchedulerApi, "alarms">, Pick<BodyRequestApi, "messageDisplay"> {
    windows: BodyRequestApi["windows"] &
        RouterApi["windows"] & {
            getAll(query: { windowTypes: string[] }): Promise<{ id?: number }[]>;
            onCreated: { addListener(listener: (window: { id?: number; type?: string }) => void): void };
            onRemoved: { addListener(listener: (window_id: number) => void): void };
            /** Fires with -1 when no window of the application has the focus. */
            onFocusChanged: { addListener(listener: (window_id: number) => void): void };
        };
    tabs: { onActivated: { addListener(listener: () => void): void } };
    messages: RouterApi["messages"] & NewMailApi["messages"];
    notifications: RouterApi["notifications"] & NewMailApi["notifications"] & { onClicked: { addListener(listener: (notification_id: string) => void): void } };
    messageDisplay: BodyRequestApi["messageDisplay"] & NewMailApi["messageDisplay"] & FollowupOpenApi["messageDisplay"];
    runtime: {
        onMessage: { addListener(listener: (message: unknown, sender: { tab?: { id?: number; windowId?: number } }) => Promise<unknown> | undefined): void };
        sendMessage(message: HudChanged): Promise<unknown>;
    };
    storage: {
        local: { get(key: string | string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
        onChanged: { addListener(listener: (changes: Record<string, StorageChange>, area: string) => void): void };
    };
    // The Experiment namespace is absent when it fails to load.
    keys?: KeysApi;
    overlay?: OverlayApi;
}

declare const messenger: Messenger;

// The commands that open the overlay. The registry says so through `needs`, so the key runtime learns "these take the keyboard" and no command name.
const HOLD_COMMANDS = registry.list().filter((command) => command.needs?.includes("overlay.mount")).map((command) => command.id);

async function hash_of(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function is_current_record(value: unknown, source_hash: string): value is KeymapRecord {
    const record = value as Partial<KeymapRecord> | null | undefined;
    return record?.record_version === KEYMAP_RECORD_VERSION && record.source_hash === source_hash && record.tree?.version === COMPILED_KEYMAP_VERSION && record.message_tree?.version === COMPILED_KEYMAP_VERSION;
}

function tree_of(result: CompileResult): KeymapTree {
    for (const warning of result.warnings) console.warn(`desertbird keymap: ${warning}`);
    const root: KeymapTree["root"] = JSON.parse(JSON.stringify(result.compiled.modes.normal ?? { kind: "branch", children: {} }));
    mark_unrepeatable(root as object);
    return { version: COMPILED_KEYMAP_VERSION, root };
}

function compile_record(source_hash: string, config: Config): KeymapRecord {
    return { record_version: KEYMAP_RECORD_VERSION, source_hash, tree: tree_of(compile_effective_keymap(config.user_keymap, config.setting_overrides)), message_tree: tree_of(compile_message_keymap()) };
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
    const source_hash = await hash_of({ keymap: effective_keymap(config.user_keymap), message: MESSAGE_KEYMAP, unrepeatable: [...UNREPEATABLE_IDS], settings: config.setting_overrides });
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
    await keys.install({ tree, settings: {}, holdCommands: HOLD_COMMANDS });
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

// A feature adds its `on_due` listener here in main.ts, before the `start` call at the end.
const scheduler = create_scheduler(messenger);
// One store instance for the whole page: each instance keeps its own write queue and memory copy.
const snoozes = create_snooze_store(messenger);
scheduler.on_due((now_ms) => snoozes.wake_due(now_ms, (item) => wake_snoozed(messenger, item)));
const followups = create_followup_store(messenger);
const started_ms = Date.now();
// Follow-ups wait out the grace after start, so the folders have synced before a reply is looked for. The minute alarm then picks them up.
scheduler.on_due((now_ms) => (past_start_grace(started_ms, now_ms) ? followups.fire_due(now_ms, (item, still_wanted) => fire_followup(messenger, item, still_wanted)) : undefined));
messenger.notifications.onClicked.addListener((id) => {
    open_followup_anchor(messenger, id).catch(console.error);
});

// The hud shows the which-key panel, the toasts and the mode badge. Its state is a few seconds of interface state per window and lives in memory only, like the command line session.
const NO_WINDOW = -1;
const hud = create_hud_service({
    overlay: messenger.overlay,
    read_settings: async () => (await config_store.read()).settings,
    read_root: async () => (await load_record()).tree.root as TreeBranch,
    send_changed: (windowId) => void messenger.runtime.sendMessage({ type: "hud.changed", windowId }).catch(() => {}),
    mode_of: () => NORMAL_MODE,
    timers: { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
});

// The service and the router refer to each other: the line runs its command through the router, and the open key stores a session in the service.
const cmdline = create_cmdline_service({
    registry,
    sources: {
        folders: async () => [...new Set((await messenger.folders.query({})).map((folder) => folder.path))].sort(),
        tags: async () => (await messenger.messages.tags.list()).map((entry) => entry.tag),
    },
    overlay: messenger.overlay,
    run: (invocation) => router.run(invocation),
});
const router = create_router(registry, { ...messenger, keys: messenger.keys, overlay: messenger.overlay, cmdline, toasts: hud, quick_replies: create_quick_reply_store(messenger), snooze: { items: snoozes, now: () => new Date(), create_timeout_ms: CREATE_FOLDER_TIMEOUT_MS }, followup: { items: followups, now: () => new Date() } });

const body_requests = create_body_requests({ registry, api: messenger, allowed: message_background_commands(), run: (invocation) => router.run(invocation) });

messenger.runtime.onMessage.addListener((message, sender) => cmdline.handle(message) ?? hud.handle(message) ?? body_requests(message, sender));
// A surface left a window on its own (a tab change or a closed window), so its state for that window is dropped.
messenger.overlay?.onClosed.addListener(({ windowId, surface }) => (surface === "cmdline" ? cmdline.end(windowId) : hud.forget(windowId)));

start_jump_history(messenger);

// Top level, so each page start registers the listeners again.
create_new_mail_notifier(messenger, async () => (await config_store.read()).settings.notify_new_mail).register();

messenger.keys?.onInvocation.addListener((event) => {
    if ("keys" in event) hud.on_keys_event(event).catch(console.error);
    else router.run(event).catch(console.error);
});

// A half-typed sequence the key runtime cannot see end: a tab change, or the window losing the focus.
messenger.tabs.onActivated.addListener(() => hud.close_which_key());
messenger.windows.onFocusChanged.addListener((window_id) => hud.close_which_key(window_id === NO_WINDOW ? undefined : window_id));

const track_window = (window: { id?: number; type?: string }) => {
    if (window.id !== undefined && (window.type === undefined || window.type === "normal")) hud.track(window.id).catch(console.error);
};
messenger.windows.onCreated.addListener(track_window);
messenger.windows.onRemoved.addListener((window_id) => hud.forget(window_id));
messenger.windows.getAll({ windowTypes: ["normal"] }).then((open) => open.forEach(track_window), console.error);

messenger.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(KEYMAP_STORAGE_KEY in changes || USER_KEYMAP_KEY in changes || SETTINGS_KEY in changes)) return;
    cached_record = undefined;
    queue_install(true);
});

// Registered after the config store's own listener, so the settings are refilled by the time the hud reads them.
messenger.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && SETTINGS_KEY in changes) hud.settings_changed().catch(console.error);
});

queue_install(false);

scheduler.start().catch(console.error);
