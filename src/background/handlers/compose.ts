import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { resolve_identity } from "./identity.ts";
import { require_messages } from "./each_message.ts";
import type { HandlerScope, MessageHeader, ReplyType } from "./message.ts";
import type { ExternalEditor } from "../external_editor.ts";

const REPLY_TYPE: Record<string, ReplyType> = { sender: "replyToSender", all: "replyToAll", list: "replyToList" };

const newest = (messages: MessageHeader[]): MessageHeader | undefined =>
    messages.reduce<MessageHeader | undefined>((latest, message) => (latest === undefined || new Date(message.date).getTime() > new Date(latest.date).getTime() ? message : latest), undefined);

// A selected collapsed thread root stands for the whole thread. Reply and forward then take its newest message, the one the conversation continues from.
export async function newest_with_identity(scope: HandlerScope): Promise<{ message: MessageHeader; identity_id: string }> {
    const message = newest(await Promise.all(require_messages(scope.message_ids).map((id) => scope.api.messages.get(id))));
    if (message === undefined) throw new RuntimeRefusal("No message is selected.");
    const identity = await resolve_identity(scope.api, message);
    return { message, identity_id: identity.id };
}

export async function reply(scope: HandlerScope, args: CheckedArgs): Promise<void> {
    const { message, identity_id } = await newest_with_identity(scope);
    await scope.api.compose.beginReply(message.id, REPLY_TYPE[String(args["to"])]!, { identityId: identity_id });
}

export async function forward(scope: HandlerScope): Promise<void> {
    const { message, identity_id } = await newest_with_identity(scope);
    // Leaving the forward type out keeps the user's forward mode (inline or attachment).
    await scope.api.compose.beginForward(message.id, undefined, { identityId: identity_id });
}

// A new message has no source message, so only the default account and then any account can supply the identity. The call itself picks its own.
export async function new_message(scope: HandlerScope): Promise<void> {
    await resolve_identity(scope.api, {});
    await scope.api.compose.beginNew();
}

export interface SaveDraftApi {
    windows: { get(window_id: number, options: { populate: true }): Promise<{ type?: string; tabs?: { id?: number }[] }> };
    compose: { saveMessage(tab_id: number, options: { mode: "draft" }): Promise<unknown> };
}

// The window is the compose window of the key. `saveMessage` keeps it open and leaves the text in it.
export async function save_draft(scope: HandlerScope<SaveDraftApi>): Promise<void> {
    const window = await scope.api.windows.get(scope.window_id, { populate: true });
    // `:save` from the command line of a main window would save its mail tab, so it refuses as `:edit` does.
    if (window.type !== "messageCompose") throw new RuntimeRefusal("Save works only in a compose window. Press s in normal mode in the message body.");
    const tab_id = window.tabs?.[0]?.id;
    if (tab_id === undefined) throw new RuntimeRefusal("The compose window has no message to save.");
    await scope.api.compose.saveMessage(tab_id, { mode: "draft" });
}

export interface EditExternalApi {
    external_editor: Pick<ExternalEditor, "open">;
}

// The window is the compose window of a Ctrl+E. A `:edit` comes from a main window, since the command line does not open in compose windows yet, and the editor refuses it.
export async function edit_external(scope: HandlerScope<EditExternalApi>): Promise<void> {
    await scope.api.external_editor.open(scope.window_id);
}
