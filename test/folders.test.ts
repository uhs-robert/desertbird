import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_KEYMAP, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import type { MailFolder } from "../src/background/handlers/displayed_folder.ts";
import { read_folder_state } from "../src/background/handlers/folder_state.ts";
import { start_jump_history } from "../src/background/handlers/jump_history.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import { fake_api } from "./fake_api.ts";

const folder = (account: string, path: string, special?: string): MailFolder => ({ id: `${account}:${path}`, accountId: account, path, ...(special && { specialUse: [special] }) });
const FOLDERS = [folder("a1", "/Inbox", "inbox"), folder("a1", "/Trash", "trash"), folder("a2", "/Inbox", "inbox"), folder("a2", "/Trash", "trash"), folder("a2", "/Archives", "archives"), folder("a1", "/Work/Plans")];

const invoke = (command: string, args: Record<string, string> = {}, count = 1) => ({ command, args, count, windowId: 3, messageIds: [] });
const run = (api: RouterApi, command: string, args?: Record<string, string>, count?: number) => create_router(registry, api).run(invoke(command, args, count));
const notifications = (calls: string[]) => calls.filter((call) => call.startsWith("notify")).map((call) => call.slice(7));
const updates = (calls: string[]) => calls.filter((call) => call.startsWith("mailTabs.update"));

test("the keymap binds 21 mark leaves and 21 jump leaves with a fixed slot, and compiles with no warning", () => {
    const { compiled, warnings } = compile_default_keymap();
    assert.deepEqual(warnings, []);
    const normal = JSON.stringify(compiled.modes.normal);
    for (const key of ["M", "'"]) assert.ok(normal.includes(`"${key}"`), `prefix ${key} is bound`);
    const marks = ["a", "b", "c", "e", "h", "i", "j", "k", "l", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y"];
    for (const slot of marks) for (const [command, key] of [["mark.set", "M"], ["mark.jump", "'"]] as const) assert.deepEqual(DEFAULT_KEYMAP.normal?.[`${key}${slot}`], { id: command, args: { slot } }, `${key}${slot}`);
    assert.equal((normal.match(/"mark\.set"/g) ?? []).length, 21);
    assert.equal((normal.match(/"mark\.jump"/g) ?? []).length, 21);
});

test("g p and m p stay unbound in the default keymap", () => {
    const { compiled } = compile_default_keymap();
    const normal = compiled.modes.normal as { children: Record<string, { children?: Record<string, unknown> }> };
    assert.equal(normal.children["g"]?.children?.["p"], undefined);
    assert.equal(normal.children["m"]?.children?.["p"], undefined);
});

test("the bridge flags are folder.open, jump.* and mark.jump true, mark.set false", () => {
    const flag = (id: string) => (registry.get(id) as unknown as { bridge: boolean }).bridge;
    assert.deepEqual(["folder.open", "jump.back", "jump.forward", "mark.jump", "mark.set"].map(flag), [true, true, true, true, false]);
});

test("folder.open uses the shown folder's account first", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[2] as MailFolder });
    await run(api, "folder.open", { special: "trash" });
    assert.deepEqual(updates(calls), ["mailTabs.update 1 a2:/Trash"]);
});

test("folder.open falls back to any account when the shown account has none, and maps archive to archives", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    await run(api, "folder.open", { special: "archive" });
    assert.deepEqual(updates(calls), ["mailTabs.update 1 a2:/Archives"]);
});

test("folder.open refuses when no account has the folder", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    await run(api, "folder.open", { special: "drafts" });
    assert.deepEqual(updates(calls), []);
    assert.deepEqual(notifications(calls), ["There is no drafts folder."]);
});

test("folder.open takes a path in the shown account first, refuses a missing path and checks exactly one of special and folder", async () => {
    const shown = fake_api({ folders: FOLDERS, displayed: FOLDERS[2] as MailFolder });
    await run(shown.api, "folder.open", { folder: "/Inbox" });
    assert.deepEqual(updates(shown.calls), ["mailTabs.update 1 a2:/Inbox"]);
    const elsewhere = fake_api({ folders: FOLDERS, displayed: FOLDERS[2] as MailFolder });
    await run(elsewhere.api, "folder.open", { folder: "/Work/Plans" });
    assert.deepEqual(updates(elsewhere.calls), ["mailTabs.update 1 a1:/Work/Plans"]);
    const missing = fake_api({ folders: FOLDERS, displayed: FOLDERS[2] as MailFolder });
    await run(missing.api, "folder.open", { folder: "/Nope" });
    assert.deepEqual(notifications(missing.calls), ["There is no folder /Nope."]);
    for (const args of [{}, { special: "inbox", folder: "/Inbox" }, { folder: "Inbox" }, { special: "spam" }]) {
        const bad = fake_api({ folders: FOLDERS, displayed: FOLDERS[2] as MailFolder });
        await run(bad.api, "folder.open", args);
        assert.deepEqual(updates(bad.calls), [], JSON.stringify(args));
        assert.equal(notifications(bad.calls).length, 1, JSON.stringify(args));
    }
});

