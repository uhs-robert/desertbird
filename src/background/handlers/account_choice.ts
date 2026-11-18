import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

export interface AccountsApi {
    accounts: { list(): Promise<{ id: string; name?: string }[]> };
}

/** The id of the account an `--account` flag names. The flag takes the account name that a folder row shows, or the id. Two accounts with one name make the name ambiguous, and the id is the way out. Only the running add-on knows which accounts exist, so an unknown name is a refusal here and not a validator error. */
export async function account_id_named(api: AccountsApi, name: string): Promise<string> {
    const accounts = await api.accounts.list();
    const wanted = name.toLowerCase();
    const by_id = accounts.find((account) => account.id === name);
    if (by_id !== undefined) return by_id.id;
    const by_name = accounts.filter((account) => account.name?.toLowerCase() === wanted);
    if (by_name.length > 1) throw new RuntimeRefusal(`More than one account is named ${name}. Name the account by its id: ${by_name.map((account) => account.id).join(", ")}.`);
    if (by_name[0] === undefined) throw new RuntimeRefusal(`There is no account named ${name}.`);
    return by_name[0].id;
}
