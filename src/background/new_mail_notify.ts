// Desktop notifications for new mail. Off by default, switched by the `notify_new_mail` setting. Thunderbird's own new-mail alert stays as it is, so this one is opt-in.
// Buttons on a notification do not work on 153 (see docs/thunderbird-behavior.md), so the only action is a click that opens the message.

import { create_config_store } from "./config/store.ts";
import { SETTINGS_KEY } from "./config/store.ts";
import type { ConfigStorage, ConfigStore } from "./config/store.ts";
import type { HandlerScope } from "./handlers/message.ts";
import { notify_refusal } from "./notify.ts";
import type { NotificationsApi } from "./notify.ts";

/** More new messages than this in one delivery give a single batched notification. */
export const MAX_SINGLE_NOTIFICATIONS = 3;

const TITLE = "New mail";

interface NewMessage {
    id: number;
    author?: string;
    subject?: string;
    read?: boolean;
    junk?: boolean;
}

interface NewMailFolder {
    specialUse?: string[];
}

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
        onChanged: { addListener(listener: (changes: Record<string, unknown>, area: string) => void): void };
    };
}

/** The messages that deserve a notification: unread and not junk. The folder check is on the event, not here. */
const wanted = (message: NewMessage): boolean => message.read !== true && message.junk !== true;

const line_of = (message: NewMessage): string => `${message.author ?? "Unknown sender"}: ${message.subject || "(no subject)"}`;

export interface NewMailNotifier {
    /** Adds the listeners. Call once from the background entry, at the top level, so a restarted page registers them again. */
    register(): void;
}

export function create_new_mail_notifier(api: NewMailApi, is_enabled: () => Promise<boolean>): NewMailNotifier {
    // In memory on purpose: the background page is persistent, and Thunderbird clears every notification of the add-on when it shuts down, so no entry outlives the page.
    const open_notifications = new Map<string, number[]>();

    async function show(messages: NewMessage[]): Promise<void> {
        const [first] = messages;
        if (first === undefined || !(await is_enabled())) return;
        const batched = messages.length > MAX_SINGLE_NOTIFICATIONS;
        const id = batched ? `desertbird-new-mail-batch-${first.id}` : `desertbird-new-mail-${first.id}`;
        const message = batched ? `${messages.length} new messages` : line_of(first);
        open_notifications.set(id, messages.map((entry) => entry.id));
        await api.notifications.create(id, { type: "basic", title: TITLE, message });
    }

    async function on_new_mail(folder: NewMailFolder, list: { messages: NewMessage[] }): Promise<void> {
        if (!folder.specialUse?.includes("inbox")) return;
        const fresh = list.messages.filter(wanted);
        if (fresh.length > MAX_SINGLE_NOTIFICATIONS) await show(fresh);
        else for (const message of fresh) await show([message]);
    }

    async function on_clicked(id: string): Promise<void> {
        const [target] = open_notifications.get(id) ?? [];
        if (target === undefined) return;
        open_notifications.delete(id);
        await api.notifications.clear(id);
        try {
            await api.messages.get(target);
        } catch {
            // Deleted since the mail arrived. Say so instead of doing nothing.
            await notify_refusal(api, "That message no longer exists.");
            return;
        }
        await api.messageDisplay.open({ messageId: target, location: "tab" });
    }

    async function clear_all(): Promise<void> {
        const ids = [...open_notifications.keys()];
        open_notifications.clear();
        await Promise.all(ids.map((id) => api.notifications.clear(id)));
    }

    return {
        register() {
            api.messages.onNewMailReceived.addListener((folder, list) => void on_new_mail(folder, list).catch(console.error));
            api.notifications.onClicked.addListener((id) => void on_clicked(id).catch(console.error));
            api.notifications.onClosed.addListener((id) => void open_notifications.delete(id));
            // The setting turns off while notifications are open: take them down, so a click does not act on a feature that is off.
            api.storage.onChanged.addListener((changes, area) => {
                if (area !== "local" || !(SETTINGS_KEY in changes)) return;
                is_enabled().then((enabled) => (enabled ? undefined : clear_all())).catch(console.error);
            });
        },
    };
}

// One store per storage object: each store adds its own `onChanged` listener. The write fires `onChanged`, which drops the cache of the store main.ts reads from, so the running listener sees the new value.
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
