import { create_snooze_store } from "../src/background/snooze_store.ts";
import { create_followup_store } from "../src/background/followup_store.ts";
import type { SnoozeStore } from "../src/background/snooze_store.ts";
import { create_quick_reply_store } from "../src/background/quick_reply_store.ts";
import { create_undo_log } from "../src/background/undo_log.ts";
import type { QuickReplyStore } from "../src/background/quick_reply_store.ts";
import type { RouterApi } from "../src/background/router.ts";
import type { MailFolder } from "../src/background/handlers/displayed_folder.ts";
import type { Identity } from "../src/background/handlers/identity.ts";
import type { MailTag, MessageHeader } from "../src/background/handlers/message.ts";

interface FakeOptions {
    /** The messages `messages.get` knows. */
    messages?: (Partial<MessageHeader> & { id: number })[];
    /** The headers `messages.getFull` returns, by message id. */
    headers?: Record<number, Record<string, string[]>>;
    identities?: (Identity & { account_id: string })[];
    experiment?: boolean;
    tags?: MailTag[];
    folders?: MailFolder[];
    displayed?: MailFolder;
    /** The default account. `null` means there is none. */
    default_account?: { id: string } | null;
    /** The accounts `accounts.list` returns. */
    accounts?: { id: string; type: string; name?: string }[];
    /** The attachments `messages.listAttachments` returns per message id. */
    attachments?: Record<number, { name: string; partName: string; contentDisposition?: string; type?: string }[]>;
    /** The end state of each download. Defaults to complete. */
    download_state?: "complete" | "interrupted" | "hold";
    /** `downloads.download` rejects with this, as a canceled save dialog does. */
    download_error?: string;
    /** `getAttachmentFile` rejects for these part names. */
    unreadable_parts?: string[];
    /** The nine quick reply texts, slot 1 first. */
    quick_replies?: string[];
    /** What `compose.getComposeDetails` returns for the reply tab. */
    compose_details?: { isPlainText?: boolean; body?: string; plainTextBody?: string };
    /** The time `snooze.now` returns. */
    now?: Date;
    /** The `storage.local` contents. Pass the same object to a second fake to model a background restart. */
    storage?: Record<string, unknown>;
    /** `mailTabs.update` of a displayed folder throws this after it showed the folder, as Thunderbird does on the first display of a folder. */
    first_display_error?: string;
    /** The type `windows.get` answers per window id. A window not listed is a main window. */
    window_types?: Record<number, string>;
}

