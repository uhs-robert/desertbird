import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { find_app_by_profile } from "../../tools/owner_test/launch.ts";
import { canonical_worktree, window_paths } from "../../tools/owner_test/paths.ts";

const CLI = join(import.meta.dirname, "..", "..", "tools", "owner_test", "cli.ts");

type Run = { status: number; out: string };

// The cli as a real subprocess, in a temp world: its own HOME, cache and state folders, a git worktree whose build script writes a tiny xpi, and stand-in apps (shell scripts). No display and no real app are used.
function setup() {
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
  const env = { PATH: process.env.PATH ?? "", HOME: join(base, "home"), XDG_CACHE_HOME: join(base, "cache"), XDG_STATE_HOME: join(base, "state"), WAYLAND_DISPLAY: "none" };
  mkdirSync(env.HOME, { recursive: true });
  const real_worktree = canonical_worktree(worktree);
  const paths = window_paths(real_worktree, { cache_home: env.XDG_CACHE_HOME, state_home: env.XDG_STATE_HOME });
  const run = (args: string[], extra: Record<string, string> = {}): Promise<Run> =>
    new Promise((done) => execFile("node", ["--no-warnings", CLI, ...args], { env: { ...env, ...extra }, cwd: worktree, timeout: 90_000 }, (error, stdout, stderr) => done({ status: error === null ? 0 : (error as { code?: number }).code ?? 1, out: stdout + stderr })));
  const cleanup = async () => {
    await run(["close", worktree]);
    rmSync(base, { recursive: true, force: true });
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
    const reloaded = await t.run(["reload", t.worktree]);
    assert.equal(reloaded.status, 0, reloaded.out);
    const log = readFileSync(t.paths.log_file, "utf8");
    assert.equal(log.match(/app tb/g)?.length, 2, "the same app started again");
    assert.doesNotMatch(log, /app bb/);
    const second = t.apps_running();
    assert.ok(second !== null && second.pid !== first.pid, "a new process runs and the old one is gone");
    assert.equal(existsSync(`/proc/${first.pid}`), false);
    const refused = await t.run(["reload", t.worktree, "--app", "betterbird"]);
    assert.equal(refused.status, 1);
    assert.match(refused.out, /opened with thunderbird/);
    assert.ok(t.apps_running() !== null, "a refused reload leaves the window running");
    void bb;
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
