import type { RouterApi } from "../src/background/router.ts";
import type { MailFolder } from "../src/background/handlers/displayed_folder.ts";
import type { Identity } from "../src/background/handlers/identity.ts";
import type { MailTag, MessageHeader } from "../src/background/handlers/message.ts";

interface FakeOptions {
    /** The messages `messages.get` knows. */
    messages?: (Partial<MessageHeader> & { id: number })[];
    identities?: (Identity & { account_id: string })[];
    experiment?: boolean;
    tags?: MailTag[];
    folders?: MailFolder[];
    displayed?: MailFolder;
    /** The default account. `null` means there is none. */
    default_account?: { id: string } | null;
}

/** A recording fake of the API subset. `calls` holds one line per call, in order. */
export function fake_api(options: FakeOptions = {}): { api: RouterApi; calls: string[] } {
    const calls: string[] = [];
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
            move: async (ids, folder_id) => void calls.push(`messages.move ${ids.join(",")} ${folder_id}`),
            tags: { list: async () => (calls.push("messages.tags.list"), options.tags ?? []) },
        },
        compose: {
            beginReply: async (id, type, details) => (calls.push(`compose.beginReply ${id} ${type} ${details.identityId}`), undefined),
            beginForward: async (id, _type, details) => (calls.push(`compose.beginForward ${id} ${details.identityId}`), undefined),
            beginNew: async () => (calls.push("compose.beginNew"), undefined),
        },
        identities: {
            list: async (account_id) => {
                calls.push(`identities.list${account_id === undefined ? "" : ` ${account_id}`}`);
                return (options.identities ?? [{ id: "i1", email: "me@x.invalid", account_id: "a1" }]).filter((identity) => account_id === undefined || identity.account_id === account_id);
            },
        },
        accounts: { getDefault: async () => (calls.push("accounts.getDefault"), options.default_account === undefined ? { id: "a1" } : options.default_account) },
        folders: {
            query: async (query) => {
                calls.push(`folders.query ${JSON.stringify(query)}`);
                return (options.folders ?? []).filter((folder) => (query.path === undefined || folder.path === query.path) && (query.accountId === undefined || folder.accountId === query.accountId));
            },
            markAsRead: async (folder_id) => void calls.push(`folders.markAsRead ${folder_id}`),
        },
        mailTabs: { query: async (query) => (calls.push(`mailTabs.query ${query.windowId}`), options.displayed === undefined ? [{ id: 1 }] : [{ id: 1, displayedFolder: options.displayed }]), update: async () => undefined, setQuickFilter: async () => {} },
        notifications: { create: async (_id, notification) => (calls.push(`notify ${notification.message}`), "n1") },
        keys: options.experiment === false ? undefined : { install: async () => {}, onInvocation: { addListener: () => {}, removeListener: () => {} } },
    };
    return { api, calls };
}
