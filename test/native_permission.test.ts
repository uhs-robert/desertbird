import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create_editor_client } from "../src/background/external_editor.ts";
import { NativePermissionMissing, permissions_needed, request_permissions, require_native_permission } from "../src/background/native_permission.ts";

const api_with = (granted: boolean) => {
    const calls: string[] = [];
    return { calls, permissions: { contains: async () => (calls.push("contains"), granted), request: async (query: { permissions: string[] }) => (calls.push(`request ${query.permissions.join()}`), granted) } };
};

test("the manifest lists nativeMessaging and addressBooks as optional only", () => {
    const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8")) as { permissions: string[]; optional_permissions: string[] };
    assert.ok(!manifest.permissions.includes("nativeMessaging"));
    assert.ok(!manifest.permissions.includes("addressBooks"));
    assert.deepEqual(manifest.optional_permissions, ["addressBooks", "nativeMessaging"]);
});

test("a missing grant throws a message that says how to grant it, and a grant passes", async () => {
    await assert.rejects(require_native_permission(api_with(false), "The external editor", "external_editor"), (error: Error) => error instanceof NativePermissionMissing && /options.*external_editor.*Save/.test(error.message));
    await require_native_permission(api_with(true), "The bridge", "bridge");
});

test("a request asks for the permissions in one call and returns the answer", async () => {
    const granted = api_with(true);
    assert.equal(await request_permissions(granted, ["nativeMessaging", "addressBooks"]), true);
    assert.deepEqual(granted.calls, ["request nativeMessaging,addressBooks"]);
    assert.equal(await request_permissions(api_with(false), ["nativeMessaging"]), false);
});

test("a save needs both permissions in one request when the bridge and contacts are on, and none when they are off", () => {
    const off = { external_editor: false, bridge: false, bridge_share_contacts: false };
    assert.deepEqual(permissions_needed(off), []);
    assert.deepEqual(permissions_needed({ ...off, bridge: true }), ["nativeMessaging"]);
    assert.deepEqual(permissions_needed({ ...off, external_editor: true }), ["nativeMessaging"]);
    assert.deepEqual(permissions_needed({ ...off, bridge_share_contacts: true }), ["addressBooks"]);
    assert.deepEqual(permissions_needed({ ...off, bridge: true, bridge_share_contacts: true }), ["nativeMessaging", "addressBooks"]);
});

test("the editor client passes the missing-permission error on as it is", async () => {
    const message = "The external editor needs the nativeMessaging permission";
    const client = create_editor_client(async () => {
        throw new NativePermissionMissing(message);
    });
    await assert.rejects(client.editor_start({ text: "", ext: "txt", insert: false, private: false }), (error: Error) => error.message === message);
});
