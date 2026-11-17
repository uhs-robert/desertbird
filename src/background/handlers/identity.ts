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

// Reply, forward and new compose with the identity Thunderbird would pick: one the message was addressed to (in the message's own account first, then in any account), then the message account's default identity, then the default account's. Local Folders, feed and news messages have no identity of their own, so the later steps lend one.
// `compose.beginReply` crashes the whole app and `beginForward` hangs when no identity exists anywhere, so the refusal comes before any compose call. `beginForward` also hangs with no named identity when there is no default account.
export async function resolve_identity(api: IdentityApi, message: IdentityContext): Promise<Identity> {
    const all = await api.identities.list();
    const [any] = all;
    if (any === undefined) throw new RuntimeRefusal("No account has an identity. Add one in the account settings, then try again.");
    const addressed = new Set([...(message.recipients ?? []), ...(message.ccList ?? []), ...(message.bccList ?? [])].map(address_of));
    const is_addressed = (identity: Identity) => addressed.has(identity.email.toLowerCase());
    const own_identities = message.folder === undefined ? [] : await api.identities.list(message.folder.accountId);
    const matching = own_identities.find(is_addressed) ?? all.find(is_addressed);
    if (matching !== undefined) return matching;
    const [own] = own_identities;
    if (own !== undefined) return own;
    const default_account = await api.accounts.getDefault();
    if (default_account !== null) {
        const [lent] = await api.identities.list(default_account.id);
        if (lent !== undefined) return lent;
    }
    return any;
}
