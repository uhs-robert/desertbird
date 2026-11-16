import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

export interface IdentityApi {
    identities: { list(account_id: string): Promise<unknown[]> };
}

// `compose.beginReply` crashes the whole app when the account has no identity, so this check must come first.
export async function require_identity(api: IdentityApi, account_id: string | undefined): Promise<void> {
    if (account_id === undefined) throw new RuntimeRefusal("This message has no account, so there is no identity to reply with.");
    const identities = await api.identities.list(account_id);
    if (identities.length === 0) throw new RuntimeRefusal("The account has no identity. Add one in the account settings, then reply again.");
}
