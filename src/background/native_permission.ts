// The `nativeMessaging` permission is optional. The options page asks for it when the user saves a setting that needs the native host, and every native call checks it first.

export const NATIVE_PERMISSION = "nativeMessaging";

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
