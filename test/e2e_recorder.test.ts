import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error plain .mjs tool module
import { start_recording } from "../tools/e2e/recorder.mjs";

// @ts-expect-error plain .mjs tool module
import { start_app } from "../tools/e2e/harness.mjs";

// The last test starts a real labwc session, so it skips on a host without the tools (CI).
const missing_tool = ["labwc", "wtype"].find((tool) => {
  try {
    execFileSync("which", [tool], { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
});
const skip = missing_tool === undefined ? false : `${missing_tool} is not installed`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

test("a recorder that ignores SIGINT is killed after the stop grace and the stop fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    const command = fake_recorder(dir, "trap '' INT\nwhile :; do sleep 0.1; done");
    const recording = await start_recording({ command, args: [], env: {}, log_file: join(dir, "log"), start_grace_ms: 200, stop_grace_ms: 300 });
    await assert.rejects(recording.stop(), /did not end cleanly/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a recorder that ended before the stop is a truncated film, even with code 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    const command = fake_recorder(dir, "sleep 0.5\nexit 0");
    const recording = await start_recording({ command, args: [], env: {}, log_file: join(dir, "log"), start_grace_ms: 100 });
    await sleep(1000);
    await assert.rejects(recording.stop(), /ended before the stop/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A child process: a stop grace timer left armed keeps its event loop alive for the whole grace.
test("a clean stop leaves no timer behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    const command = fake_recorder(dir, "trap 'exit 0' INT\nwhile :; do sleep 0.1; done");
    const script = `
      import { start_recording } from ${JSON.stringify(join(import.meta.dirname, "..", "tools", "e2e", "recorder.mjs"))};
      const recording = await start_recording({ command: ${JSON.stringify(command)}, args: [], env: {}, log_file: ${JSON.stringify(join(dir, "log"))}, start_grace_ms: 200, stop_grace_ms: 30000 });
      await recording.stop();`;
    const began = Date.now();
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL" });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(Date.now() - began < 10_000, "the process ended without waiting for the grace");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The real harness and the real session: the recorder group goes in through adopt_group and dies with the session stop.
test("an interrupted run reaches the recorder through adopt_group and the session stop", { skip, timeout: 40_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "rec-"));
  const instance = await start_app({ app: "betterbird", app_binary: "sleep", work_dir: join(root, "work"), run_dir: root, startup_ms: 10 });
  try {
    const command = fake_recorder(root, "while :; do sleep 0.1; done");
    const recording = await start_recording({ command, args: [], env: {}, log_file: join(root, "log"), adopt_group: instance.adopt_group, start_grace_ms: 200 });
    recording.assert_alive();
    await instance.stop();
    await sleep(500);
    assert.throws(() => recording.assert_alive(), /ended during the run/);
  } finally {
    await instance.stop().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});
