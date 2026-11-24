import assert from "node:assert/strict";
import { test } from "node:test";
import { create_matcher } from "../vendor/desertfox/keys/matcher.ts";
import { ANY_KEY } from "../vendor/desertfox/prefix_tree.ts";
import { DEFAULT_KEYMAP, compile_bindings, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import type { MailFolder } from "../src/background/handlers/displayed_folder.ts";
import { read_folder_state } from "../src/background/handlers/folder_state.ts";
import { start_jump_history } from "../src/background/handlers/jump_history.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import { fake_api } from "./fake_api.ts";

const folder = (account: string, path: string, special?: string): MailFolder => ({ id: `${account}:${path}`, accountId: account, path, ...(special && { specialUse: [special] }) });
const FOLDERS = [folder("a1", "/Inbox", "inbox"), folder("a1", "/Trash", "trash"), folder("a2", "/Inbox", "inbox"), folder("a2", "/Trash", "trash"), folder("a2", "/Archives", "archives"), folder("a1", "/Work/Plans")];

const invoke = (command: string, args: Record<string, string | boolean> = {}, count = 1) => ({ command, args, count, windowId: 3, messageIds: [] });
const run = (api: RouterApi, command: string, args?: Record<string, string | boolean>, count?: number) => create_router(registry, api).run(invoke(command, args, count));
const notifications = (calls: string[]) => calls.filter((call) => call.startsWith("notify")).map((call) => call.slice(7));
const updates = (calls: string[]) => calls.filter((call) => call.startsWith("mailTabs.update"));

test("M and ' bind one capture row each, and the key press fills the slot", () => {
    const { compiled, warnings } = compile_default_keymap();
    assert.deepEqual(warnings, []);
    const normal = compiled.modes.normal as { children: Record<string, { kind: string; children: Record<string, { steps: { capture?: string }[] }> }> };
    for (const [key, id] of [["M", "mark.set"], ["'", "mark.jump"]] as const) {
        assert.equal(normal.children[key]?.kind, "branch", key);
        assert.deepEqual(Object.keys(normal.children[key]?.children ?? {}), [ANY_KEY], key);
        assert.equal(normal.children[key]?.children[ANY_KEY]?.steps[0]?.capture, "slot", key);
        const matcher = create_matcher(compiled);
        assert.equal(matcher.feed("normal", key).kind_, "pending");
        const result = matcher.feed("normal", "q");
        assert.equal(result.kind_, "match");
        assert.deepEqual((result as { leaf: { steps: { invocation: unknown }[] } }).leaf.steps[0]?.invocation, { id, args: { slot: "q" } });
    }
    assert.equal(create_matcher(compiled).feed("normal", "M").kind_, "pending");
});

test("a saved binding of one slot runs, and the default capture row still takes every other key", () => {
    const { compiled, warnings } = compile_bindings({ ...DEFAULT_KEYMAP, normal: { ...DEFAULT_KEYMAP.normal, Ma: { id: "mark.set", args: { slot: "a" } }, "'z": { id: "mark.jump", args: { slot: "q" } } } }, {}, DEFAULT_KEYMAP);
    assert.deepEqual(warnings, []);
    const invocation_of = (keys: string[]) => {
        const matcher = create_matcher(compiled);
        const results = keys.map((key) => matcher.feed("normal", key));
        return (results[results.length - 1] as { leaf: { steps: { invocation: unknown }[] } }).leaf.steps[0]?.invocation;
    };
    assert.deepEqual(invocation_of(["M", "a"]), { id: "mark.set", args: { slot: "a" } });
    assert.deepEqual(invocation_of(["M", "b"]), { id: "mark.set", args: { slot: "b" } });
    assert.deepEqual(invocation_of(["'", "z"]), { id: "mark.jump", args: { slot: "q" } });
    assert.deepEqual(invocation_of(["'", "b"]), { id: "mark.jump", args: { slot: "b" } });
});

test("a stored null for an old slot key (Ma, 'a) leaves M and ' taking any key", () => {
    const { compiled } = compile_bindings({ ...DEFAULT_KEYMAP, normal: { ...DEFAULT_KEYMAP.normal, Ma: null, "'a": null } }, {}, DEFAULT_KEYMAP);
    for (const [prefix, id] of [["M", "mark.set"], ["'", "mark.jump"]] as const) {
        const matcher = create_matcher(compiled);
        assert.equal(matcher.feed("normal", prefix).kind_, "pending", prefix);
        const result = matcher.feed("normal", "q");
        assert.deepEqual((result as { leaf: { steps: { invocation: unknown }[] } }).leaf.steps[0]?.invocation, { id, args: { slot: "q" } }, prefix);
    }
});

test("a user key that unbinds or replaces M leaves no capture row behind", () => {
    for (const binding of [null, { id: "msg.archive" }]) {
        const { compiled } = compile_bindings({ ...DEFAULT_KEYMAP, normal: { ...DEFAULT_KEYMAP.normal, M: binding } }, {}, DEFAULT_KEYMAP);
        const node = (compiled.modes.normal as { children: Record<string, { kind: string } | undefined> }).children["M"];
        assert.ok(node === undefined || node.kind === "leaf", JSON.stringify(binding));
    }
});

test("m p stays unbound in the default keymap and g p holds the Thunderbird pages", () => {
    const { compiled } = compile_default_keymap();
    const normal = compiled.modes.normal as { children: Record<string, { children?: Record<string, unknown> }> };
    assert.deepEqual(Object.keys((normal.children["g"]?.children?.["p"] as { children: object }).children).sort(), ["a", "c", "t"]);
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

test("the slot reaches the handler as an argument and the validator rejects a slot that is not one key", async () => {
    for (const slot of ["ab", ""]) {
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

test("folder.open --inbox --account uses that account's inbox, and refuses an account without one", async () => {
    const accounts = [{ id: "a1", type: "imap", name: "Work" }, { id: "a2", type: "imap", name: "Home" }, { id: "a3", type: "imap", name: "Empty" }];
    const { api, calls } = fake_api({ folders: FOLDERS, accounts, displayed: FOLDERS[0] as MailFolder });
    await run(api, "folder.open", { special: "inbox", account: "Home" });
    assert.deepEqual(updates(calls), ["mailTabs.update 1 a2:/Inbox"]);
    await run(api, "folder.open", { special: "inbox", account: "Empty" });
    assert.equal(updates(calls).length, 1);
    assert.deepEqual(notifications(calls), ["There is no inbox folder in this account."]);
});

test("--account refuses a name two accounts share and takes their id", async () => {
    const accounts = [{ id: "a1", type: "imap", name: "Mail" }, { id: "a2", type: "imap", name: "mail" }];
    const { api, calls } = fake_api({ folders: FOLDERS, accounts, displayed: FOLDERS[0] as MailFolder });
    await run(api, "folder.open", { folder: "/Inbox", account: "Mail" });
    assert.equal(updates(calls).length, 0);
    assert.match(notifications(calls)[0] ?? "", /More than one account is named Mail\. Name the account by its id: a1, a2/);
    await run(api, "folder.open", { folder: "/Inbox", account: "a2" });
    assert.deepEqual(updates(calls), ["mailTabs.update 1 a2:/Inbox"]);
});

// The fake's `paneFocus` always succeeds and logs nothing, so a test swaps in a recorder that shares the call log.
function record_pane_focus(api: RouterApi, calls: string[], result = true): void {
    api.app!.paneFocus = async ({ pane }) => (calls.push(`paneFocus ${pane}`), result);
}
const display_and_focus = (calls: string[]) => calls.filter((call) => call.startsWith("mailTabs.update") || call.startsWith("paneFocus"));

test("folder.open focuses the thread list after the folder shows, for every way to name it", async () => {
    for (const args of [{ special: "trash" }, { folder: "/Work/Plans" }, { special: "inbox", account: "a1" }]) {
        const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[2] as MailFolder });
        record_pane_focus(api, calls);
        await run(api, "folder.open", args);
        const shown = display_and_focus(calls);
        assert.equal(shown.length, 2, JSON.stringify(args));
        assert.match(shown[0] as string, /^mailTabs\.update/);
        assert.equal(shown[1], "paneFocus threads");
    }
});

test("folder.open focuses nothing when it refuses, and ignores a refused focus", async () => {
    const missing = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    record_pane_focus(missing.api, missing.calls);
    await run(missing.api, "folder.open", { folder: "/Nope" });
    assert.deepEqual(display_and_focus(missing.calls), []);
    const refused = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    record_pane_focus(refused.api, refused.calls, false);
    await run(refused.api, "folder.open", { special: "trash" });
    assert.deepEqual(display_and_focus(refused.calls), ["mailTabs.update 1 a1:/Trash", "paneFocus threads"]);
    assert.deepEqual(notifications(refused.calls), []);
});

test("folder.open still focuses the thread list after the swallowed first-display error", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder, first_display_error: "An unexpected error occurred" });
    record_pane_focus(api, calls);
    await run(api, "folder.open", { special: "trash" });
    assert.deepEqual(display_and_focus(calls), ["mailTabs.update 1 a1:/Trash", "paneFocus threads"]);
    assert.deepEqual(notifications(calls), []);
});

test("mark.jump focuses the thread list after the folder shows", async () => {
    const jumped = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    await run(jumped.api, "mark.set", { slot: "i" });
    await run(jumped.api, "folder.open", { special: "trash" });
    record_pane_focus(jumped.api, jumped.calls);
    await run(jumped.api, "mark.jump", { slot: "i" });
    assert.deepEqual(display_and_focus(jumped.calls).slice(-2), ["mailTabs.update 1 a1:/Inbox", "paneFocus threads"]);
});

test("jump.back and jump.forward focus the thread list after the folder shows", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    start_jump_history(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await run(api, "folder.open", { special: "trash" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    record_pane_focus(api, calls);
    await run(api, "jump.back");
    assert.deepEqual(display_and_focus(calls).slice(-2), ["mailTabs.update 1 a1:/Inbox", "paneFocus threads"]);
    await run(api, "jump.forward");
    assert.deepEqual(display_and_focus(calls).slice(-2), ["mailTabs.update 1 a1:/Trash", "paneFocus threads"]);
});

const creates = (calls: string[]) => calls.filter((call) => call.startsWith("mailTabs.create"));
const create_and_focus = (calls: string[]) => calls.filter((call) => call.startsWith("mailTabs.create") || call.startsWith("paneFocus"));

test("folder.open --tab creates a tab on the special and path branches, and updates no tab", async () => {
    const accounts = [{ id: "a1", type: "imap", name: "Work" }, { id: "a2", type: "imap", name: "Home" }];
    const { api, calls } = fake_api({ folders: FOLDERS, accounts, displayed: FOLDERS[0] as MailFolder });
    record_pane_focus(api, calls);
    await run(api, "folder.open", { special: "trash", tab: true });
    assert.deepEqual(create_and_focus(calls), ["mailTabs.create a1:/Trash", "paneFocus threads"]);
    await run(api, "folder.open", { folder: "/Work/Plans", tab: true });
    await run(api, "folder.open", { folder: "/Inbox", account: "Home", tab: true });
    assert.deepEqual(creates(calls), ["mailTabs.create a1:/Trash", "mailTabs.create a1:/Work/Plans", "mailTabs.create a2:/Inbox"]);
    assert.deepEqual(updates(calls), []);
});

test("folder.open --tab creates nothing for a missing folder", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder });
    await run(api, "folder.open", { folder: "/Nope", tab: true });
    assert.deepEqual(creates(calls), []);
    assert.deepEqual(notifications(calls), ["There is no folder /Nope."]);
});

test("folder.open --tab accepts the first-display error of the new tab and still focuses the thread list", async () => {
    const { api, calls } = fake_api({ folders: FOLDERS, displayed: FOLDERS[0] as MailFolder, first_display_error: "An unexpected error occurred" });
    record_pane_focus(api, calls);
    await run(api, "folder.open", { folder: "/Work/Plans", tab: true });
    assert.deepEqual(notifications(calls), []);
    assert.deepEqual(create_and_focus(calls), ["mailTabs.create a1:/Work/Plans", "paneFocus threads"]);
});
