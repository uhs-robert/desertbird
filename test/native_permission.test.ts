import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create_editor_client } from "../src/background/external_editor.ts";
import { NativePermissionMissing, request_native_permission, require_native_permission } from "../src/background/native_permission.ts";

const api_with = (granted: boolean) => {
    const calls: string[] = [];
    return { calls, permissions: { contains: async () => (calls.push("contains"), granted), request: async (query: { permissions: string[] }) => (calls.push(`request ${query.permissions.join()}`), granted) } };
};

test("the manifest lists nativeMessaging as optional only", () => {
    const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8")) as { permissions: string[]; optional_permissions: string[] };
    assert.ok(!manifest.permissions.includes("nativeMessaging"));
    assert.deepEqual(manifest.optional_permissions, ["nativeMessaging"]);
});

test("a missing grant throws a message that says how to grant it, and a grant passes", async () => {
    await assert.rejects(require_native_permission(api_with(false), "The external editor", "external_editor"), (error: Error) => error instanceof NativePermissionMissing && /options.*external_editor.*Save/.test(error.message));
    await require_native_permission(api_with(true), "The bridge", "bridge");
});

test("a request asks for nativeMessaging and returns the answer", async () => {
    const granted = api_with(true);
    assert.equal(await request_native_permission(granted), true);
    assert.deepEqual(granted.calls, ["request nativeMessaging"]);
    assert.equal(await request_native_permission(api_with(false)), false);
});

test("the editor client passes the missing-permission error on as it is", async () => {
    const message = "The external editor needs the nativeMessaging permission";
    const client = create_editor_client(async () => {
        throw new NativePermissionMissing(message);
    });
    await assert.rejects(client.editor_start({ text: "", ext: "txt", insert: false, private: false }), (error: Error) => error.message === message);
});
