import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { find_app_by_profile, group_members } from "../../tools/owner_test/launch.ts";
import { read_start_ticks } from "../../tools/owner_test/process_guard.ts";
import { canonical_worktree, unit_name, window_paths } from "../../tools/owner_test/paths.ts";

const CLI = join(import.meta.dirname, "..", "..", "tools", "owner_test", "cli.ts");

type Run = { status: number; out: string };

// Safety net: a test that fails or times out must not leave a stand-in app or a temp folder. Every setup registers here, and the process exit or a kill signal sweeps whatever is left.
const live = new Set<{ base: string; profile_dir: string; unit: string }>();
function sweep(): void {
  for (const item of live) {
    for (let found = find_app_by_profile(item.profile_dir); found !== null; found = find_app_by_profile(item.profile_dir)) {
      for (const member of group_members(found.pid)) try { process.kill(member.pid, "SIGKILL"); } catch { /* gone */ }
      try { process.kill(found.pid, "SIGKILL"); } catch { /* gone */ }
    }
    // The unit name comes from the key, so this reaches only this fixture's unit. A killed run leaves the unit, and its escaped children are in the unit's cgroup, not in the group the lookup above covers.
    spawnSync("systemctl", ["--user", "stop", item.unit], { stdio: "ignore", timeout: 30_000 });
    spawnSync("systemctl", ["--user", "reset-failed", item.unit], { stdio: "ignore", timeout: 10_000 });
    rmSync(item.base, { recursive: true, force: true });
  }
  live.clear();
}
process.on("exit", sweep);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { sweep(); process.exit(1); });

// The cli as a real subprocess, in a temp world: its own HOME, cache and state folders, a git worktree whose build script writes a tiny xpi, and stand-in apps (shell scripts). No display and no real app are used.
function setup(cache_name = "cache") {
  const base = mkdtempSync(join(tmpdir(), "owner-test-cli-"));
  const worktree = join(base, "tree");
  mkdirSync(join(worktree, "src"), { recursive: true });
  writeFileSync(join(worktree, "src", "manifest.json"), "{}");
  writeFileSync(join(worktree, "package.json"), JSON.stringify({ scripts: { build: "node build.mjs" } }));
  writeFileSync(join(worktree, "build.mjs"), `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const trace = process.env.BUILD_TRACE;
if (trace) appendFileSync(trace, "start\\n");
if (process.env.BUILD_FAIL) process.exit(1);
if (trace) execFileSync("sleep", ["1"]);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/manifest.json", JSON.stringify({ manifest_version: 2, name: "x", version: "0.0.0", browser_specific_settings: { gecko: { id: "desertbird@test" } } }));
execFileSync("zip", ["-q", "-X", "desertbird.xpi", "manifest.json"], { cwd: "dist" });
if (trace) appendFileSync(trace, "end\\n");
`);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: worktree, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "x");
  const app = (name: string, body = "") => {
    const file = join(base, name);
    writeFileSync(file, `#!/bin/sh
profile=""
while [ $# -gt 0 ]; do [ "$1" = -profile ] && profile=$2; shift; done
echo "app ${name}"
${body}
printf '{"addons":[{"id":"desertbird@test","active":true,"updateDate":%s}]}' "$(( $(date +%s%3N) + 1000 ))" > "$profile/extensions.json"
sleep 300 &
trap 'kill $!; exit 0' TERM
wait
`);
    chmodSync(file, 0o755);
    return file;
  };
  const env = { PATH: process.env.PATH ?? "", HOME: join(base, "home"), XDG_CACHE_HOME: join(base, cache_name), XDG_STATE_HOME: join(base, "state"), WAYLAND_DISPLAY: "none", OWNER_TEST_DETACHED: "1" };
  mkdirSync(env.HOME, { recursive: true });
  const real_worktree = canonical_worktree(worktree);
  const paths = window_paths(real_worktree, { cache_home: env.XDG_CACHE_HOME, state_home: env.XDG_STATE_HOME });
  const run = (args: string[], extra: Record<string, string> = {}): Promise<Run> =>
    new Promise((done) => execFile("node", ["--no-warnings", CLI, ...args], { env: { ...env, ...extra }, cwd: worktree, timeout: 90_000, killSignal: "SIGKILL" }, (error, stdout, stderr) => done({ status: error === null ? 0 : (error as { code?: number }).code ?? 1, out: stdout + stderr })));
  const item = { base, profile_dir: paths.profile_dir, unit: unit_name(paths.key) };
  live.add(item);
  const cleanup = async () => {
    await run(["close", worktree]);
    sweep();
  };
  return { base, worktree, env, paths, app, run, cleanup, apps_running: () => find_app_by_profile(paths.profile_dir) };
}

