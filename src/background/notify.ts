// Every refusal reaches the user: a key that does nothing without a word reads as a broken add-on. A message shows as a toast in the window it came from. A system notification is the way out when no toast can show.

/** Shows a toast in the window. Resolves to false when it cannot, for example when the Experiment is not loaded or the message came from no window. */
export interface ToastSink {
    toast(window_id: number, text: string, is_error: boolean): Promise<boolean>;
}

export interface NotificationsApi {
    notifications: {
        create(id: string | undefined, options: { type: "basic"; title: string; message: string }): Promise<string>;
    };
    toasts?: ToastSink;
}

const TITLE = "DesertBird";
const NO_WINDOW = -1;

async function notify(api: NotificationsApi, message: string, is_error: boolean, window_id: number): Promise<void> {
    if (await api.toasts?.toast(window_id, message, is_error)) return;
    await api.notifications.create(undefined, { type: "basic", title: TITLE, message });
}

/** A command refused or failed. It lasts `toast_error_ms`. */
export const notify_refusal = (api: NotificationsApi, message: string, window_id = NO_WINDOW): Promise<void> => notify(api, message, true, window_id);

/** A command finished with something to say. It lasts `toast_ms`. */
export const notify_result = (api: NotificationsApi, message: string, window_id = NO_WINDOW): Promise<void> => notify(api, message, false, window_id);