/** A recording fake of the API subset. `calls` holds one line per call, in order. */
export function fake_api(options: FakeOptions = {}): { api: RouterApi; calls: string[]; snoozes: SnoozeStore; quick_replies: QuickReplyStore; end_held_downloads: () => void; displayed: () => MailFolder | undefined } {
    const calls: string[] = [];
    let download_count = 0;
    const held_downloads: number[] = [];
    const download_listeners = new Set<Parameters<RouterApi["downloads"]["onChanged"]["addListener"]>[0]>();
    const snoozes = create_snooze_store({ storage: fake_storage().api });
    const quick_replies = create_quick_reply_store({ storage: fake_storage().api });
    void quick_replies.write_all(options.quick_replies ?? []);
    const followups = create_followup_store({ storage: fake_storage().api });
    const storage = options.storage ?? {};
    let displayed = options.displayed;
    const folder_listeners: ((tab: { id: number }, folder: MailFolder) => void)[] = [];
    const known = new Map((options.messages ?? []).map((message) => [message.id, { date: new Date(0), ...message }]));
    const api: RouterApi = {
        messages: {
            archive: async (ids) => void calls.push(`messages.archive ${ids.join(",")}`),
            delete: async (ids) => void calls.push(`messages.delete ${ids.join(",")}`),
            get: async (id) => {
                calls.push(`messages.get ${id}`);
                const message = known.get(id);
                if (message === undefined) throw new Error(`Message not found: ${id}.`);
                return message;
            },
            update: async (id, properties) => void calls.push(`messages.update ${id} ${JSON.stringify(properties)}`),
            listAttachments: async (id) => (calls.push(`messages.listAttachments ${id}`), options.attachments?.[id] ?? []),
            getAttachmentFile: async (id, part_name) => {
                calls.push(`messages.getAttachmentFile ${id} ${part_name}`);
                if (options.unreadable_parts?.includes(part_name)) throw new Error("unreadable");
                return new Blob([`${id}/${part_name}`]);
            },
            move: async (ids, folder_id) => void calls.push(`messages.move ${ids.join(",")} ${folder_id}`),
            copy: async (ids, folder_id) => void calls.push(`messages.copy ${ids.join(",")} ${folder_id}`),
            query: async (query) => (calls.push(`messages.query ${query.headerMessageId}`), { messages: [] }),
            continueList: async () => ({ messages: [] }),
            getFull: async (id) => (calls.push(`messages.getFull ${id}`), { ...(options.headers?.[id] && { headers: options.headers[id] }) }),
            tags: {
                list: async () => (calls.push("messages.tags.list"), options.tags ?? []),
                create: async (key, tag) => void calls.push(`messages.tags.create ${key} ${tag}`),
            },
            getHeaders: async (id) => (calls.push(`messages.getHeaders ${id}`), {}),
        },
        compose: {
            beginReply: async (id, type, details) => (calls.push(`compose.beginReply ${id} ${type} ${details.identityId}`), { id: 7 }),
            getComposeDetails: async (tab_id) => (calls.push(`compose.getComposeDetails ${tab_id}`), options.compose_details ?? { isPlainText: true, plainTextBody: "\n\nOn x wrote:\n> quoted" }),
            setComposeDetails: async (tab_id, details) => void calls.push(`compose.setComposeDetails ${tab_id} ${JSON.stringify(details)}`),
            beginForward: async (id, _type, details) => (calls.push(`compose.beginForward ${id} ${details.identityId}`), undefined),
            beginNew: async (_id, details) => (calls.push(details === undefined ? "compose.beginNew" : `compose.beginNew ${JSON.stringify(details)}`), undefined),
        },
        identities: {
            list: async (account_id) => {
                calls.push(`identities.list${account_id === undefined ? "" : ` ${account_id}`}`);
                return (options.identities ?? [{ id: "i1", email: "me@x.invalid", account_id: "a1" }]).filter((identity) => account_id === undefined || identity.account_id === account_id);
            },
        },
        accounts: {
            getDefault: async () => (calls.push("accounts.getDefault"), options.default_account === undefined ? { id: "a1" } : options.default_account),
            list: async () => (calls.push("accounts.list"), options.accounts ?? [{ id: "a1", type: "imap" }]),
        },
        quick_replies,
        snooze: { items: snoozes, now: () => options.now ?? new Date(2026, 10, 18, 10, 15), create_timeout_ms: 50 },
        followup: { items: followups, now: () => options.now ?? new Date(2026, 10, 18, 10, 15) },
        undo: { log: create_undo_log({ storage: fake_storage().api }), retry_delays_ms: [] },
        folders: {
            query: async (query) => {
                calls.push(`folders.query ${JSON.stringify(query)}`);
                return (options.folders ?? []).filter((folder) => (query.path === undefined || folder.path === query.path) && (query.accountId === undefined || folder.accountId === query.accountId) && (query.specialUse === undefined || query.specialUse.some((use) => folder.specialUse?.includes(use))));
            },
            create: async (parent_id, name) => (calls.push(`folders.create ${parent_id} ${name}`), { id: `new-${name}`, accountId: "a1", path: `/${name}` }),
            markAsRead: async (folder_id) => void calls.push(`folders.markAsRead ${folder_id}`),
        },
        mailTabs: {
            query: async (query) => (calls.push(`mailTabs.query ${query.windowId}`), displayed === undefined ? [{ id: 1 }] : [{ id: 1, displayedFolder: displayed }]),
            update: async (tab_id: number, update: object) => {
                if (!("displayedFolder" in update)) return undefined;
                const folder = update.displayedFolder as MailFolder;
                calls.push(`mailTabs.update ${tab_id} ${folder.id}`);
                const changed = displayed?.id !== folder.id;
                displayed = folder;
                // Thunderbird fires the event only when the folder changes, and before the call returns.
                if (changed) for (const listener of folder_listeners) listener({ id: tab_id }, folder);
                if (options.first_display_error !== undefined) throw new Error(options.first_display_error);
                return undefined;
            },
            create: async (create: { displayedFolder: MailFolder }) => {
                calls.push(`mailTabs.create ${create.displayedFolder.id}`);
                displayed = create.displayedFolder;
                if (options.first_display_error !== undefined) throw new Error(options.first_display_error);
                return undefined;
            },
            setQuickFilter: async () => {},
            setSelectedMessages: async (tab_id, ids) => void calls.push(`mailTabs.setSelectedMessages ${tab_id} ${ids.join(",")}`),
            onDisplayedFolderChanged: { addListener: (listener) => void folder_listeners.push(listener) },
        },
        storage: {
            local: {
                get: async (key) => (calls.push(`storage.get ${key}`), key in storage ? { [key]: structuredClone(storage[key]) } : {}),
                set: async (items) => {
                    calls.push(`storage.set ${Object.keys(items).join(",")}`);
                    Object.assign(storage, structuredClone(items));
                },
            },
        },
        windows: { openDefaultBrowser: async (url) => void calls.push(`windows.openDefaultBrowser ${url}`), get: async (id) => ({ type: options.window_types?.[id] ?? "normal" }) },
        downloads: {
            download: async (download) => {
                calls.push(`download ${download.filename} saveAs=${download.saveAs} ${download.conflictAction}`);
                if (options.download_error !== undefined) throw new Error(options.download_error);
                const id = ++download_count;
                if (options.download_state === "hold") held_downloads.push(id);
                else queueMicrotask(() => download_listeners.forEach((listener) => listener({ id, state: { current: options.download_state ?? "complete" } })));
                return id;
            },
            onChanged: { addListener: (listener) => void download_listeners.add(listener), removeListener: (listener) => void download_listeners.delete(listener) },
        },
        notifications: { create: async (_id, notification) => (calls.push(`notify ${notification.message}`), "n1") },
        keys:
            options.experiment === false
                ? undefined
                : {
                      install: async () => {},
                      onInvocation: { addListener: () => {}, removeListener: () => {} },
                  },
        app:
            options.experiment === false
                ? undefined
                : {
                      viewRows: async () => ({ current: -1, rows: [] }),
                      viewThread: async () => {},
                      viewAllThreads: async () => {},
                      viewScroll: async () => {},
                      paneFocus: async () => true,
                      paneResize: async () => true,
                      appCommand: async () => true,
                      appOpenPage: async () => {},
                  },
        context: options.experiment === false ? undefined : { open: async (args) => (calls.push(`context.open ${args.windowId}`), true) },
        folderpane: options.experiment === false ? undefined : { fold: async () => false, focused: async () => false, viewRowCount: async () => 0 },
        overlay:
            options.experiment === false
                ? undefined
                : {
                      mount: async (args) => void calls.push(`overlay.mount ${args.windowId} ${args.surface}`),
                      unmount: async (args) => void calls.push(`overlay.unmount ${args.windowId}`),
                      setModeLabel: async () => {},
                      onClosed: { addListener: () => {}, removeListener: () => {} },
                  },
        search: {
            start: async (window_id, direction) => void calls.push(`search.start ${window_id} ${direction}`),
            step: async (window_id, relation) => void calls.push(`search.step ${window_id} ${relation}`),
        },
        cmdline: {
            begin: (window_id, session) => void calls.push(`cmdline.begin ${window_id} ${JSON.stringify(session)}`),
            end: (window_id) => void calls.push(`cmdline.end ${window_id}`),
        },
    };
    return { api, calls, snoozes, quick_replies, end_held_downloads: () => held_downloads.splice(0).forEach((id) => download_listeners.forEach((listener) => listener({ id, state: { current: "complete" } }))), displayed: () => displayed };
}

