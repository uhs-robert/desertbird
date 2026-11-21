import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import net from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const tools_dir = join(import.meta.dirname, "..", "tools", "e2e");
const { acquire_lock, open_run_dir, assert_app_isolated, assert_start_paths, refuse_dangerous_dir, process_start_ticks } = await import(join(tools_dir, "run_dir.mjs"));

// A real unix socket, as labwc leaves in the runtime dir. Closed when the test ends.
const open_servers: net.Server[] = [];
function listen_on(path: string) {
  return new Promise<net.Server>((done) => { const server = net.createServer(); open_servers.push(server); server.listen(path, () => done(server)); });
}

async function in_tmp(body: (root: string) => void | Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "e2e-run-dir-test-"));
  try {
    await body(root);
  } finally {
    for (const server of open_servers.splice(0)) server.close();
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
  const release = acquire_lock(root);
  assert.equal(readFileSync(lock_of(root), "utf8"), `${process.pid} ${own_ticks()}\n`);
  release();
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
async function session_like(root: string) {
  const run_dir = join(root, "run");
  const runtime = join(run_dir, "runtime");
  mkdirSync(runtime, { recursive: true });
  await listen_on(join(runtime, "wayland-0"));
  const home = join(root, "real_home");
  mkdirSync(join(home, ".thunderbird"), { recursive: true });
  const env = { HOME: join(run_dir, "home"), XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: "wayland-0" };
  return { run_dir, home, env, profile_dir: join(run_dir, "profile") };
}

test("the guard passes an app that sits inside the run dir", () => in_tmp(async (root) => {
  const { run_dir, home, env, profile_dir } = await session_like(root);
  assert_app_isolated({ run_dir, profile_dir, env, real_home: home });
}));

test("the guard refuses a profile dir outside the run dir or inside ~/.thunderbird", () => in_tmp(async (root) => {
  const { run_dir, home, env } = await session_like(root);
  for (const profile_dir of [join(root, "elsewhere"), join(home, ".thunderbird", "z3hegesv.default-default"), join(run_dir, "..", "run2")]) {
    assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env, real_home: home }), /profile dir/, profile_dir);
  }
}));

test("the guard refuses a profile reached through a link into the real thunderbird dir", () => in_tmp(async (root) => {
  const { run_dir, home, env } = await session_like(root);
  symlinkSync(join(home, ".thunderbird"), join(run_dir, "link"));
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir: join(run_dir, "link", "p"), env, real_home: home }), /inside ~\/\.thunderbird/);
}));

test("the guard refuses a HOME that is the real home, inside ~/.thunderbird, outside the run dir or unset", () => in_tmp(async (root) => {
  const { run_dir, home, env, profile_dir } = await session_like(root);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, HOME: home }, real_home: home }), /HOME is the real home/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, HOME: join(home, ".thunderbird") }, real_home: home }), /inside ~\/\.thunderbird/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, HOME: join(root, "other") }, real_home: home }), /HOME .* is not under the run dir/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, HOME: undefined }, real_home: home }), /HOME is not set/);
}));

test("the guard refuses a Wayland display from outside the run dir", () => in_tmp(async (root) => {
  const { run_dir, home, env, profile_dir } = await session_like(root);
  const parent_runtime = join(root, "user_runtime");
  mkdirSync(parent_runtime);
  writeFileSync(join(parent_runtime, "wayland-1"), "");
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, XDG_RUNTIME_DIR: parent_runtime, WAYLAND_DISPLAY: "wayland-1" }, real_home: home }), /XDG_RUNTIME_DIR/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, WAYLAND_DISPLAY: join(parent_runtime, "wayland-1") }, real_home: home }), /WAYLAND_DISPLAY/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, WAYLAND_DISPLAY: "wayland-9" }, real_home: home }), /WAYLAND_DISPLAY/);
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env: { ...env, WAYLAND_DISPLAY: undefined }, real_home: home }), /WAYLAND_DISPLAY/);
}));

test("the guard accepts a real socket and refuses a link to a socket outside the run dir", () => in_tmp(async (root) => {
  const { run_dir, home, env, profile_dir } = await session_like(root);
  const runtime = env.XDG_RUNTIME_DIR;
  assert_app_isolated({ run_dir, profile_dir, env, real_home: home });
  rmSync(join(runtime, "wayland-0"));
  const parent_socket = join(root, "parent.sock");
  const owners = await listen_on(parent_socket);
  symlinkSync(parent_socket, join(runtime, "wayland-0"));
  assert.throws(() => assert_app_isolated({ run_dir, profile_dir, env, real_home: home }), /WAYLAND_DISPLAY/);
}));

