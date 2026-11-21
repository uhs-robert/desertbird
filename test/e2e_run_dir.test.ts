import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { acquire_lock, open_run_dir, assert_app_isolated, process_start_ticks } = await import(join(import.meta.dirname, "..", "tools", "e2e", "run_dir.mjs"));

async function in_tmp(body: (root: string) => void | Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "e2e-run-dir-test-"));
  try {
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const dead_pid = () => spawnSync("true").pid;
const lock_of = (dir: string) => join(dir, "run.lock");
const own_ticks = () => process_start_ticks(process.pid);

test("a lock held by a live process is refused", () => in_tmp((root) => {
  const first = acquire_lock(root);
  assert.throws(() => acquire_lock(root), /is held by the run with pid/);
  first();
}));

test("the lock names the pid and start time, and release removes it", () => in_tmp((root) => {
  const release = acquire_lock(root);
  assert.equal(readFileSync(lock_of(root), "utf8"), `${process.pid} ${own_ticks()}\n`);
  release();
  assert.ok(!existsSync(lock_of(root)));
}));

test("a lock of a dead pid is stale and taken over", () => in_tmp((root) => {
  writeFileSync(lock_of(root), `${dead_pid()} 1\n`);
  const release = acquire_lock(root);
  assert.equal(readFileSync(lock_of(root), "utf8").split(" ")[0], String(process.pid));
  release();
}));

test("a lock whose pid now belongs to a newer process is stale", () => in_tmp((root) => {
  writeFileSync(lock_of(root), `${process.pid} ${Number(own_ticks()) - 1}\n`);
  acquire_lock(root)();
  assert.ok(!existsSync(lock_of(root)));
}));

test("a garbled lock is stale", () => in_tmp((root) => {
  writeFileSync(lock_of(root), "not a pid\n");
  acquire_lock(root)();
}));

test("a stale takeover guard left by a dead run does not block the takeover", () => in_tmp((root) => {
  writeFileSync(lock_of(root), `${dead_pid()} 1\n`);
  mkdirSync(join(root, "run.lock.takeover"));
  const old = new Date(Date.now() - 60_000);
  spawnSync("touch", ["-d", old.toISOString(), join(root, "run.lock.takeover")]);
  acquire_lock(root)();
}));

test("a run that was killed leaves a lock the next run takes over", () => in_tmp(async (root) => {
  const script = `import { acquire_lock } from ${JSON.stringify(join(import.meta.dirname, "..", "tools", "e2e", "run_dir.mjs"))}; acquire_lock(${JSON.stringify(root)}); console.log("held"); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((done) => child.stdout.once("data", done));
  assert.throws(() => acquire_lock(root), /is held by the run with pid/);
  const exited = new Promise((done) => child.once("exit", done));
  child.kill("SIGKILL");
  await exited;
  acquire_lock(root)();
}));

test("a release after a takeover leaves the new holder's lock alone", () => in_tmp((root) => {
  const release = acquire_lock(root);
  writeFileSync(lock_of(root), `${process.ppid} ${process_start_ticks(process.ppid)}\n`);
  release();
  assert.ok(existsSync(lock_of(root)));
}));

test("with E2E_DIR unset the run gets a fresh dir each time, removed after a pass", () => in_tmp((root) => {
  const first = open_run_dir({ env: {}, tmp_root: root, real_home: "/nonexistent-home" });
  const second = open_run_dir({ env: {}, tmp_root: root, real_home: "/nonexistent-home" });
  assert.notEqual(first.dir, second.dir);
  assert.ok(first.dir.startsWith(root));
  assert.equal(first.close(true), "removed");
  assert.ok(!existsSync(first.dir));
  assert.equal(second.close(false), "kept");
  assert.ok(existsSync(second.dir));
}));

test("E2E_KEEP=1 keeps a dir after a pass", () => in_tmp((root) => {
  const run = open_run_dir({ env: { E2E_KEEP: "1" }, tmp_root: root, real_home: "/nonexistent-home" });
  assert.equal(run.close(true), "kept");
  assert.ok(existsSync(run.dir));
  assert.ok(!existsSync(lock_of(run.dir)));
}));

test("a dir named by E2E_DIR is locked, refused to a second run, and never removed", () => in_tmp((root) => {
  const named = join(root, "mine");
  const env = { E2E_DIR: named };
  const first = open_run_dir({ env, real_home: "/nonexistent-home" });
  assert.throws(() => open_run_dir({ env, real_home: "/nonexistent-home" }), /is held by the run with pid/);
  assert.ok(existsSync(named), "the refused run does not remove the dir of the live one");
  first.close(true);
  assert.ok(existsSync(named));
  open_run_dir({ env, real_home: "/nonexistent-home" }).close(true);
}));

test("E2E_DIR may not be the real home, above it or inside ~/.thunderbird", () => in_tmp((root) => {
  const home = join(root, "home");
  mkdirSync(join(home, ".thunderbird", "profile"), { recursive: true });
  for (const E2E_DIR of [home, root, "/", join(home, ".thunderbird"), join(home, ".thunderbird", "profile", "x")]) {
    assert.throws(() => open_run_dir({ env: { E2E_DIR }, real_home: home }), /E2E_DIR/, E2E_DIR);
  }
  assert.ok(!existsSync(lock_of(home)));
}));

// A run dir with a session runtime dir and a socket file, as start_session leaves it.
function session_like(root: string) {
  const run_dir = join(root, "run");
  const runtime = join(run_dir, "runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "wayland-0"), "");
  const home = join(root, "real_home");
  mkdirSync(join(home, ".thunderbird"), { recursive: true });
  const env = { HOME: join(run_dir, "home"), XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: "wayland-0" };
  return { run_dir, home, env, profile_dir: join(run_dir, "profile") };
}

test("the guard passes an app that sits inside the run dir", () => in_tmp((root) => {
  const { run_dir, home, env, profile_dir } = session_like(root);
  assert_app_isolated({ run_dir, profile_dir, env, real_home: home });
}));

test("the guard refuses a profile dir outside the run dir or inside ~/.thunderbird", () => in_tmp((root) => {
  const { run_dir, home, env } = session_like(root);
  for (const profile_dir of [join(root, "elsewhere"), join(home, ".thunderbird", "z3hegesv.default-default"), join(run_dir, "..", "run2")]) {
    assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env, real_home: home }), /profile dir/, profile_dir);
  }
}));

test("the guard refuses a profile reached through a link into the real thunderbird dir", () => in_tmp((root) => {
  const { run_dir, home, env } = session_like(root);
  symlinkSync(join(home, ".thunderbird"), join(run_dir, "link"));
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir: join(run_dir, "link", "p"), env, real_home: home }), /inside ~\/\.thunderbird/);
}));

test("the guard refuses a HOME that is the real home, inside ~/.thunderbird, outside the run dir or unset", () => in_tmp((root) => {
  const { run_dir, home, env, profile_dir } = session_like(root);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, HOME: home }, real_home: home }), /HOME is the real home/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, HOME: join(home, ".thunderbird") }, real_home: home }), /inside ~\/\.thunderbird/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, HOME: join(root, "other") }, real_home: home }), /HOME .* is not under the run dir/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, HOME: undefined }, real_home: home }), /HOME is not set/);
}));

test("the guard refuses a Wayland display from outside the run dir", () => in_tmp((root) => {
  const { run_dir, home, env, profile_dir } = session_like(root);
  const parent_runtime = join(root, "user_runtime");
  mkdirSync(parent_runtime);
  writeFileSync(join(parent_runtime, "wayland-1"), "");
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, XDG_RUNTIME_DIR: parent_runtime, WAYLAND_DISPLAY: "wayland-1" }, real_home: home }), /XDG_RUNTIME_DIR/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, WAYLAND_DISPLAY: join(parent_runtime, "wayland-1") }, real_home: home }), /WAYLAND_DISPLAY/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, WAYLAND_DISPLAY: "wayland-9" }, real_home: home }), /WAYLAND_DISPLAY/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, WAYLAND_DISPLAY: undefined }, real_home: home }), /WAYLAND_DISPLAY/);
}));
