// The `nativeMessaging` and `addressBooks` permissions are optional. The options page asks for them when the user saves a setting that needs them, and every native call and every contacts search checks its permission first. `addressBooks` is one grant for reading and changing contacts, which Thunderbird does not split, so only the contacts read uses it and nothing in `src/` writes to an address book.

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

/** Asks the person. It resolves true without a prompt when the permission is already granted. It needs a user gesture, so call it first in a click handler. */
export function request_native_permission(api: PermissionsApi): Promise<boolean> {
    return api.permissions.request({ permissions: [NATIVE_PERMISSION] });
}

/** One request for several optional permissions, so the person sees one prompt and one gesture covers all. */
export function request_permissions(api: PermissionsApi, permissions: string[]): Promise<boolean> {
    return api.permissions.request({ permissions });
}
