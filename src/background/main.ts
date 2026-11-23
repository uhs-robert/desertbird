// Background entry. Compiles the default keymap once, keeps it in storage and hands it to the Experiment on every start.

import { COMPILED_KEYMAP_VERSION, KEYMAP_STORAGE_KEY, SEARCH_HISTORY_STORAGE_KEY } from "../shared/protocol.ts";
import type { KeyTrees } from "./cmdline/completion.ts";
import type { TreeBranch } from "../../vendor/desertfox/prefix_tree.ts";
import type { AppApi, ComposewinApi, HintsApi, HudChanged, KeymapTree, KeysApi, KeysEvent, OverlayApi, PagesApi } from "../shared/protocol.ts";
import { KEEPS_SELECTION_IDS, UNREPEATABLE_IDS, hold_command_ids, registry } from "./commands/index.ts";
import { COMPOSE_COMMANDS, compile_tab_keymap, compile_typing_keymap, keymap_of, message_background_commands, page_message_tree } from "./commands/tab_keymaps.ts";
import { record_activation, tab_choices } from "./handlers/tabs.ts";
import type { TabsApi } from "./handlers/tabs.ts";
import { create_folder_source } from "./cmdline/folder_rows.ts";
import { create_cmdline_history } from "./cmdline/history.ts";
import { create_cmdline_service } from "./cmdline/service.ts";
import { create_widget_reader } from "./cmdline/status_widgets.ts";
import { create_hud_service, lifting_toasts } from "./hud/service.ts";
import { MESSAGE_WINDOW_TYPE } from "./window_types.ts";
import { keep_filters } from "./handlers/view.ts";
import { create_search_register } from "./search/register.ts";
import { create_search_service } from "./search/service.ts";
import { mode_label_colors, resolve_theme } from "./theme/palette.ts";
import { publish_theme } from "./theme/publish.ts";
import { themed_hints } from "./theme/themed_hints.ts";
import { write_to_clipboard } from "./handlers/clipboard.ts";
import { compile_effective_keymap, effective_keymap, mark_steps } from "./config/keymap.ts";
import { SETTINGS_KEY, USER_KEYMAP_KEY, create_config_store } from "./config/store.ts";
import type { Config } from "./config/store.ts";
import type { CompileResult } from "../../vendor/desertfox/keys/compiler.ts";
import { start_jump_history } from "./handlers/jump_history.ts";
import { create_body_requests } from "./body_requests.ts";
import { create_popup_requests, POPUP_PAGE } from "./popup_requests.ts";
import type { BodyRequestApi } from "./body_requests.ts";
import { notify_refusal, notify_result } from "./notify.ts";
import { create_new_mail_notifier } from "./new_mail_notify.ts";
import type { NewMailApi } from "./new_mail_notify.ts";
import { create_router } from "./router.ts";
import { fire_followup, open_followup_anchor, past_start_grace } from "./handlers/followup.ts";
import type { FollowupOpenApi } from "./handlers/followup.ts";
import { wake_snoozed } from "./handlers/snooze.ts";
import { read_folder_state } from "./handlers/folder_state.ts";
import { create_scheduler } from "./scheduler.ts";
import type { SchedulerApi } from "./scheduler.ts";
import { create_quick_reply_store } from "./quick_reply_store.ts";
import { create_followup_store } from "./followup_store.ts";
import { create_snooze_store } from "./snooze_store.ts";
import { create_undo_log } from "./undo_log.ts";
import type { RouterApi } from "./router.ts";
import { create_bridge_run, list_bridge_commands } from "./bridge/run.ts";
import { BRIDGE_HOST_NAME, create_bridge_port } from "./bridge/port.ts";
import type { NativePort } from "./bridge/port.ts";
import { create_bridge_reads } from "./bridge/reads.ts";
import { create_confirm_service } from "./bridge/confirm.ts";
import type { ReadsApi } from "./bridge/reads.ts";
import { create_bridge_drafts } from "./bridge/drafts.ts";
import { create_bridge_acts } from "./bridge/acts.ts";
import type { ActsApi } from "./bridge/acts.ts";
import type { DraftsApi } from "./bridge/drafts.ts";
import { create_compose_markdown } from "./compose_markdown.ts";
import type { MarkdownGlobals } from "./compose_markdown.ts";
import { EDITOR_HOST_NAME, create_compose_requests, create_editor_client, create_external_editor } from "./external_editor.ts";
import { best_effort, ignore_refusal, refused_as } from "../shared/swallow.ts";