test("the first-display error is a success when the tab shows the folder, and the history records it once", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder, first_display_error: "An unexpected error occurred" });
    start_jump_history(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await run(api, "folder.open", { special: "trash" });
    assert.deepEqual(notifications(calls), []);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual((await read_folder_state(api)).history.entries.map((entry) => entry.path), ["/Inbox", "/Trash"]);
});

test("the first-display error is a success when the re-query hits the same error", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    let queries = 0;
    const original = api.mailTabs.query;
    api.mailTabs.query = (async (query: { windowId: number; active: true }) => {
        if (++queries > 1) throw new Error("An unexpected error occurred");
        return original(query);
    }) as typeof original;
    api.mailTabs.update = (async () => {
        throw new Error("An unexpected error occurred");
    }) as typeof api.mailTabs.update;
    await run(api, "folder.open", { special: "trash" });
    assert.deepEqual(notifications(calls), []);
});

test("the same error text with another folder shown is a failure, never matched on the text alone", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    api.mailTabs.update = (async () => {
        throw new Error("An unexpected error occurred");
    }) as typeof api.mailTabs.update;
    await run(api, "folder.open", { special: "trash" });
    assert.equal(notifications(calls).length, 1);
    assert.match(notifications(calls)[0] as string, /folder\.open failed: An unexpected error occurred/);
});

test("another error from the update is a failure", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder, first_display_error: "The folder is locked" });
    await run(api, "folder.open", { special: "trash" });
    assert.match(notifications(calls)[0] as string, /locked/);
});

test("a mark stores the account id and path, and the jump opens that folder", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[5] as MailFolder });
    await run(api, "mark.set", { slot: "a" });
    await run(api, "folder.open", { special: "trash" });
    await run(api, "mark.jump", { slot: "a" });
    assert.deepEqual(updates(calls), ["mailTabs.update 1 a1:/Trash", "mailTabs.update 1 a1:/Work/Plans"]);
    assert.deepEqual(notifications(calls), []);
});

test("marks survive a background restart", async () => {
    const storage: Record<string, unknown> = {};
    const before = fake_api({ folders: FOLDERS, displayed: FOLDERS[5] as MailFolder, storage });
    await run(before.api, "mark.set", { slot: "w" });
    const after = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder, storage });
    await run(after.api, "mark.jump", { slot: "w" });
    assert.deepEqual(updates(after.calls), ["mailTabs.update 1 a1:/Work/Plans"]);
});

test("an unset mark and a mark on a deleted folder refuse with a readable message", async () => {
    const unset = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    await run(unset.api, "mark.jump", { slot: "q" });
    assert.deepEqual(notifications(unset.calls), ["Mark q is not set."]);
    const storage: Record<string, unknown> = {};
    const setter = fake_api({ folders: FOLDERS, displayed: FOLDERS[5] as MailFolder, storage });
    await run(setter.api, "mark.set", { slot: "q" });
    const gone = fake_api({ folders: FOLDERS.filter((candidate) => candidate.path !== "/Work/Plans"), displayed: FOLDERS[0] as MailFolder, storage });
    await run(gone.api, "mark.jump", { slot: "q" });
    assert.deepEqual(updates(gone.calls), []);
    assert.deepEqual(notifications(gone.calls), ["Mark q points to /Work/Plans, which no longer exists."]);
});

test("the slot reaches the handler as an argument and the validator rejects any other slot", async () => {
    for (const slot of ["z", "ab", "", "A"]) {
        const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
        await run(api, "mark.set", { slot });
        assert.equal(calls.some((call) => call.startsWith("storage.set")), false, `slot ${JSON.stringify(slot)}`);
        assert.equal(notifications(calls).length, 1);
    }
});

test("mark.set with no folder displayed refuses", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS });
    await run(api, "mark.set", { slot: "a" });
    assert.deepEqual(notifications(calls), ["No folder is displayed."]);
});

test("folder.open --account opens the path in that account and refuses an unknown account or a path it lacks", async () => {
    const accounts = [{ id: "a1", type: "imap", name: "Work" }, { id: "a2", type: "imap", name: "Home" }];
    const { api, calls } = fake_api({ folders: FOLDERS, accounts, displayed: FOLDERS[0] as MailFolder });
    await run(api, "folder.open", { folder: "/Inbox", account: "home" });
    assert.deepEqual(updates(calls), ["mailTabs.update 1 a2:/Inbox"]);
    await run(api, "folder.open", { folder: "/Inbox", account: "Nowhere" });
    await run(api, "folder.open", { folder: "/Work/Plans", account: "Home" });
    assert.equal(updates(calls).length, 1);
    assert.deepEqual(notifications(calls), ["There is no account named Nowhere.", "There is no folder /Work/Plans in account Home."]);
});
