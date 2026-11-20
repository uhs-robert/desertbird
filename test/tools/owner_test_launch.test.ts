import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { close_window } from "../../tools/owner_test/close.ts";
import { addon_loaded_since, app_binary, is_confirmed_stopped, stop_unit, systemd_run_args, unit_state, find_app_by_profile, launch_argv, launch_env, real_close_deps, stamp_label, stamp_manifest, start_app } from "../../tools/owner_test/launch.ts";
import { flock_argv, LOCK_BUSY_EXIT } from "../../tools/owner_test/lock.ts";
import { window_paths } from "../../tools/owner_test/paths.ts";
import { is_same_process, read_start_ticks } from "../../tools/owner_test/process_guard.ts";
import { write_state } from "../../tools/owner_test/state.ts";

test("the app always gets an explicit profile and -no-remote", () => {
  assert.deepEqual(launch_argv("/usr/bin/betterbird", "/c/p"), ["/usr/bin/betterbird", "-profile", "/c/p", "-no-remote"]);
});

test("binaries: Betterbird from the system, Thunderbird from the measure folder, an override wins", () => {
  assert.equal(app_binary("betterbird", {}, undefined), "/usr/bin/betterbird");
  assert.equal(app_binary("thunderbird", {}, undefined), "/tmp/desertbird-measure/thunderbird-153.7.0esr/thunderbird/thunderbird");
  assert.equal(app_binary("thunderbird", { MEASURE_DIR: "/m" }, undefined), "/m/thunderbird-153.7.0esr/thunderbird/thunderbird");
  assert.equal(app_binary("betterbird", {}, "/x/bb"), "/x/bb");
});

test("the app environment keeps display variables and gets the window's own HOME", () => {
  const env = launch_env({ HOME: "/home/me", WAYLAND_DISPLAY: "wayland-1", XDG_RUNTIME_DIR: "/run/user/1", PATH: "/bin", XDG_CONFIG_HOME: "/home/me/.config", XDG_DATA_HOME: "/d", SECRET: "x" }, "/c/home");
  assert.deepEqual(env, { HOME: "/c/home", WAYLAND_DISPLAY: "wayland-1", XDG_RUNTIME_DIR: "/run/user/1", PATH: "/bin" });
});

test("the stamp names branch, commit, dirty mark and time, and goes in version_name only", () => {
  assert.equal(stamp_label("feat/x", "abc1234", true, "T"), "feat/x@abc1234+dirty T");
  assert.equal(stamp_label("main", "abc1234", false, "T"), "main@abc1234 T");
  assert.deepEqual(stamp_manifest({ name: "n", version: "0.0.0" }, "L"), { name: "n", version: "0.0.0", version_name: "L" });
});

test("the loaded add-on check needs the id, active, and an install date from this launch", () => {
  const record = (id: string, active: boolean, updateDate: number) => JSON.stringify({ addons: [{ id, active, updateDate }] });
  assert.equal(addon_loaded_since(record("a@b", true, 2000), "a@b", 1000), true);
  assert.equal(addon_loaded_since(record("a@b", true, 500), "a@b", 1000), false, "a file from before the launch");
  assert.equal(addon_loaded_since(record("a@b", false, 2000), "a@b", 1000), false);
  assert.equal(addon_loaded_since(record("other", true, 2000), "a@b", 1000), false);
  assert.equal(addon_loaded_since("{ cut", "a@b", 1000), false);
});

test("find_app_by_profile matches the exact profile and skips child processes", () => {
  const proc = mkdtempSync(join(tmpdir(), "owner-test-proc-"));
  try {
    const stat = (ticks: number) => `1 (x) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${ticks} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`;
    const add = (pid: number, words: string[], ticks: number) => {
      mkdirSync(join(proc, String(pid)));
      writeFileSync(join(proc, String(pid), "cmdline"), words.join("\0") + "\0");
      writeFileSync(join(proc, String(pid), "stat"), stat(ticks));
    };
    add(10, ["bb", "-profile", "/c/other", "-no-remote"], 1);
    add(11, ["bb", "-contentproc", "-profile", "/c/p"], 2);
    add(12, ["bb", "-profile", "/c/p-longer", "-no-remote"], 3);
    assert.equal(find_app_by_profile("/c/p", proc), null);
    add(13, ["bb", "-profile", "/c/p", "-no-remote"], 4);
    assert.deepEqual(find_app_by_profile("/c/p", proc), { pid: 13, start_ticks: 4 });
  } finally {
    rmSync(proc, { recursive: true, force: true });
  }
});