test("open, reload and close with a stand-in app: reload keeps the app of the window, close leaves nothing", async () => {
  const t = setup();
  try {
    const tb = t.app("tb");
    const bb = t.app("bb");
    const opened = await t.run(["open", t.worktree, "--app", "thunderbird", "--binary", tb]);
    assert.equal(opened.status, 0, opened.out);
    assert.match(opened.out, /test window open/);
    assert.match(readFileSync(t.paths.log_file, "utf8"), /app tb/);
    const first = t.apps_running();
    assert.ok(first !== null);
    const bare = await t.run(["reload", t.worktree]);
    assert.equal(bare.status, 1, "a non-default binary must be named again");
    assert.match(bare.out, /--binary/);
    const mismatch = await t.run(["reload", t.worktree, "--binary", bb]);
    assert.equal(mismatch.status, 1);
    const reloaded = await t.run(["reload", t.worktree, "--binary", tb]);
    assert.equal(reloaded.status, 0, reloaded.out);
    const log = readFileSync(t.paths.log_file, "utf8");
    assert.equal(log.match(/app tb/g)?.length, 2, "the same app started again");
    assert.doesNotMatch(log, /app bb/);
    const second = t.apps_running();
    assert.ok(second !== null && second.pid !== first.pid, "a new process runs and the old one is gone");
    assert.equal(existsSync(`/proc/${first.pid}`), false);
    const refused = await t.run(["reload", t.worktree, "--app", "betterbird", "--binary", tb]);
    assert.equal(refused.status, 1);
    assert.match(refused.out, /opened with thunderbird/);
    assert.ok(t.apps_running() !== null, "a refused reload leaves the window running");
    const closed = await t.run(["close", t.worktree]);
    assert.equal(closed.status, 0, closed.out);
    assert.equal(t.apps_running(), null);
    assert.equal(existsSync(t.paths.window_dir), false);
    assert.equal(existsSync(t.paths.state_file), false);
    assert.equal(existsSync(t.paths.stage_dir), false);
  } finally { await t.cleanup(); }
});

test("a launch whose app dies at once fails and leaves no folder, state or process", async () => {
  const t = setup();
  try {
    const dead = join(t.base, "dead");
    writeFileSync(dead, "#!/bin/sh\necho dying\nexit 3\n");
    chmodSync(dead, 0o755);
    const opened = await t.run(["open", t.worktree, "--binary", dead]);
    assert.equal(opened.status, 1);
    assert.match(opened.out, /did not start/);
    assert.equal(existsSync(t.paths.window_dir), false);
    assert.equal(existsSync(t.paths.state_file), false);
    assert.equal(existsSync(t.paths.stage_dir), false);
  } finally { await t.cleanup(); }
});

test("a failed build leaves the open window running", async () => {
  const t = setup();
  try {
    const bb = t.app("bb");
    assert.equal((await t.run(["open", t.worktree, "--binary", bb])).status, 0);
    const before = t.apps_running();
    const failed = await t.run(["open", t.worktree, "--binary", bb], { BUILD_FAIL: "1" });
    assert.equal(failed.status, 1);
    assert.deepEqual(t.apps_running(), before);
  } finally { await t.cleanup(); }
});

