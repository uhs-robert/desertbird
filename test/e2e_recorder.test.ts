import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error plain .mjs tool module
import { start_recording } from "../tools/e2e/recorder.mjs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function fake_recorder(dir: string, body: string) {
  const path = join(dir, "fake-recorder");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("a missing recorder fails the start with a clear message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    await assert.rejects(start_recording({ command: join(dir, "no-such-recorder"), args: [], env: {}, log_file: join(dir, "log") }), /did not start: .*ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a recorder that exits at start fails with the tail of its log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    const command = fake_recorder(dir, 'echo "no screencopy" >&2\nexit 3');
    await assert.rejects(start_recording({ command, args: [], env: {}, log_file: join(dir, "log"), start_grace_ms: 3000 }), /code 3[\s\S]*no screencopy/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a recorder that ends during the run fails assert_alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    const command = fake_recorder(dir, "sleep 1\nexit 1");
    const recording = await start_recording({ command, args: [], env: {}, log_file: join(dir, "log"), start_grace_ms: 100 });
    recording.assert_alive();
    await sleep(1500);
    assert.throws(() => recording.assert_alive(), /ended during the run/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("stop sends SIGINT and a recorder that finishes its file ends cleanly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    const command = fake_recorder(dir, "trap 'exit 0' INT\nwhile :; do sleep 0.1; done");
    const recording = await start_recording({ command, args: [], env: {}, log_file: join(dir, "log"), start_grace_ms: 200 });
    await recording.stop();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an interrupted run reaches the recorder through the adopted group", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    const command = fake_recorder(dir, "while :; do sleep 0.1; done");
    const groups: number[] = [];
    const recording = await start_recording({ command, args: [], env: {}, log_file: join(dir, "log"), adopt_group: (pid: number) => groups.push(pid), start_grace_ms: 200 });
    assert.equal(groups.length, 1);
    assert.ok(alive(groups[0]!));
    // What session.stop() does for each group of the session.
    process.kill(-groups[0]!, "SIGTERM");
    await sleep(500);
    assert.equal(alive(groups[0]!), false);
    assert.throws(() => recording.assert_alive(), /ended during the run/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
