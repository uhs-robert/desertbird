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

export interface EditExternalApi {
    external_editor: Pick<ExternalEditor, "open">;
}

// The window is the compose window of a Ctrl+E, or the main window of a `:edit`, which the editor refuses.
export async function edit_external(scope: HandlerScope<EditExternalApi>): Promise<void> {
    await scope.api.external_editor.open(scope.window_id);
}