test("a HOME set in the environment does not hide the passwd home's ~/.thunderbird", () => {
  const passwd_profile = join(userInfo().homedir, ".thunderbird", "z3hegesv.default-default");
  const before = process.env.HOME;
  process.env.HOME = join(tmpdir(), "fake-home-for-test");
  try {
    assert.throws(() => refuse_dangerous_dir(passwd_profile), /~\/\.thunderbird/);
    assert.throws(() => open_run_dir({ env: { E2E_DIR: passwd_profile } }), /~\/\.thunderbird/);
    assert.throws(() => assert_app_isolated({ run_dir: passwd_profile, profile_dir: join(passwd_profile, "profile"), env: { HOME: userInfo().homedir, XDG_RUNTIME_DIR: "/x", WAYLAND_DISPLAY: "w" } }), /HOME is the real home/);
  } finally {
    process.env.HOME = before;
  }
});

test("start paths that are links out of the run dir or into a real home are refused", () => in_tmp(async (root) => {
  const { run_dir, home } = await session_like(root);
  mkdirSync(join(root, "outside"));
  symlinkSync(join(root, "outside"), join(run_dir, "profile"));
  symlinkSync(join(home, ".thunderbird"), join(run_dir, "tb"));
  symlinkSync(home, join(run_dir, "home_link"));
  assert_start_paths({ run_dir, paths: [join(run_dir, "kind"), join(run_dir, "kind", "profile")], real_home: home });
  for (const path of [join(run_dir, "profile"), join(run_dir, "tb"), join(run_dir, "tb", "x"), join(run_dir, "home_link"), join(root, "outside")]) {
    assert.throws(() => assert_app_isolated_paths(run_dir, path, home), /refusing to start an app/, path);
  }
}));
function assert_app_isolated_paths(run_dir: string, path: string, home: string) {
  assert_start_paths({ run_dir, paths: [path], real_home: home });
}

test("two runs that find one stale lock at once leave exactly one holder", () => in_tmp(async (root) => {
  writeFileSync(lock_of(root), `${dead_pid()} 1\n`);
  const script = `import { acquire_lock } from ${JSON.stringify(join(tools_dir, "run_dir.mjs"))};
    try { acquire_lock(${JSON.stringify(root)}); console.log("won"); } catch (error) { console.log("refused: " + error.message); }
    process.stdin.resume();`;
  const children = Array.from({ length: 8 }, () => spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "inherit"] }));
  const answers = await Promise.all(children.map((child) => new Promise<string>((done) => child.stdout.once("data", (data) => done(String(data).trim())))));
  for (const child of children) child.stdin.end();
  assert.equal(answers.filter((answer) => answer === "won").length, 1, answers.join("\n"));
  assert.ok(answers.every((answer) => answer === "won" || /is held by the run with pid/.test(answer)), answers.join("\n"));
}));

// A child that runs the real lifecycle wiring with a fake session: a detached process group that stands in for labwc and the app.
// `ignore_term` makes the group survive SIGTERM, so only the SIGKILL after the grace ends it, as with a hung app.
function lifecycle_child(root: string, body: string) {
  const script = `import { spawn } from "node:child_process";
    import { install_lifecycle, track_session, track_start, stop_all_apps } from ${JSON.stringify(join(tools_dir, "harness.mjs"))};
    import { open_run_dir } from ${JSON.stringify(join(tools_dir, "run_dir.mjs"))};
    const run_dir = open_run_dir({ env: { E2E_DIR: ${JSON.stringify(root)} } });
    install_lifecycle(run_dir);
    const fake_session = (ignore_term) => {
      const group = spawn("sh", ["-c", ignore_term ? "trap '' TERM; while :; do sleep 1; done" : "sleep 600"], { detached: true, stdio: "ignore" });
      group.unref();
      const groups = [group.pid];
      return { groups, stop: () => { try { process.kill(-group.pid, "SIGTERM"); } catch {} setTimeout(() => { try { process.kill(-group.pid, "SIGKILL"); } catch {} }, 3000).unref(); } };
    };
    setInterval(() => {}, 1000);
    ${body}`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  const lines: string[] = [];
  const waiters: Array<() => void> = [];
  child.stdout.on("data", (data) => { lines.push(...String(data).split("\n").filter(Boolean)); waiters.splice(0).forEach((wake) => wake()); });
  const exited = new Promise<{ code: number | null; at: number }>((done) => child.once("exit", (code) => done({ code, at: Date.now() })));
  const line_starting = async (prefix: string) => {
    for (;;) {
      const found = lines.find((line) => line.startsWith(prefix));
      if (found) return found;
      await new Promise<void>((wake) => waiters.push(wake));
    }
  };
  return { child, exited, line_starting };
}
const pids_of = (line: string) => line.split(" ").slice(1).map(Number) as [number, number];
const group_alive = (pgid: number) => { try { process.kill(-pgid, 0); return true; } catch { return false; } };