test("open refuses a cache root that is a symlink into the real profile folder, and writes nothing there", async () => {
  const t = setup();
  try {
    const real_profiles = join(t.env.HOME, ".thunderbird");
    mkdirSync(join(real_profiles, "z.default"), { recursive: true });
    symlinkSync(real_profiles, t.env.XDG_CACHE_HOME);
    const opened = await t.run(["open", t.worktree, "--binary", t.app("bb")]);
    assert.equal(opened.status, 1);
    assert.match(opened.out, /real profile folder/);
    assert.deepEqual(readdirSync(real_profiles), ["z.default"]);
  } finally { await t.cleanup(); }
});

test("the real home is guarded when HOME is mocked: a cache root in it is refused", async () => {
  const t = setup();
  try {
    const real_home = execFileSync("sh", ["-c", "getent passwd $(id -u) | cut -d: -f6"], { encoding: "utf8" }).trim();
    const closed = await t.run(["close", t.worktree], { XDG_CACHE_HOME: join(real_home, ".thunderbird") });
    assert.equal(closed.status, 1);
    assert.match(closed.out, /real profile folder/);
    assert.equal(existsSync(join(real_home, ".thunderbird", "desertbird")), false, "nothing was created in the real profile folder");
  } finally { await t.cleanup(); }
});

test("an empty XDG_CACHE_HOME or a relative one is refused", async () => {
  const t = setup();
  try {
    for (const value of ["", "relative/cache"]) {
      const opened = await t.run(["open", t.worktree, "--binary", t.app("bb")], { XDG_CACHE_HOME: value });
      assert.equal(opened.status, 1, value);
      assert.match(opened.out, /not an absolute path/);
    }
    assert.equal(existsSync(join(t.worktree, "relative")), false);
  } finally { await t.cleanup(); }
});

