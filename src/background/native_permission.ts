// The `nativeMessaging` and `addressBooks` permissions are optional. The options page asks for them when the user saves a setting that needs them, and every native call and every contacts search checks its permission first. `addressBooks` is one grant for reading and changing contacts, which Thunderbird does not split. `test/no_address_book_write.test.ts` limits which files may name an address-book API.

export const NATIVE_PERMISSION = "nativeMessaging";
export const ADDRESS_BOOKS_PERMISSION = "addressBooks";

export interface PermissionsApi {
    permissions: {
        contains(query: { permissions: string[] }): Promise<boolean>;
        request(query: { permissions: string[] }): Promise<boolean>;
    };
}

/** Thrown before a native call when the permission is not granted. The message says how to grant it and can be shown as it is. */
export class NativePermissionMissing extends Error {}

export const missing_permission_message = (feature: string, setting: string): string => `${feature} needs the ${NATIVE_PERMISSION} permission, which is not granted. Open the DesertBird options, set ${setting} to true and press Save, then allow the prompt.`;

export async function require_native_permission(api: PermissionsApi, feature: string, setting: string): Promise<void> {
    if (!(await api.permissions.contains({ permissions: [NATIVE_PERMISSION] }))) throw new NativePermissionMissing(missing_permission_message(feature, setting));
}

/** The optional permissions a save of these settings needs, in the order they are asked for. Empty when none of the settings is on. */
export function permissions_needed(settings: { external_editor: boolean; bridge: boolean; bridge_share_contacts: boolean }): string[] {
    return [...(settings.external_editor || settings.bridge ? [NATIVE_PERMISSION] : []), ...(settings.bridge_share_contacts ? [ADDRESS_BOOKS_PERMISSION] : [])];
}

/** Asks the person. It resolves true without a prompt when every permission is already granted. It needs a user gesture, so call it first in a click handler. One request for all, so the person sees one prompt. */
export function request_permissions(api: PermissionsApi, permissions: string[]): Promise<boolean> {
    return api.permissions.request({ permissions });
}
