import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeRefusal } from "../vendor/desertfox/command.ts";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, registry } from "../src/background/commands/index.ts";
import { save_attachments } from "../src/background/handlers/attachments.ts";
import type { BlobUrls } from "../src/background/handlers/attachments.ts";
import { fake_api } from "./fake_api.ts";

const date = new Date(2026, 10, 3);
const run = (options: Parameters<typeof fake_api>[0], message_ids: number[], where = "downloads", fallback_ms = 60_000) => {
    const fake = fake_api(options);
    const events: string[] = [];
    const urls: BlobUrls = { create: () => (events.push("create"), `blob:${events.length}`), revoke: (url) => void events.push(`revoke ${url}`) };
    const done = save_attachments({ api: fake.api, window_id: 1, message_ids, count: 1 }, { where }, urls, fallback_ms);
    return { ...fake, events, done };
};
const downloads = (calls: string[]) => calls.filter((call) => call.startsWith("download "));
const notices = (calls: string[]) => calls.filter((call) => call.startsWith("notify "));

test("the key is bound and the where argument is a fixed enum", () => {
    assert.deepEqual(DEFAULT_KEYMAP.normal?.["ga"], { id: "msg.save_attachments" });
    const command = registry.get("msg.save_attachments")!;
    assert.equal(check_args(command, { where: "ask" }).ok, true);
    assert.equal(check_args(command, { where: "/tmp" }).ok, false);
});

test("each attachment goes to Downloads/DesertBird/<date>-<subject>/<name> with uniquify, and the count and folder are notified", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "Q3 / report", date }], attachments: { 1: [{ name: "a.pdf", partName: "1.2" }, { name: "../b.txt", partName: "1.3" }] } }, [1]);
    await done;
    assert.equal(downloads(calls)[0], "download DesertBird/2026-11-03-Q3 _ report/a.pdf saveAs=false uniquify");
    assert.match(downloads(calls)[1]!, /^download DesertBird\/2026-11-03-Q3 _ report\/_b\.txt saveAs=false uniquify$/);
    assert.deepEqual(notices(calls), ["notify Saving 2 attachments to Downloads/DesertBird/2026-11-03-Q3 _ report."]);
});

test("the ask variant sets saveAs", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "a", partName: "1.2" }] } }, [1], "ask");
    await done;
    assert.match(downloads(calls)[0]!, /saveAs=true/);
});

test("a message without attachments refuses and downloads nothing", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "S", date }] }, [1]);
    await assert.rejects(done, RuntimeRefusal);
    assert.deepEqual(downloads(calls), []);
});

test("a multi-message selection saves each message to its own folder and skips one without attachments", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "One", date }, { id: 2, subject: "Two", date }, { id: 3, subject: "Three", date }], attachments: { 1: [{ name: "a", partName: "1.2" }], 3: [{ name: "c", partName: "1.2" }] } }, [1, 2, 3]);
    await done;
    assert.deepEqual(downloads(calls).map((call) => call.split(" saveAs")[0]), ["download DesertBird/2026-11-03-One/a", "download DesertBird/2026-11-03-Three/c"]);
    assert.deepEqual(notices(calls), ["notify Saving 2 attachments to Downloads/DesertBird."]);
});

test("a blob URL is revoked only after its download ends, and the command does not wait for the end", async () => {
    const { events, done, end_held_downloads } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "a", partName: "1.2" }, { name: "b", partName: "1.3" }] }, download_state: "hold" }, [1]);
    await done;
    assert.deepEqual(events, ["create", "create"]);
    end_held_downloads();
    assert.deepEqual(events, ["create", "create", "revoke blob:1", "revoke blob:2"]);
});

test("a download that never ends is revoked by the fallback", async () => {
    const { events, done } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "a", partName: "1.2" }] }, download_state: "hold" }, [1], "downloads", 5);
    await done;
    assert.deepEqual(events, ["create"]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(events, ["create", "revoke blob:1"]);
});

test("an interrupted download still revokes its URL", async () => {
    const { events, done } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "a", partName: "1.2" }] }, download_state: "interrupted" }, [1]);
    await done;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(events, ["create", "revoke blob:1"]);
});

test("a canceled save dialog counts as failed, revokes the URL and refuses when nothing saved", async () => {
    const { events, calls, done } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "a", partName: "1.2" }] }, download_error: "Download canceled by the user" }, [1], "ask");
    await assert.rejects(done, RuntimeRefusal);
    assert.deepEqual(events, ["create", "revoke blob:1"]);
    assert.deepEqual(notices(calls), []);
});

test("an unreadable attachment does not stop the rest, and the notice counts both", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "a", partName: "1.2" }, { name: "b", partName: "1.3" }, { name: "c", partName: "1.4" }] }, unreadable_parts: ["1.3"] }, [1]);
    await done;
    assert.deepEqual(downloads(calls).map((call) => call.split(" saveAs")[0]), ["download DesertBird/2026-11-03-S/a", "download DesertBird/2026-11-03-S/c"]);
    assert.deepEqual(notices(calls), ["notify Saving 2 attachments to Downloads/DesertBird/2026-11-03-S. 1 did not save."]);
});

test("ask does not name a folder in the notice", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "a", partName: "1.2" }] } }, [1], "ask");
    await done;
    assert.deepEqual(notices(calls), ["notify Saving 1 attachment."]);
});

test("inline parts and removed attachments are skipped and counted", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "logo.png", partName: "1.2", contentDisposition: "inline" }, { name: "old.pdf", partName: "1.3", contentDisposition: "attachment", type: "deleted" }, { name: "far.zip", partName: "1.4", type: "detached" }, { name: "keep.pdf", partName: "1.5", contentDisposition: "attachment", type: "normal" }] } }, [1]);
    await done;
    assert.deepEqual(downloads(calls).map((call) => call.split(" saveAs")[0]), ["download DesertBird/2026-11-03-S/keep.pdf"]);
    assert.deepEqual(notices(calls), ["notify Saving 1 attachment to Downloads/DesertBird/2026-11-03-S. Skipped 3 inline or removed parts."]);
});

test("a message with only inline parts refuses and says what it skipped", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "S", date }], attachments: { 1: [{ name: "logo.png", partName: "1.2", contentDisposition: "inline" }] } }, [1]);
    await assert.rejects(done, /Skipped 1 inline or removed part\./);
    assert.deepEqual(downloads(calls), []);
});

test("a hostile subject and a nameless attachment still give safe paths", async () => {
    const { calls, done } = run({ messages: [{ id: 1, subject: "../../x‮", date }], attachments: { 1: [{ name: "", partName: "1.2" }] } }, [1]);
    await done;
    assert.match(downloads(calls)[0]!, /^download DesertBird\/2026-11-03-_\.\._x_\/attachment-1 /);
});