test("SIGTERM stops every tracked group, frees the lock and exits 143", () => in_tmp(async (root) => {
  const { child, exited, line_starting } = lifecycle_child(root, `const a = track_session(fake_session(false)); const b = track_session(fake_session(true)); console.log("ready " + a.groups[0] + " " + b.groups[0]);`);
  const [first, second] = pids_of(await line_starting("ready"));
  assert.ok(existsSync(lock_of(root)));
  child.kill("SIGTERM");
  const { code } = await exited;
  assert.equal(code, 143);
  assert.ok(!existsSync(lock_of(root)));
  assert.ok(!group_alive(first) && !group_alive(second));
}));

test("a second signal during the shutdown does not cut the kill grace short", () => in_tmp(async (root) => {
  const { child, exited, line_starting } = lifecycle_child(root, `const a = track_session(fake_session(true)); console.log("ready " + a.groups[0]);`);
  const [group] = pids_of(await line_starting("ready"));
  const first_at = Date.now();
  child.kill("SIGTERM");
  await new Promise((wake) => setTimeout(wake, 500));
  child.kill("SIGINT");
  const { code, at } = await exited;
  assert.equal(code, 143, "the first signal's code");
  assert.ok(at - first_at >= 3000, `the process lived ${at - first_at} ms, short of the kill grace`);
  assert.ok(!group_alive(group), "the group that ignored SIGTERM is dead");
  assert.ok(!existsSync(lock_of(root)));
}));

test("a signal while a session is still starting waits for it and stops it", () => in_tmp(async (root) => {
  const { child, exited, line_starting } = lifecycle_child(root, `
    let session;
    track_start(new Promise((done) => setTimeout(() => { session = fake_session(false); track_session(session); console.log("started " + session.groups[0]); done(session); }, 1000)));
    console.log("ready");`);
  await line_starting("ready");
  child.kill("SIGINT");
  const { code } = await exited;
  const [group] = pids_of(await line_starting("started"));
  assert.equal(code, 130);
  assert.ok(!group_alive(group), "the session that came up during the shutdown is stopped");
  assert.ok(!existsSync(lock_of(root)));
}));

test("an uncaught error kills every tracked group, frees the lock and exits 1", () => in_tmp(async (root) => {
  const { exited, line_starting } = lifecycle_child(root, `const a = track_session(fake_session(true)); console.log("ready " + a.groups[0]); setTimeout(() => { throw new Error("boom"); }, 200);`);
  const [group] = pids_of(await line_starting("ready"));
  const { code } = await exited;
  assert.equal(code, 1);
  assert.ok(!group_alive(group));
  assert.ok(!existsSync(lock_of(root)));
}));

test("a dangling link to a place outside the run dir is refused", () => in_tmp((root) => {
  const run_dir = join(root, "run");
  mkdirSync(run_dir);
  const outside = join(root, "outside", "not_made_yet");
  symlinkSync(outside, join(run_dir, "profile"));
  symlinkSync(join(run_dir, "profile"), join(run_dir, "chained"));
  symlinkSync("../outside/not_made_yet", join(run_dir, "relative"));
  assert.ok(!existsSync(outside));
  for (const name of ["profile", "chained", "relative"]) {
    assert.throws(() => assert_start_paths({ run_dir, paths: [join(run_dir, name)], real_home: join(root, "home") }), /outside the run dir/, name);
    assert.throws(() => assert_start_paths({ run_dir, paths: [join(run_dir, name, "deeper")], real_home: join(root, "home") }), /outside the run dir/, name);
  }
  assert_start_paths({ run_dir, paths: [join(run_dir, "fresh", "child")], real_home: join(root, "home") });
}));

test("a dangling link that points inside the run dir is accepted", () => in_tmp((root) => {
  const run_dir = join(root, "run");
  mkdirSync(run_dir);
  symlinkSync(join(run_dir, "later"), join(run_dir, "link"));
  assert_start_paths({ run_dir, paths: [join(run_dir, "link")], real_home: join(root, "home") });
}));

test("a symlinked home under a reused E2E_DIR is refused before the editor host writes anything", () => in_tmp((root) => {
  const e2e_dir = join(root, "reused");
  const kind_dir = join(e2e_dir, "betterbird", "compose_editor", "main");
  const outside = join(root, "owner_home");
  mkdirSync(kind_dir, { recursive: true });
  mkdirSync(outside);
  symlinkSync(outside, join(kind_dir, "home"));
  // /bin/true stands in for the binary. The run must stop on the guard, long before any app would start.
  const run = spawnSync(process.execPath, [join(tools_dir, "run.mjs"), "betterbird", "--binary", "betterbird=/bin/true"], { env: { ...process.env, E2E_DIR: e2e_dir, E2E_KINDS: "compose_editor", E2E_TIMINGS_FILE: join(root, "timings.json") }, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /refusing to start an app/);
  assert.deepEqual(readdirSync(outside), [], "nothing was written through the link");
}));
