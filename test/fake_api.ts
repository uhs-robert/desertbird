import { create_snooze_store } from "../src/background/snooze_store.ts";
import { create_followup_store } from "../src/background/followup_store.ts";
import type { SnoozeStore } from "../src/background/snooze_store.ts";
import { create_quick_reply_store } from "../src/background/quick_reply_store.ts";
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
    accounts?: { id: string; type: string }[];
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
        windows: { openDefaultBrowser: async (url) => void calls.push(`windows.openDefaultBrowser ${url}`) },
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
                      viewRows: async () => ({ current: -1, rows: [] }),
                      viewThread: async () => {},
                      viewAllThreads: async () => {},
                      viewScroll: async () => {},
                      folderTreeExpand: async () => false,
                      paneFocus: async () => {},
                      appCommand: async () => true,
                      appOpenPage: async () => {},
                  },
        overlay:
            options.experiment === false
                ? undefined
                : {
                      mount: async (args) => void calls.push(`overlay.mount ${args.windowId} ${args.surface}`),
                      unmount: async (args) => void calls.push(`overlay.unmount ${args.windowId}`),
                      setModeLabel: async () => {},
                      onClosed: { addListener: () => {}, removeListener: () => {} },
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
