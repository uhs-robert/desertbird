import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { QuickReplyStore } from "../quick_reply_store.ts";
import { newest_with_identity } from "./compose.ts";
import type { HandlerScope, MessageApi } from "./message.ts";

export interface ComposeDetails {
    isPlainText?: boolean;
    body?: string;
    plainTextBody?: string;
}

export interface QuickReplyApi extends MessageApi {
    compose: MessageApi["compose"] & {
        getComposeDetails(tab_id: number): Promise<ComposeDetails>;
        setComposeDetails(tab_id: number, details: { body?: string; plainTextBody?: string }): Promise<void>;
    };
    quick_replies: QuickReplyStore;
}

const QUOTE_SELECTOR = "div.moz-cite-prefix, blockquote[type=cite]";

/** Plain compose: the text goes first and the quote follows after a blank line. */
export function insert_into_plain(body: string, text: string): string {
    return `${text}\n\n${body.replace(/^\n+/, "")}`;
}

/**
 * HTML compose: one `div` per line, then an empty paragraph, before the first quote node or at the top when there is no quote. Lines are set as `textContent`, so the text is escaped when the document is written out and never read as markup. The empty paragraph is Thunderbird's own blank line, which survives `setComposeDetails` where an empty `div` does not.
 * Known limit: with reply on top and the signature above the quote, the text lands below the signature.
 */
export function insert_into_html(html: string, text: string): string {
    const document = new DOMParser().parseFromString(html, "text/html");
    const anchor = document.body.querySelector(QUOTE_SELECTOR) ?? document.body.firstChild;
    const lines = text.split("\n").map((line) => {
        const block = document.createElement("div");
        if (line === "") block.append(document.createElement("br"));
        else block.textContent = line;
        return block;
    });
    const blank_line = document.createElement("p");
    blank_line.append(document.createElement("br"));
    for (const block of [...lines, blank_line]) document.body.insertBefore(block, anchor);
    return document.documentElement.outerHTML;
}

export async function reply_with(scope: HandlerScope<QuickReplyApi>, args: CheckedArgs): Promise<void> {
    const slot = Number(args["slot"]);
    const text = (await scope.api.quick_replies.read_slot(slot)).replace(/\r\n?/g, "\n");
    if (text.trim() === "") throw new RuntimeRefusal(`Quick reply ${slot} is empty. Write it on the options page.`);
    const { message, identity_id } = await newest_with_identity(scope);
    const tab = await scope.api.compose.beginReply(message.id, "replyToSender", { identityId: identity_id });
    const tab_id = tab?.id;
    if (tab_id === undefined) throw new RuntimeRefusal(`The reply opened, but quick reply ${slot} could not be added to it.`);
    const details = await scope.api.compose.getComposeDetails(tab_id);
    if (details.isPlainText) await scope.api.compose.setComposeDetails(tab_id, { plainTextBody: insert_into_plain(details.plainTextBody ?? "", text) });
    else await scope.api.compose.setComposeDetails(tab_id, { body: insert_into_html(details.body ?? "", text) });
}