/** The wait for a server to confirm a new folder. A server that refuses the create never answers. */
const CREATE_FOLDER_TIMEOUT_MS = 10_000;

/** The waits before each new lookup of a message an undo cannot find yet. An IMAP server shows a moved copy only after a sync. */
const UNDO_RETRY_DELAYS_MS = [500, 1000, 1500];

/** Bumped when the stored record changes shape, so an old record is rebuilt and never read. */
// The record is derived from the user's keymap and the source hash, and an old record is rebuilt on read, so the bump moves no user data.
const KEYMAP_RECORD_VERSION = 16;

interface KeymapRecord {
    record_version: number;
    /** The hash of the effective keymap (defaults plus user bindings), the message keys and the setting overrides the tree was compiled from. Other default bindings or an edit of the user bindings or settings rebuild the tree. */
    source_hash: string;
    tree: KeymapTree;
    /** The keys of the message document. The Experiment never sees it: the body script reads it from storage. */
    message_tree: KeymapTree;
    /** The keys of a message window (message mode): the message keys without the tab, pane and command line keys. Its body script reads it from storage, and the `pages` Experiment installs it for the header. */
    window_tree: KeymapTree;
    /** The keys of the tabs that are not the mail tab. The `pages` Experiment installs it. */
    page_tree: KeymapTree;
    /** The keys of DesertBird's own pages (options, help): the page keys with find and hints. Their body script reads it from storage. */
    own_tree: KeymapTree;
    /** The keys of a compose window in normal mode. The `composewin` Experiment installs it. */
    compose_tree: KeymapTree;
    /** The keys that run while a text field has the focus. The `pages` Experiment installs it, and it also serves the text fields of the mail tab. */
    typing_tree: KeymapTree;
}

interface StorageChange {
    newValue?: unknown;
}

