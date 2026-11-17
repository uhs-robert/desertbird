import type { MessageHeader } from "./message.ts";

export interface MessagePage {
    /** Set while more pages follow. */
    id?: string | null;
    messages: MessageHeader[];
}

export interface MessageQuery {
    headerMessageId?: string;
    folderId?: string;
    accountId?: string;
    /** Thunderbird files archives by year, so a message sits in a subfolder such as Archives/2026. */
    includeSubFolders?: boolean;
    fromDate?: Date;
    autoPaginationTimeout: number;
}

export interface MessageQueryApi {
    query(query: MessageQuery): Promise<MessagePage>;
    continueList(list_id: string): Promise<MessagePage>;
}

/** Every page of one query. A page ends after a set number of matches, so the first page alone can miss a message. */
export async function query_all(api: MessageQueryApi, query: MessageQuery): Promise<MessageHeader[]> {
    const found: MessageHeader[] = [];
    let page = await api.query(query);
    for (;;) {
        found.push(...page.messages);
        if (page.id === undefined || page.id === null) return found;
        page = await api.continueList(page.id);
    }
}