test("the lock refuses a second caller with the busy exit code", () => {
  const base = mkdtempSync(join(tmpdir(), "owner-test-lock-"));
  try {
    const lock_file = join(base, "k.lock");
    const holder = spawnSync("flock", flock_argv(lock_file, ["sh", "-c", `flock -w 1 -E ${LOCK_BUSY_EXIT} -o "${lock_file}" true; echo $?`], 5), { encoding: "utf8" });
    assert.equal(holder.stdout.trim(), String(LOCK_BUSY_EXIT));
    const free = spawnSync("flock", flock_argv(lock_file, ["true"], 1));
    assert.equal(free.status, 0, "the kernel released the lock when the holder exited");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// A real process, no display: a stand-in app that ignores SIGTERM until told otherwise.
// The detached path: OWNER_TEST_DETACHED keeps this test off the user manager.
test("real lifecycle with a stand-in app: start, close while it runs, nothing left running or on disk", async () => {
  const base = mkdtempSync(join(tmpdir(), "owner-test-real-"));
  let pid = 0;
  process.env.OWNER_TEST_DETACHED = "1";
  try {
    const paths = window_paths("/w/tree", { cache_home: join(base, "cache"), state_home: join(base, "state") });
    mkdirSync(paths.profile_dir, { recursive: true });
    const script = join(base, "fake_app.sh");
    writeFileSync(script, "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 0.1; done\n");
    chmodSync(script, 0o755);
    const started = start_app(launch_argv(script, paths.profile_dir), launch_env(process.env, paths.home_dir), base, paths.log_file, "desertbird-owner-test-x");
    pid = started.pid;
    const start_ticks = read_start_ticks(pid) ?? 0;
    assert.ok(pid > 1 && start_ticks > 0);
    write_state(paths.state_file, { worktree: paths.worktree, profile: paths.profile_dir, log: paths.log_file, stamp: "s", addon_id: "id@x", app: "betterbird", binary: script, started: "t", unit: null, app_pid: pid, app_start_ticks: start_ticks });
    assert.deepEqual(find_app_by_profile(paths.profile_dir), { pid, start_ticks });
    const result = await close_window(paths, { ...real_close_deps(), grace_ms: 400, kill_wait_ms: 3000 });
    assert.equal(result.closed, true, result.lines.join("\n"));
    assert.equal(is_same_process(pid, start_ticks), false);
    assert.equal(existsSync(paths.window_dir), false);
    assert.equal(existsSync(paths.state_file), false);
    assert.ok(existsSync(base), "nothing outside the window folder was deleted");
  } finally {
    delete process.env.OWNER_TEST_DETACHED;
    if (pid > 1) try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    rmSync(base, { recursive: true, force: true });
  }
});

test("only a unit state that says down confirms a stop", () => {
  for (const word of ["inactive", "failed", "inactive\n"]) assert.equal(is_confirmed_stopped(word), true, word);
  for (const word of ["", "active", "activating", "deactivating", "reloading"]) assert.equal(is_confirmed_stopped(word), false, word);
});

test("a name that is not this tool's unit never reaches systemctl", () => {
  for (const bad of ["*", "sshd", "desertbird-owner-test-*", "desertbird-owner-test-a b"]) {
    assert.equal(stop_unit(bad), false, bad);
    assert.equal(unit_state(bad), null, bad);
  }
});

test("the unit runs the app through env -i, so the manager's environment never reaches it", () => {
  const args = systemd_run_args("desertbird-owner-test-k", ["/bin/app", "-profile", "/p", "-no-remote"], { HOME: "/h", WAYLAND_DISPLAY: "w" }, "/cwd", "/log");
  assert.ok(args.includes("--unit=desertbird-owner-test-k") && args.includes("--collect"));
  assert.equal(args.some((word) => word.startsWith("--setenv")), false, "--setenv only adds to the manager's environment");
  assert.deepEqual(args.slice(args.indexOf("--") + 1), ["/usr/bin/env", "-i", "HOME=/h", "WAYLAND_DISPLAY=w", "/bin/app", "-profile", "/p", "-no-remote"]);
});

test("the filtered environment is exactly what the app gets: no DISPLAY or DBUS variable unless the filter passes it", () => {
  const manager_like = { HOME: "/h", PATH: "/bin", DISPLAY: ":0", DBUS_SESSION_BUS_ADDRESS: "unix:path=/x", WAYLAND_DISPLAY: "w", XDG_CONFIG_HOME: "/real" };
  const command = systemd_run_args("desertbird-owner-test-k", ["/bin/app"], launch_env(manager_like, "/c/home"), "/cwd", "/log");
  const words = command.slice(command.indexOf("/usr/bin/env"));
  assert.ok(words.includes("DISPLAY=:0"), "DISPLAY passes only because the filter lets it through");
  assert.equal(words.some((word) => word.startsWith("DBUS_") || word.startsWith("XDG_CONFIG_HOME")), false);
  const without = systemd_run_args("desertbird-owner-test-k", ["/bin/app"], launch_env({ PATH: "/bin", WAYLAND_DISPLAY: "w" }, "/c/home"), "/cwd", "/log");
  assert.equal(without.some((word) => word.startsWith("DISPLAY=")), false);
});

test("a literal dollar sign in a word reaches the app as it is, since systemd-run expands it; a percent sign needs no escape", () => {
  const args = systemd_run_args("desertbird-owner-test-k", ["/bin/app", "-profile", "/tmp/cache-${LANG}/50%/p"], { HOME: "/h$X" }, "/cwd", "/log");
  const words = args.slice(args.indexOf("--") + 1);
  assert.ok(words.includes("/tmp/cache-$${LANG}/50%/p") && words.includes("HOME=/h$$X"));
});

// Stubs for systemd-run and systemctl in a PATH of their own, so the failure paths run with no real unit.
function with_stub_systemd(is_active: string, body: (dir: string) => void, systemctl_failure?: string) {
  const dir = mkdtempSync(join(tmpdir(), "owner-test-stub-"));
  const saved_path = process.env.PATH;
  try {
    writeFileSync(join(dir, "systemd-run"), "#!/bin/sh\nexit 1\n");
    // With a failure text, systemctl prints nothing on stdout and exits 1, as when the bus is unreachable.
    writeFileSync(join(dir, "systemctl"), systemctl_failure === undefined ? `#!/bin/sh\n[ "$2" = is-active ] && echo ${is_active}\nexit 0\n` : `#!/bin/sh\necho "${systemctl_failure}" >&2\nexit 1\n`);
    writeFileSync(join(dir, "app"), `#!/bin/sh\necho started > "${join(dir, "marker")}"\n`);
    for (const name of ["systemd-run", "systemctl", "app"]) chmodSync(join(dir, name), 0o755);
    process.env.PATH = `${dir}:${saved_path}`;
    body(dir);
  } finally {
    process.env.PATH = saved_path;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a failed systemd-run whose unit is still active starts no second app", () => {
  with_stub_systemd("active", (dir) => {
    const started = start_app([join(dir, "app")], { PATH: process.env.PATH }, dir, join(dir, "log"), "desertbird-owner-test-k");
    assert.deepEqual(started, { unit: "desertbird-owner-test-k", pid: 0 });
    assert.equal(existsSync(join(dir, "marker")), false);
  });
});

test("a failed systemd-run whose unit state cannot be read, with a user manager that may exist, starts no second app", () => {
  with_stub_systemd("", (dir) => {
    const started = start_app([join(dir, "app")], { PATH: process.env.PATH }, dir, join(dir, "log"), "desertbird-owner-test-k");
    assert.equal(started.pid, 0);
    assert.equal(existsSync(join(dir, "marker")), false);
  }, "Connection timed out");
});

test("a failed systemd-run with no user manager at all falls back to the detached start", () => {
  const saved = process.env.OWNER_TEST_DETACHED;
  delete process.env.OWNER_TEST_DETACHED;
  try {
    with_stub_systemd("", (dir) => {
      const started = start_app([join(dir, "app")], { PATH: process.env.PATH }, dir, join(dir, "log"), "desertbird-owner-test-k");
      assert.equal(started.unit, null);
      assert.ok(started.pid > 1);
      for (let tries = 0; tries < 50 && !existsSync(join(dir, "marker")); tries++) spawnSync("sleep", ["0.1"]);
      assert.equal(existsSync(join(dir, "marker")), true);
    }, "Failed to connect to bus: No medium found");
  } finally {
    if (saved !== undefined) process.env.OWNER_TEST_DETACHED = saved;
  }
});

test("a failed systemd-run with no unit left falls back to the detached start", () => {
  const saved = process.env.OWNER_TEST_DETACHED;
  delete process.env.OWNER_TEST_DETACHED;
  try {
    with_stub_systemd("inactive", (dir) => {
      const started = start_app([join(dir, "app")], { PATH: process.env.PATH }, dir, join(dir, "log"), "desertbird-owner-test-k");
      assert.equal(started.unit, null);
      assert.ok(started.pid > 1);
      for (let tries = 0; tries < 50 && !existsSync(join(dir, "marker")); tries++) spawnSync("sleep", ["0.1"]);
      assert.equal(existsSync(join(dir, "marker")), true);
    });
  } finally {
    if (saved !== undefined) process.env.OWNER_TEST_DETACHED = saved;
  }
});
