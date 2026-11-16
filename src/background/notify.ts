// Every refusal reaches the user as a notification: a key that does nothing without a word reads as a broken add-on.

export interface NotificationsApi {
    notifications: {
        create(id: string | undefined, options: { type: "basic"; title: string; message: string }): Promise<string>;
    };
}

const TITLE = "DesertBird";

export async function notify_refusal(api: NotificationsApi, message: string): Promise<void> {
    await api.notifications.create(undefined, { type: "basic", title: TITLE, message });
}