interface Messenger extends Omit<RouterApi, "keys" | "app" | "overlay" | "cmdline" | "snooze" | "quick_replies" | "followup" | "undo" | "windows">, Pick<SchedulerApi, "alarms">, Pick<BodyRequestApi, "messageDisplay"> {
    windows: BodyRequestApi["windows"] &
        RouterApi["windows"] & {
            getAll(query: { windowTypes: string[] }): Promise<{ id?: number }[]>;
            onCreated: { addListener(listener: (window: { id?: number; type?: string }) => void): void };
            onRemoved: { addListener(listener: (window_id: number) => void): void };
            getLastFocused(query: { windowTypes: string[] }): Promise<{ id?: number; type?: string }>;
            /** Fires with -1 when no window of the application has the focus. */
            onFocusChanged: { addListener(listener: (window_id: number) => void): void };
        };
    tabs: Pick<TabsApi["tabs"], "query"> & {
        get(tab_id: number): Promise<unknown>;
        onActivated: { addListener(listener: (info: { windowId: number; previousTabId?: number }) => void): void };
        onRemoved: { addListener(listener: (tab_id: number) => void): void };
    };
    compose: RouterApi["compose"] & { onAfterSend: { addListener(listener: (tab: { id?: number }, send_info: { error?: string }) => void): void } };
    composeScripts: { register(script: { js: { file: string }[] }): Promise<unknown> };
    messages: RouterApi["messages"] & NewMailApi["messages"];
    mailTabs: RouterApi["mailTabs"] & { get(tab_id: number): Promise<{ displayedFolder?: { id: string } | null }> };
    notifications: RouterApi["notifications"] & NewMailApi["notifications"] & { onClicked: { addListener(listener: (notification_id: string) => void): void } };
    messageDisplay: BodyRequestApi["messageDisplay"] & NewMailApi["messageDisplay"] & FollowupOpenApi["messageDisplay"];
    runtime: {
        onMessage: { addListener(listener: (message: unknown, sender: { tab?: { id?: number; windowId?: number }; url?: string }) => Promise<unknown> | undefined): void };
        getURL(path: string): string;
        sendMessage(message: HudChanged): Promise<unknown>;
        connectNative(application: string): NativePort;
        sendNativeMessage(application: string, message: object): Promise<unknown>;
    };
    storage: {
        local: { get(key: string | string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
        session?: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
        onChanged: { addListener(listener: (changes: Record<string, StorageChange>, area: string) => void): void };
    };
    // The Experiment namespace is absent when it fails to load.
    keys?: KeysApi;
    app?: AppApi;
    overlay?: OverlayApi;
    pages?: PagesApi;
    composewin?: ComposewinApi;
    hints?: HintsApi;
}

declare const messenger: Messenger;

// The commands after which the key runtime holds plain keys. The registry says so through `needs`, so the runtime learns "these take the keyboard" and no command name.
const HOLD_COMMANDS = hold_command_ids();

async function hash_of(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function is_current_record(value: unknown, source_hash: string): value is KeymapRecord {
    const record = value as Partial<KeymapRecord> | null | undefined;
    return record?.record_version === KEYMAP_RECORD_VERSION && record.source_hash === source_hash && record.tree?.version === COMPILED_KEYMAP_VERSION && record.message_tree?.version === COMPILED_KEYMAP_VERSION && record.window_tree?.version === COMPILED_KEYMAP_VERSION && record.page_tree?.version === COMPILED_KEYMAP_VERSION && record.own_tree?.version === COMPILED_KEYMAP_VERSION && record.compose_tree?.version === COMPILED_KEYMAP_VERSION && record.typing_tree?.version === COMPILED_KEYMAP_VERSION;
}

function tree_of(result: CompileResult): KeymapTree {
    for (const warning of result.warnings) console.warn(`desertbird keymap: ${warning}`);
    const root: KeymapTree["root"] = JSON.parse(JSON.stringify(result.compiled.modes.normal ?? { kind: "branch", children: {} }));
    mark_steps(root as object);
    return { version: COMPILED_KEYMAP_VERSION, root };
}

function compile_record(source_hash: string, config: Config): KeymapRecord {
    const mail = compile_effective_keymap(config.user_keymap, config.setting_overrides);
    // The message tree ends every mail sequence, the user's included, so it reads this mail tree. The source hash already covers the user's mail keys.
    return { record_version: KEYMAP_RECORD_VERSION, source_hash, tree: tree_of(mail), message_tree: tree_of(compile_tab_keymap("message", config.user_keymap.normal, mail.compiled.modes.normal)), window_tree: tree_of(compile_tab_keymap("window", config.user_keymap.normal, mail.compiled.modes.normal)), page_tree: tree_of(compile_tab_keymap("page", config.user_keymap.normal)), own_tree: tree_of(compile_tab_keymap("own", config.user_keymap.normal, mail.compiled.modes.normal)), compose_tree: tree_of(compile_tab_keymap("compose", config.user_keymap.normal, mail.compiled.modes.normal)), typing_tree: tree_of(compile_typing_keymap(config.user_keymap.normal)) };
}

// Registered before the listener below, so the store has dropped its copy by the time an install reads it.
const config_store = create_config_store(messenger);

// The memory copy only mirrors storage: it refills from storage and drops on `storage.onChanged`.
let cached_record: KeymapRecord | undefined;
// The trees last handed to the Experiments, as JSON. The add-on's own write fires `storage.onChanged` too, and that tree is already installed.
let installed_tree_json: string | undefined;

async function load_record(): Promise<KeymapRecord> {
    if (cached_record !== undefined) return cached_record;
    const config = await config_store.read();
    const source_hash = await hash_of({ keymap: effective_keymap(config.user_keymap), message: keymap_of("message", config.user_keymap.normal), window: keymap_of("window", config.user_keymap.normal), page: keymap_of("page", config.user_keymap.normal), own: keymap_of("own", config.user_keymap.normal), compose: keymap_of("compose", config.user_keymap.normal), typing: compile_typing_keymap(config.user_keymap.normal).compiled.modes.normal, unrepeatable: [...UNREPEATABLE_IDS], keeps_selection: [...KEEPS_SELECTION_IDS], settings: config.setting_overrides });
    const stored = (await messenger.storage.local.get(KEYMAP_STORAGE_KEY))[KEYMAP_STORAGE_KEY];
    if (is_current_record(stored, source_hash)) return (cached_record = stored);
    const record = compile_record(source_hash, config);
    await messenger.storage.local.set({ [KEYMAP_STORAGE_KEY]: record });
    return (cached_record = record);
}

async function install_keymap(): Promise<void> {
    const keys = messenger.keys;
    if (keys === undefined) throw new Error("the DesertBird Experiment is not loaded");
    const { tree, page_tree, message_tree, window_tree, typing_tree, compose_tree } = await load_record();
    const { compose_send: allow_send, mode_indicator_style: label_style, theme } = (await config_store.read()).settings;
    const label_colors = mode_label_colors(resolve_theme(theme));
    const tree_json = JSON.stringify([tree, page_tree, message_tree, window_tree, typing_tree, compose_tree, allow_send, label_style, label_colors]);
    if (tree_json === installed_tree_json) return;
    await keys.install({ tree, settings: {}, holdCommands: HOLD_COMMANDS });
    await messenger.pages?.install({ pageTree: page_tree, messageTree: page_message_tree(message_tree), windowTree: page_message_tree(window_tree), typingTree: typing_tree, holdCommands: HOLD_COMMANDS });
    await messenger.composewin?.install({ composeTree: compose_tree, allowSend: allow_send, labelStyle: label_style, labelColors: label_colors });
    installed_tree_json = tree_json;
    // A new matcher forgets the half-typed sequence without a report, so a panel that shows would list keys that no longer follow.
    hud.close_which_key();
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
const show_subject = async () => (await config_store.read()).settings.notice_show_subject;
const started_ms = Date.now();
const snoozes = create_snooze_store(messenger);
scheduler.on_due((now_ms) => snoozes.wake_due(now_ms, (item) => wake_snoozed({ ...messenger, show_subject }, item, { now_ms, started_ms })));
const followups = create_followup_store(messenger);
// Follow-ups wait out the grace after start, so the folders have synced before a reply is looked for. The minute alarm then picks them up.
scheduler.on_due((now_ms) => (past_start_grace(started_ms, now_ms) ? followups.fire_due(now_ms, (item, still_wanted) => fire_followup({ ...messenger, show_subject }, item, still_wanted)) : undefined));
messenger.notifications.onClicked.addListener((id) => {
    open_followup_anchor(messenger, id).catch(console.error);
});

// The hud shows the which-key panel and the toasts, and keeps the mode label of the status bar. Its state is a few seconds of interface state per window and lives in memory only, like the command line session.
const NO_WINDOW = -1;
const TREE_OF_SOURCE = { main: "tree", message: "message_tree", window: "window_tree", own: "own_tree", page: "page_tree" } as const;
const hud = create_hud_service({
    overlay: messenger.overlay,
    read_settings: async () => (await config_store.read()).settings,
    read_root: async (source) => (await load_record())[TREE_OF_SOURCE[source]].root as TreeBranch,
    read_marks: async () => (await read_folder_state(messenger)).marks,
    send_changed: (windowId) => void best_effort(messenger.runtime.sendMessage({ type: "hud.changed", windowId })),
    timers: { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
});

// The y or n prompt of a bridge write. It borrows the command line surface, so every other command line mount goes through `yielding_overlay`, which ends a prompt in that window as a no first. Its mounts lift the toasts above the tall prompt. The command line mounts through the same wrapper without the lift. Its one pending request lives in memory only.
const confirm = create_confirm_service({
    overlay: messenger.overlay && lifting_toasts(messenger.overlay, hud, true),
    target_window: () => last_focused_main_window(),
    end_command_line: (window_id) => cmdline.end(window_id),
    page_url: () => messenger.runtime.getURL("overlay/cmdline.html"),
    make_token: () => crypto.randomUUID(),
    timers: { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    now_ms: () => Date.now(),
});
const command_line_overlay = messenger.overlay && confirm.yielding_overlay(lifting_toasts(messenger.overlay, hud, false));

// Session storage survives a restart of this page and not of the application, like the window state it copies. It is absent on a build without it, and the memory copy works alone then.
keep_filters(messenger.storage.session);

// The search of `/` and `?`. It holds the live search of a window and reads the `/` register from storage, so `n` works after a restart.
const search = create_search_service({
    api: messenger,
    register: create_search_register(messenger.storage.local),
    timers: { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    say: (window_id, text, is_error) => (is_error ? notify_refusal : notify_result)({ ...messenger, toasts: hud }, text, window_id),
});

// The completer works out the key labels once per object it gets here. The record is the same object until a storage change drops it, so the labels follow the keymap.
let key_trees_of: { record: KeymapRecord; trees: KeyTrees } | undefined;
async function read_key_trees(): Promise<KeyTrees> {
    const record = await load_record();
    if (key_trees_of?.record !== record) key_trees_of = { record, trees: { mail: record.tree.root as TreeBranch, message: record.message_tree.root as TreeBranch } };
    return key_trees_of.trees;
}

// The service and the router refer to each other: the line runs its command through the router, and the open key stores a session in the service.
const cmdline = create_cmdline_service({
    registry,
    sources: {
        folders: create_folder_source(messenger),
        tags: async () => (await messenger.messages.tags.list()).map((entry) => entry.tag),
        tabs: (window_id) => tab_choices(messenger, window_id),
        key_trees: read_key_trees,
    },
    overlay: command_line_overlay,
    read_prompt: async () => (await config_store.read()).settings.cmdline_prompt,
    read_widgets: create_widget_reader(messenger, async () => (await config_store.read()).settings.statusbar_widgets),
    history: create_cmdline_history(messenger.storage.local),
    search_history: create_cmdline_history(messenger.storage.local, SEARCH_HISTORY_STORAGE_KEY),
    search,
    run: (invocation) => router.run(invocation),
});
// The external editor of a compose window, behind the `external_editor` setting. Its jobs live in session storage, so a restart of this page resumes them. A build without session storage refuses the editor.
const COMPOSE_WINDOW_TYPE = "messageCompose";
const no_session = async (): Promise<never> => {
    throw new Error("The external editor needs storage.session, which this Thunderbird lacks.");
};
const external_editor = create_external_editor({
    session: messenger.storage.session ?? { get: no_session, set: no_session },
    client: create_editor_client((message) => messenger.runtime.sendNativeMessage(EDITOR_HOST_NAME, message)),
    compose: messenger.compose,
    // The manifest loads the vendored `turndown` and `marked` before this bundle, and they leave their globals here.
    markdown: create_compose_markdown(globalThis as unknown as MarkdownGlobals),
    async compose_tab_in(window_id) {
        if ((await ignore_refusal(messenger.windows.get(window_id)))?.type !== COMPOSE_WINDOW_TYPE) return undefined;
        // A compose window holds exactly one tab.
        return (await messenger.tabs.query({ windowId: window_id }))[0]?.id;
    },
    tab_exists: (tab_id) => refused_as(messenger.tabs.get(tab_id).then(() => true), false),
    is_enabled: async () => (await config_store.read()).settings.external_editor,
    say: (window_id, text, is_error) => (is_error ? notify_refusal : notify_result)({ ...messenger, toasts: hud }, text, window_id),
    now: () => Date.now(),
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

// The keys and the bridge `act` frame share this API, so a bridge move lands in the same undo log as a key move.
const handler_api = { ...messenger, hints: themed_hints(messenger.hints, async () => (await config_store.read()).settings.theme), keys: messenger.keys, app: messenger.app, overlay: command_line_overlay, cmdline, search, toasts: hud, which_key: hud, quick_replies: create_quick_reply_store(messenger), snooze: { items: snoozes, now: () => new Date(), create_timeout_ms: CREATE_FOLDER_TIMEOUT_MS }, followup: { items: followups, now: () => new Date() }, undo: { log: create_undo_log(messenger), retry_delays_ms: UNDO_RETRY_DELAYS_MS }, external_editor };
const router = create_router(registry, handler_api);

// The bridge to the native host. It connects only while the `bridge` setting is on, and runs a command only through the bridge rules and the router.
const last_focused_main_window = async (): Promise<number | undefined> => {
    const window = await ignore_refusal(messenger.windows.getLastFocused({ windowTypes: ["normal"] }));
    return window?.id !== undefined && window.type === "normal" ? window.id : undefined;
};
const bridge_run = create_bridge_run({ target_window: last_focused_main_window, route: (invocation) => router.route(invocation) });
const bridge_reads = create_bridge_reads({ api: messenger as unknown as ReadsApi, read_settings: async () => (await config_store.read()).settings });
const bridge_drafts = create_bridge_drafts({ api: messenger as unknown as DraftsApi, read_settings: async () => (await config_store.read()).settings, timers: { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) } });
const bridge_acts = create_bridge_acts({ api: handler_api as unknown as ActsApi, read_settings: async () => (await config_store.read()).settings, request_confirm: (request) => confirm.request_confirm(request), target_window: () => last_focused_main_window() });
const bridge = create_bridge_port({
    connect: () => messenger.runtime.connectNative(BRIDGE_HOST_NAME),
    read_bridge_setting: async () => (await config_store.read()).settings.bridge,
    timers: { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    now_ms: () => Date.now(),
    run_command: (command_text) => bridge_run.run(command_text),
    list_commands: list_bridge_commands,
    read: (verb, request) => bridge_reads.read(verb, request),
    draft: (request) => bridge_drafts.draft(request),
    act: (request) => bridge_acts.act(request),
    async current_mode() {
        const window_id = await last_focused_main_window();
        if (window_id === undefined) return undefined;
        const tab_id = (await messenger.tabs.query({ windowId: window_id })).find((tab) => tab.active)?.id;
        return tab_id === undefined ? undefined : { mode: hud.mode_of(window_id), window_id, tab_id };
    },
});

const compose_requests = create_compose_requests((window_id) => router.run({ command: "compose.edit_external", args: {}, count: 1, windowId: window_id, messageIds: [] }));
const body_requests = create_body_requests({ registry, api: messenger, allowed: message_background_commands(), which_key: hud, run: (invocation) => router.run(invocation), hints: handler_api.hints, write_text: write_to_clipboard });

const popup_requests = create_popup_requests({ popup_url: () => messenger.runtime.getURL(POPUP_PAGE), target_window: last_focused_main_window, run: (invocation) => router.run(invocation) });

// The prompt answers first: it takes `cmdline.hello` from its own page while it shows.
messenger.runtime.onMessage.addListener((message, sender) => confirm.handle(message, sender) ?? cmdline.handle(message) ?? hud.handle(message) ?? popup_requests(message, sender) ?? compose_requests(message, sender) ?? body_requests(message, sender));
// A surface left a window on its own (a tab change or a closed window), so its state for that window is dropped.
messenger.overlay?.onClosed.addListener(({ windowId, surface, reason }) => {
    if (surface !== "cmdline") return hud.forget(windowId);
    confirm.surface_gone(windowId);
    cmdline.end(windowId);
    hud.set_lifted(windowId, false);
    // The host closed a line whose page never said it was ready. Say so, or the colon would seem to do nothing.
    if (reason === "not_ready") notify_refusal({ ...messenger, toasts: hud }, "The command line did not start. Press : to try again.", windowId).catch(console.error);
});

start_jump_history(messenger);

// Registered at each start of this page, so compose windows opened from now on get Ctrl+E. The other keys of a compose window belong to the `composewin` Experiment.
messenger.composeScripts.register({ js: [{ file: "content/compose_keys.js" }] }).catch(console.error);
messenger.tabs.onRemoved.addListener((tab_id) => void external_editor.compose_gone(tab_id).catch(console.error));
// A sent message closes its window too. Whichever event comes first orphans the job. A failed send keeps the window open, so it leaves the job alone.
messenger.compose.onAfterSend.addListener((tab, send_info) => {
    if (tab.id !== undefined && !send_info?.error) external_editor.compose_gone(tab.id).catch(console.error);
});
external_editor.resume().catch(console.error);

// Top level, so each page start registers the listeners again.
create_new_mail_notifier(messenger, async () => (await config_store.read()).settings.notify_new_mail).register();

// The key runtime of the mail tab and the one of the other tabs report through the same event shape.
const on_key_event = (event: KeysEvent) => {
    if ("mode" in event) hud.on_keys_event(event).then(() => bridge.mode_changed(), console.error);
    else if ("keys" in event) hud.on_keys_event(event).catch(console.error);
    else router.run(event).catch(console.error);
};
messenger.keys?.onInvocation.addListener(on_key_event);
messenger.pages?.onInvocation.addListener(on_key_event);
// The compose tree holds only the compose commands. The check here keeps any other id out, whatever reaches the event.
messenger.composewin?.onInvocation.addListener((event) => {
    if ("args" in event && COMPOSE_COMMANDS.has(event.command)) router.run(event).catch(console.error);
});

// A half-typed sequence the key runtime cannot see end: a tab change, or the window losing the focus.
messenger.tabs.onActivated.addListener(() => hud.close_which_key());
// `tl` goes back to the tab this event says the window just left.
messenger.tabs.onActivated.addListener((info) => void record_activation(messenger.storage.session, info).catch(console.error));
messenger.windows.onFocusChanged.addListener((window_id) => {
    hud.close_which_key(window_id === NO_WINDOW ? undefined : window_id);
    if (window_id !== NO_WINDOW) void bridge.mode_changed();
});

// The hud draws in main windows and message windows. Only a main window has a status bar for the mode label.
const HUD_WINDOW_KINDS: Record<string, "main" | "message"> = { normal: "main", [MESSAGE_WINDOW_TYPE]: "message" };
const track_window = (window: { id?: number; type?: string }) => {
    const kind = HUD_WINDOW_KINDS[window.type ?? "normal"];
    if (window.id !== undefined && kind !== undefined) hud.track(window.id, kind).catch(console.error);
};
messenger.windows.onCreated.addListener(track_window);
messenger.windows.onRemoved.addListener((window_id) => {
    confirm.surface_gone(window_id);
    hud.forget(window_id);
});
messenger.windows.getAll({ windowTypes: Object.keys(HUD_WINDOW_KINDS) }).then((open) => open.forEach(track_window), console.error);

messenger.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(KEYMAP_STORAGE_KEY in changes || USER_KEYMAP_KEY in changes || SETTINGS_KEY in changes)) return;
    cached_record = undefined;
    queue_install(true);
});

// Registered after the config store's own listener, so the settings are refilled by the time the hud reads them.
messenger.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(SETTINGS_KEY in changes)) return;
    hud.settings_changed().catch(console.error);
    publish_current_theme();
    void bridge.settings_changed();
});

// The pages read the theme from storage, so it is published at every start and again when the setting changes.
function publish_current_theme(): void {
    config_store.read().then(({ settings }) => publish_theme(messenger.storage.local, settings.theme)).catch(console.error);
}
publish_current_theme();

queue_install(false);

scheduler.start().catch(console.error);

void bridge.start();
