// Desktop notifications for new mail. Off by default, switched by the `notify_new_mail` setting. Thunderbird's own new-mail alert stays as it is, so this one is opt-in.
// Buttons on a notification do not work on 153 (see docs/thunderbird-behavior.md), so the only action is a click that opens the message.

import { create_config_store } from "./config/store.ts";
import type { ConfigStorage, ConfigStore } from "./config/store.ts";
import { SETTINGS_KEY } from "./config/store.ts";
import type { HandlerScope } from "./handlers/message.ts";
import { notify_refusal } from "./notify.ts";
import type { NotificationsApi } from "./notify.ts";

/** More new messages than this in one delivery give a single batched notification. */
export const MAX_SINGLE_NOTIFICATIONS = 3;

/** The map from notification id to the message ids it stands for. It lives in storage because the background page can restart while notifications stay on screen. */
export const NOTIFICATION_MAP_KEY = "desertbird_new_mail_notifications";

const TITLE = "New mail";

interface NewMessage {
    id: number;
    author?: string;
    subject?: string;
    read?: boolean;
    junk?: boolean;
}

interface NewMailFolder {
    type?: string;
}

type NotificationMap = Record<string, number[]>;

export interface NewMailApi {
    messages: {
        get(id: number): Promise<unknown>;
        onNewMailReceived: { addListener(listener: (folder: NewMailFolder, list: { messages: NewMessage[] }) => void): void };
    };
    messageDisplay: { open(properties: { messageId: number; location: "tab" }): Promise<unknown> };
    notifications: NotificationsApi["notifications"] & {
        clear(id: string): Promise<boolean>;
        onClicked: { addListener(listener: (id: string) => void): void };
        onClosed: { addListener(listener: (id: string) => void): void };
    };
    storage: {
        local: { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
        onChanged: { addListener(listener: (changes: Record<string, unknown>, area: string) => void): void };
    };
}

const is_id_list = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => Number.isInteger(item));

function sanitize_map(raw: unknown): NotificationMap {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number[]] => is_id_list(entry[1])));
}

/** The messages that deserve a notification: unread and not junk. The folder check is on the event, not here. */
const wanted = (message: NewMessage): boolean => message.read !== true && message.junk !== true;

const line_of = (message: NewMessage): string => `${message.author ?? "Unknown sender"}: ${message.subject || "(no subject)"}`;

export interface NewMailNotifier {
    /** Adds the listeners. Call once from the background entry, at the top level, so a restarted page registers them again. */
    register(): void;
}

export function create_new_mail_notifier(api: NewMailApi, is_enabled: () => Promise<boolean>): NewMailNotifier {
    // Read, change and write of the map run one at a time, so two events never overwrite each other.
    let map_queue: Promise<unknown> = Promise.resolve();
    function edit_map<T>(change: (map: NotificationMap) => T): Promise<T> {
        const run = async (): Promise<T> => {
            const map = sanitize_map((await api.storage.local.get([NOTIFICATION_MAP_KEY]))[NOTIFICATION_MAP_KEY]);
            const result = change(map);
            await api.storage.local.set({ [NOTIFICATION_MAP_KEY]: map });
            return result;
        };
        const next = map_queue.then(run, run);
        map_queue = next.catch(() => {});
        return next;
    }

    async function show(messages: NewMessage[]): Promise<void> {
        const [first] = messages;
        if (first === undefined) return;
        const batched = messages.length > MAX_SINGLE_NOTIFICATIONS;
        const id = batched ? `desertbird-new-mail-batch-${first.id}` : `desertbird-new-mail-${first.id}`;
        const message = batched ? `${messages.length} new messages` : line_of(first);
        await edit_map((map) => void (map[id] = messages.map((entry) => entry.id)));
        await api.notifications.create(id, { type: "basic", title: batched ? "New mail" : TITLE, message });
    }

    async function on_new_mail(folder: NewMailFolder, list: { messages: NewMessage[] }): Promise<void> {
        if (folder.type !== "inbox" || !(await is_enabled())) return;
        const fresh = list.messages.filter(wanted);
        if (fresh.length > MAX_SINGLE_NOTIFICATIONS) await show(fresh);
        else for (const message of fresh) await show([message]);
    }

    async function on_clicked(id: string): Promise<void> {
        const message_ids = (await edit_map((map) => map[id])) ?? [];
        const [target] = message_ids;
        if (target === undefined) return;
        try {
            await api.messages.get(target);
        } catch {
            // Deleted since the mail arrived. Say so instead of doing nothing.
            await notify_refusal(api, "That message no longer exists.");
            return;
        }
        await api.messageDisplay.open({ messageId: target, location: "tab" });
        await api.notifications.clear(id);
    }

    async function clear_all(): Promise<void> {
        const ids = await edit_map((map) => {
            const open = Object.keys(map);
            for (const id of open) delete map[id];
            return open;
        });
        await Promise.all(ids.map((id) => api.notifications.clear(id)));
    }

    return {
        register() {
            api.messages.onNewMailReceived.addListener((folder, list) => void on_new_mail(folder, list).catch(console.error));
            api.notifications.onClicked.addListener((id) => void on_clicked(id).catch(console.error));
            api.notifications.onClosed.addListener((id) => void edit_map((map) => void delete map[id]).catch(console.error));
            // The setting turns off while notifications are open: take them down, so a click does not act on a feature that is off.
            api.storage.onChanged.addListener((changes, area) => {
                if (area !== "local" || !(SETTINGS_KEY in changes)) return;
                is_enabled().then((enabled) => (enabled ? undefined : clear_all())).catch(console.error);
            });
        },
    };
}

// One store per storage object: each store adds its own `onChanged` listener.
const toggle_stores = new WeakMap<object, ConfigStore>();

/** Flips `notify_new_mail` and says which way it went. */
export async function toggle_new_mail_notify(scope: HandlerScope<ConfigStorage & NotificationsApi>): Promise<void> {
    const { api } = scope;
    let store = toggle_stores.get(api.storage);
    if (store === undefined) toggle_stores.set(api.storage, (store = create_config_store(api)));
    const config = await store.read();
    const enabled = !config.settings.notify_new_mail;
    await store.write_settings({ ...config.setting_overrides, notify_new_mail: enabled });
    await notify_refusal(api, `New-mail notifications are ${enabled ? "on" : "off"}.`);
}
