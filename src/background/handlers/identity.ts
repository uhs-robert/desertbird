import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

export interface Identity {
    id: string;
    email: string;
}

export interface IdentityApi {
    accounts: { getDefault(): Promise<{ id: string } | null> };
    identities: { list(account_id?: string): Promise<Identity[]> };
}

/** The parts of a message that pick an identity. */
export interface IdentityContext {
    recipients?: string[];
    ccList?: string[];
    bccList?: string[];
    folder?: { accountId: string };
}

const address_of = (entry: string): string => (/<([^>]+)>/.exec(entry)?.[1] ?? entry).trim().toLowerCase();

// Reply, forward and new compose with the identity Thunderbird would pick: one the message was addressed to, in any account, then the message account's default identity, then the default account's. Local Folders, feed and news messages have no identity of their own, so the later steps lend one.
// `compose.beginReply` crashes the whole app and `beginForward` hangs when no identity exists anywhere, so the refusal comes before any compose call. `beginForward` also hangs unless the call names the identity.
export async function resolve_identity(api: IdentityApi, message: IdentityContext): Promise<Identity> {
    const all = await api.identities.list();
    const [any] = all;
    if (any === undefined) throw new RuntimeRefusal("No account has an identity. Add one in the account settings, then try again.");
    const addressed = new Set([...(message.recipients ?? []), ...(message.ccList ?? []), ...(message.bccList ?? [])].map(address_of));
    const matching = all.find((identity) => addressed.has(identity.email.toLowerCase()));
    if (matching !== undefined) return matching;
    if (message.folder !== undefined) {
        const [own] = await api.identities.list(message.folder.accountId);
        if (own !== undefined) return own;
    }
    const default_account = await api.accounts.getDefault();
    if (default_account !== null) {
        const [lent] = await api.identities.list(default_account.id);
        if (lent !== undefined) return lent;
    }
    return any;
}
