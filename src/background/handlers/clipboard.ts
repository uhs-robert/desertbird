import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { require_messages } from "./each_message.ts";
import type { HandlerScope } from "./message.ts";

/** A part of `messages.getFull`. Only the members the body walk reads are listed. */
export interface MessagePart {
    contentType?: string;
    body?: string;
    name?: string;
    parts?: MessagePart[];
}

export type HtmlToText = (html: string) => Promise<string>;

export interface ClipboardApi {
    // Thunderbird's own converter, measured present on Thunderbird 153.7 and Betterbird.
    messengerUtilities: { convertToPlainText(html: string): Promise<string> };
    messages: {
        get(id: number): Promise<{ id: number; subject: string; author: string; headerMessageId: string }>;
        getFull(id: number): Promise<MessagePart>;
    };
    messageDisplay: { open(properties: { messageId: number; location: "tab" }): Promise<unknown> };
}

export type ClipboardScope = HandlerScope<ClipboardApi>;

type WriteText = (text: string) => Promise<void>;

export const write_to_clipboard: WriteText = (text) => navigator.clipboard.writeText(text);

// The walk stops at a named part (an attachment, even a text one) and at an attached message, whose own body is not this message's body.
// The root part of `getFull` is itself `message/rfc822`, so the message rule applies to the parts below it.
const body_texts = (part: MessagePart, content_type: string, is_root = true): string[] => {
    if (part.name !== undefined || (!is_root && part.contentType?.toLowerCase().startsWith("message/"))) return [];
    if (part.contentType?.toLowerCase().startsWith(content_type) && part.body !== undefined) return [part.body];
    return (part.parts ?? []).flatMap((child) => body_texts(child, content_type, false));
};

/** The plain parts when they hold text, else the HTML parts as text. An empty result means the message has no text body. */
export async function plain_body(root: MessagePart, html_to_text: HtmlToText): Promise<string> {
    const plain = body_texts(root, "text/plain").join("\n");
    if (plain.trim() !== "") return plain;
    const html = body_texts(root, "text/html").join("\n");
    return html.trim() === "" ? "" : html_to_text(html);
}

const bare_address = (author: string): string => /<([^>]*)>/.exec(author)?.[1]?.trim() ?? author.trim();

// The first selected message decides. A collapsed thread root stands for its thread, and copying every message would be a surprise.
export async function yank(scope: ClipboardScope, args: CheckedArgs, write_text: WriteText = write_to_clipboard): Promise<void> {
    const [id] = require_messages(scope.message_ids);
    const field = args["field"] as "content" | "subject" | "sender" | "address" | "message_id";
    const text = await (async () => {
        if (field === "content") return plain_body(await scope.api.messages.getFull(id!), (html) => scope.api.messengerUtilities.convertToPlainText(html));
        const message = await scope.api.messages.get(id!);
        return { subject: message.subject, sender: message.author, address: bare_address(message.author), message_id: message.headerMessageId }[field];
    })();
    // An empty write would clear the clipboard and tell the user nothing.
    if (text.trim() === "") throw new RuntimeRefusal(field === "content" ? "The message has no text to copy." : `The message has no ${field.replace("_", " ")} to copy.`);
    await write_text(text);
}

// More than one id means a multi-row selection or a thread. Opening several tabs at once is not what one key press means, so the handler refuses.
export async function open_message(scope: ClipboardScope): Promise<void> {
    const ids = require_messages(scope.message_ids);
    if (ids.length > 1) throw new RuntimeRefusal("Select one message to open.");
    await scope.api.messageDisplay.open({ messageId: ids[0]!, location: "tab" });
}