/** A fake of `alarms` that dies with the page: `restart()` clears every alarm and listener, as a Firefox restart does. `fire` runs the listeners like an alarm going off. */
export function fake_alarms() {
    let alarms = new Map<string, { periodInMinutes?: number }>();
    let listeners: ((alarm: { name: string }) => void)[] = [];
    return {
        api: {
            create: (name: string, info: { periodInMinutes?: number }) => void alarms.set(name, info),
            onAlarm: { addListener: (listener: (alarm: { name: string }) => void) => void listeners.push(listener) },
        },
        names: () => [...alarms.keys()].sort(),
        info: (name: string) => alarms.get(name),
        fire: (name: string) => listeners.forEach((listener) => listener({ name })),
        restart: () => {
            alarms = new Map();
            listeners = [];
        },
    };
}

/** A fake of `storage.local` that fires `onChanged` after each write. `data` survives a restart. `write_delay_ms` makes writes slow, so quick successive writes overlap. */
export function fake_storage(data: Record<string, unknown> = {}, write_delay_ms = 0) {
    const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
    return {
        data,
        api: {
            local: {
                get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
                set: async (items: Record<string, unknown>) => {
                    if (write_delay_ms > 0) await new Promise((resolve) => setTimeout(resolve, write_delay_ms));
                    Object.assign(data, structuredClone(items));
                    const changes = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }]));
                    listeners.forEach((listener) => listener(changes, "local"));
                },
            },
            onChanged: { addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void listeners.push(listener) },
        },
        /** A write from another page of the add-on. */
        external_write: (items: Record<string, unknown>) => {
            Object.assign(data, structuredClone(items));
            const changes = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }]));
            listeners.forEach((listener) => listener(changes, "local"));
        },
    };
}