test("two concurrent opens on one worktree run one after the other under the lock, and one app remains", async () => {
  const t = setup();
  try {
    const bb = t.app("bb");
    const trace = join(t.base, "trace.txt");
    const both = await Promise.all([t.run(["open", t.worktree, "--binary", bb], { BUILD_TRACE: trace }), t.run(["open", t.worktree, "--binary", bb], { BUILD_TRACE: trace })]);
    assert.deepEqual(both.map((run) => run.status), [0, 0], both.map((run) => run.out).join("\n"));
    assert.deepEqual(readFileSync(trace, "utf8").trim().split("\n"), ["start", "end", "start", "end"], "the builds did not overlap");
    const all = readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).filter((entry) => { try { return readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0").includes(t.paths.profile_dir); } catch { return false; } });
    assert.ok(all.length >= 1);
    assert.ok(t.apps_running() !== null);
    const mains = all.filter((entry) => !readFileSync(`/proc/${entry}/cmdline`, "utf8").includes("flock"));
    assert.equal(mains.length, 1, "exactly one app runs");
  } finally { await t.cleanup(); }
});

test("a close during an open waits for it and then closes the window the open made", async () => {
  const t = setup();
  try {
    const bb = t.app("bb");
    const trace = join(t.base, "trace.txt");
    const opening = t.run(["open", t.worktree, "--binary", bb], { BUILD_TRACE: trace });
    while (!existsSync(trace)) await new Promise((done) => setTimeout(done, 50));
    const closing = await t.run(["close", t.worktree]);
    const opened = await opening;
    assert.equal(opened.status, 0, opened.out);
    assert.equal(closing.status, 0, closing.out);
    assert.equal(t.apps_running(), null);
    assert.equal(existsSync(t.paths.window_dir), false);
  } finally { await t.cleanup(); }
});

test("XDG_STATE_HOME inside a real profile folder, or relative, is refused before the lock creates any file", async () => {
  const t = setup();
  try {
    const real_profiles = join(t.env.HOME, ".thunderbird");
    mkdirSync(join(real_profiles, "z.default"), { recursive: true });
    const before_cwd = readdirSync(t.worktree).sort();
    for (const [value, pattern] of [[join(real_profiles, "state"), /real profile folder/], ["relative/state", /not an absolute path/], ["", /not an absolute path/]] as const) {
      for (const action of ["open", "reload", "close"]) {
        const result = await t.run([action, t.worktree, "--binary", t.app("bb")], { XDG_STATE_HOME: value });
        assert.equal(result.status, 1, `${action} ${value}`);
        assert.match(result.out, pattern);
      }
    }
    assert.deepEqual(readdirSync(real_profiles), ["z.default"], "nothing was created in the real profile folder");
    assert.deepEqual(readdirSync(t.worktree).sort(), before_cwd, "nothing was created in the working folder");
  } finally { await t.cleanup(); }
});

test("a folder that is not a DesertBird checkout is refused and no build runs in it", async () => {
  const t = setup();
  try {
    const other = join(t.base, "other");
    mkdirSync(other);
    writeFileSync(join(other, "package.json"), JSON.stringify({ scripts: { build: "touch built" } }));
    const result = await t.run(["open", other, "--binary", t.app("bb")]);
    assert.equal(result.status, 1);
    assert.match(result.out, /not a DesertBird checkout/);
    assert.equal(existsSync(join(other, "built")), false);
  } finally { await t.cleanup(); }
});

const has_user_systemd = spawnSync("systemd-run", ["--user", "--scope", "--quiet", "true"], { stdio: "ignore" }).status === 0;

// The real unit path with a stand-in app: no display, but the real user manager. The unit and every process in it must be gone at the end.
test("under systemd: the app runs in a unit, a failed leftover unit does not block open, close takes the escaped child down with the unit", { skip: !has_user_systemd }, async () => {
  // A literal dollar sign in the cache path: systemd would expand it in the command line if it were not escaped.
  const t = setup("cache-$HOME-50%");
  const unit = unit_name(t.paths.key);
  const user_env = { ...t.env, OWNER_TEST_DETACHED: "", XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "", DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? "" };
  const is_active = () => spawnSync("systemctl", ["--user", "is-active", unit], { encoding: "utf8" }).stdout.trim();
  try {
    spawnSync("systemd-run", ["--user", "--quiet", `--unit=${unit}`, "/bin/false"], { stdio: "ignore" });
    // The stand-in records its environment and the pid of the child it moves into a new session.
    const bb = t.app("bb", 'env > "$profile/../env.txt"\nsetsid sleep 301 </dev/null >/dev/null 2>&1 &\necho $! > "$profile/../escaped.pid"');
    const opened = await t.run(["open", t.worktree, "--binary", bb], user_env);
    assert.equal(opened.status, 0, opened.out);
    assert.equal(is_active(), "active");
    assert.equal(JSON.parse(readFileSync(t.paths.state_file, "utf8")).unit, unit);
    const status = await t.run(["status", t.worktree], user_env);
    assert.equal(status.status, 0, status.out);
    assert.match(status.out, /unit: .*\(active\)/);
    const environment = readFileSync(join(t.paths.window_dir, "env.txt"), "utf8").split("\n");
    assert.deepEqual(environment.filter((line) => /^(DISPLAY|DBUS_|HYPRLAND|XDG_CURRENT_DESKTOP|XDG_CONFIG_HOME|GTK_THEME)/.test(line)), [], "nothing of the user manager's environment reaches the app");
    assert.ok(environment.includes(`HOME=${t.paths.home_dir}`) && environment.includes("WAYLAND_DISPLAY=none"));
    const escaped_pid = Number(readFileSync(join(t.paths.window_dir, "escaped.pid"), "utf8").trim());
    const escaped_ticks = read_start_ticks(escaped_pid);
    assert.ok(escaped_ticks !== null, "the escaped child runs");
    const closed = await t.run(["close", t.worktree], user_env);
    assert.equal(closed.status, 0, closed.out);
    assert.notEqual(is_active(), "active");
    assert.notEqual(read_start_ticks(escaped_pid), escaped_ticks, "the unit's cgroup took the escaped child down (this child only, by pid and start ticks)");
    assert.equal(t.apps_running(), null);
    assert.equal(existsSync(t.paths.window_dir), false);
  } finally {
    spawnSync("systemctl", ["--user", "stop", unit], { stdio: "ignore" });
    spawnSync("systemctl", ["--user", "reset-failed", unit], { stdio: "ignore" });
    await t.cleanup();
  }
});
