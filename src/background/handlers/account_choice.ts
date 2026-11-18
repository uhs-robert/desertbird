import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

export interface AccountsApi {
    accounts: { list(): Promise<{ id: string; name?: string }[]> };
}

/** The id of the account an `--account` flag names. The flag takes the account name that a folder row shows, or the id. Only the running add-on knows which accounts exist, so an unknown name is a refusal here and not a validator error. */
export async function account_id_named(api: AccountsApi, name: string): Promise<string> {
    const accounts = await api.accounts.list();
    const wanted = name.toLowerCase();
    const found = accounts.find((account) => account.id === name) ?? accounts.find((account) => account.name?.toLowerCase() === wanted);
    if (found === undefined) throw new RuntimeRefusal(`There is no account named ${name}.`);
    return found.id;
}