/** A fake of the API the bridge reads use. `calls` holds one line per call. Folder ids not in `folders` and message ids not in `headers` throw, as Thunderbird does. */
export function fake_reads_api(options: {
    folders?: { id: string; name?: string; path: string; accountId: string; isRoot?: boolean; unread?: number; total?: number }[];
    accounts?: { id: string; name?: string }[];
    headers?: { id: number; folder: string; author?: string; subject?: string; date?: Date; recipients?: string[]; read?: boolean; flagged?: boolean }[];
    full?: Record<number, object>;
    attachments?: Record<number, { name?: string; partName: string; size?: number; contentType?: string }[]>;
    page_size?: number;
} = {}) {
    const calls: string[] = [];
    const folders = options.folders ?? [];
    const headers = options.headers ?? [];
    const pages = new Map<string, (typeof headers)[]>();
    let next_list = 1;
    const page_of = (rows: typeof headers) => {
        const size = options.page_size ?? 100;
        const chunks = Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
        const first = chunks.shift() ?? [];
        if (chunks.length === 0) return { id: null, messages: first };
        const id = `list-${next_list++}`;
        pages.set(id, chunks);
        return { id, messages: first };
    };
    const header_of = (id: number) => {
        const header = headers.find((row) => row.id === id);
        if (header === undefined) throw new Error(`Message not found: ${id}.`);
        return header;
    };
    const api = {
        accounts: { list: async () => (calls.push("accounts.list"), options.accounts ?? [{ id: "a1", name: "Work" }]) },
        folders: {
            query: async (query: object) => (calls.push(`folders.query ${JSON.stringify(query)}`), folders),
            get: async (folder_id: string) => {
                calls.push(`folders.get ${folder_id}`);
                const folder = folders.find((row) => row.id === folder_id);
                if (folder === undefined) throw new Error(`Folder not found: ${folder_id}`);
                return folder;
            },
            getFolderInfo: async (folder_id: string) => {
                const folder = folders.find((row) => row.id === folder_id);
                return { unreadMessageCount: folder?.unread ?? 0, totalMessageCount: folder?.total ?? 0 };
            },
        },
        messages: {
            get: async (id: number) => (calls.push(`messages.get ${id}`), header_of(id)),
            getFull: async (id: number, opts: object) => {
                calls.push(`messages.getFull ${id} ${JSON.stringify(opts)}`);
                header_of(id);
                return options.full?.[id] ?? { contentType: "message/rfc822", parts: [] };
            },
            query: async (query: { folderId: string; unread?: true }) => {
                calls.push(`messages.query ${JSON.stringify(query)}`);
                return page_of(headers.filter((row) => row.folder === query.folderId && (query.unread !== true || row.read !== true)));
            },
            continueList: async (list_id: string) => {
                calls.push(`messages.continueList ${list_id}`);
                const rest = pages.get(list_id) ?? [];
                const next = rest.shift() ?? [];
                if (rest.length === 0) {
                    pages.delete(list_id);
                    return { id: null, messages: next };
                }
                return { id: list_id, messages: next };
            },
            listAttachments: async (id: number) => (calls.push(`messages.listAttachments ${id}`), header_of(id), options.attachments?.[id] ?? []),
        },
        messengerUtilities: { convertToPlainText: async (html: string) => (calls.push("convertToPlainText"), html.replace(/<[^>]*>/g, "")) },
    };
    return { api, calls };
}
