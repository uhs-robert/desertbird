import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { close_action, open_window, reload_window, type LifecycleDeps } from "../../tools/owner_test/lifecycle.ts";
import { window_paths, type WindowPaths } from "../../tools/owner_test/paths.ts";
import { Refusal } from "../../tools/owner_test/refusal.ts";
import { read_state, write_state } from "../../tools/owner_test/state.ts";

type World = { base: string; paths: WindowPaths; deps: LifecycleDeps; events: string[]; processes: Map<number, { ticks: number; profile: string; binary: string }>; said: string[]; build_fails: boolean; start_ok: boolean; survive_kill: boolean; not_a_checkout: boolean; done: () => void };

// A fake machine: apps are entries of `processes`, found by their profile folder like the real lookup does.
function world(): World {
  const base = mkdtempSync(join(tmpdir(), "owner-test-life-"));
  const paths = window_paths("/w/tree", { cache_home: join(base, "cache"), state_home: join(base, "state") });
  let next_pid = 1000;
  const w = { base, paths, events: [] as string[], processes: new Map<number, { ticks: number; profile: string; binary: string }>(), said: [] as string[], build_fails: false, start_ok: true, survive_kill: false, not_a_checkout: false, done: () => rmSync(base, { recursive: true, force: true }), deps: undefined as unknown as LifecycleDeps };
  let stamp = "";
  let builds = 0;
  w.deps = {
    close: {
      read_start_ticks: (pid) => w.processes.get(pid)?.ticks ?? null,
      signal: (pid, signal) => { w.events.push(`${signal} ${pid}`); if (!w.survive_kill) w.processes.delete(pid); },
      group_members: () => [],
      names_profile: (pid, profile) => w.processes.get(pid)?.profile === profile,
      sleep: async () => {},
      find_app_by_profile: (profile) => { const hit = [...w.processes].find(([, p]) => p.profile === profile); return hit ? { pid: hit[0], start_ticks: hit[1].ticks } : null; },
      stop_unit: () => true,
      remove_window_dir: (dir) => { w.events.push("remove_window_dir"); rmSync(dir, { recursive: true, force: true }); },
      remove_stage_dir: (dir) => rmSync(dir, { recursive: true, force: true }),
      grace_ms: 200,
      kill_wait_ms: 200,
    },
    build_stamped_xpi: (_worktree, p) => {
      w.events.push("build");
      if (w.build_fails) throw new Refusal("the build failed");
      mkdirSync(p.stage_dir, { recursive: true });
      writeFileSync(p.staged_xpi, "xpi");
      stamp = `stamp-${++builds}`;
      return stamp;
    },
    remove_stage: (p) => rmSync(p.stage_dir, { recursive: true, force: true }),
    build_profile: async (p) => { w.events.push("build_profile"); assert.equal(existsSync(p.staged_xpi), true, "the staged build survives the close of the old window"); mkdirSync(p.profile_dir, { recursive: true }); return "id@x"; },
    install_staged_xpi: async (p) => { w.events.push("install"); assert.equal(existsSync(p.staged_xpi), true); return "id@x"; },
    start_app: (argv) => { const pid = next_pid++; w.events.push(`start ${argv.join(" ")}`); w.processes.set(pid, { ticks: pid * 10, profile: argv[2] as string, binary: argv[0] as string }); return { unit: null, pid }; },
    launch_argv: (binary, profile) => [binary, "-profile", profile, "-no-remote"],
    launch_env: () => ({}),
    wait_for_start: async () => w.start_ok,
    installed_stamp: () => stamp,
    binary_exists: () => true,
    default_binary: (app) => (app === "thunderbird" ? "/opt/tb/thunderbird" : "/usr/bin/betterbird"),
    check_worktree: () => { w.events.push("check_worktree"); if (w.not_a_checkout) throw new Refusal("not a DesertBird checkout"); },
    log_tail: () => "(log)",
    check_display: () => {},
    env: {},
    homes: ["/nonexistent-home"],
    say: (line) => w.said.push(line),
  };
  return w;
}

const request = (w: World) => ({ worktree: w.paths.worktree, paths: w.paths });
const running = (w: World) => [...w.processes.values()];

test("reload keeps the app and binary the window was opened with", async () => {
  const w = world();
  try {
    await open_window(request(w), "thunderbird", "/opt/tb/thunderbird", w.deps);
    w.events.length = 0;
    await reload_window(request(w), undefined, undefined, w.deps);
    const starts = w.events.filter((event) => event.startsWith("start"));
    assert.deepEqual(starts, [`start /opt/tb/thunderbird -profile ${w.paths.profile_dir} -no-remote`]);
    assert.deepEqual(running(w).map((p) => p.binary), ["/opt/tb/thunderbird"], "one app runs, the old one is stopped");
    assert.equal(read_state(w.paths.state_file).kind, "ok");
  } finally { w.done(); }
});

test("reload with an explicit --app that differs from the window's app is refused before anything changes", async () => {
  const w = world();
  try {
    await open_window(request(w), "thunderbird", "/opt/tb/thunderbird", w.deps);
    w.events.length = 0;
    await assert.rejects(reload_window(request(w), "betterbird", undefined, w.deps), /opened with thunderbird/);
    assert.deepEqual(w.events.filter((event) => event !== "check_worktree"), [], "no build, no signal, no start");
    assert.equal(running(w).length, 1);
  } finally { w.done(); }
});

test("open builds first: a failed build leaves the old window running with its state", async () => {
  const w = world();
  try {
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    const before = [...w.processes.keys()];
    w.build_fails = true;
    w.events.length = 0;
    await assert.rejects(open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps), /build failed/);
    assert.deepEqual([...w.processes.keys()], before);
    assert.deepEqual(w.events, ["check_worktree", "build"]);
    assert.equal(read_state(w.paths.state_file).kind, "ok");
    assert.equal(existsSync(w.paths.profile_dir), true);
    assert.equal(existsSync(w.paths.stage_dir), false, "the stage folder is removed");
  } finally { w.done(); }
});

test("open replaces the old window only after the build, and stops the old app", async () => {
  const w = world();
  try {
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    w.events.length = 0;
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    assert.ok(w.events.indexOf("build") < w.events.findIndex((event) => event.startsWith("SIGTERM")));
    assert.equal(running(w).length, 1);
  } finally { w.done(); }
});

test("a launch that never loads the add-on is cleaned up: app stopped, folder, state and stage gone", async () => {
  const w = world();
  try {
    w.start_ok = false;
    await assert.rejects(open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps), /did not start with the add-on loaded/);
    assert.equal(running(w).length, 0);
    assert.equal(existsSync(w.paths.window_dir), false);
    assert.equal(existsSync(w.paths.state_file), false);
    assert.equal(existsSync(w.paths.stage_dir), false);
  } finally { w.done(); }
});

test("a profile build that throws is cleaned up too", async () => {
  const w = world();
  try {
    w.deps.build_profile = async () => { throw new Error("disk full"); };
    await assert.rejects(open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps), /disk full/);
    assert.equal(existsSync(w.paths.window_dir), false);
    assert.equal(existsSync(w.paths.state_file), false);
  } finally { w.done(); }
});

test("with no state file, open stops an orphaned app before the profile is built over it", async () => {
  const w = world();
  try {
    w.processes.set(77, { ticks: 770, profile: w.paths.profile_dir, binary: "/usr/bin/betterbird" });
    mkdirSync(w.paths.profile_dir, { recursive: true });
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    assert.ok(w.events.indexOf("SIGTERM 77") >= 0 && w.events.indexOf("SIGTERM 77") < w.events.indexOf("build_profile"));
    assert.equal(w.processes.has(77), false);
  } finally { w.done(); }
});

test("an old app that cannot be stopped stops open before anything is written", async () => {
  const w = world();
  try {
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    w.survive_kill = true;
    w.events.length = 0;
    await assert.rejects(open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps), /not closed/);
    assert.equal(w.events.includes("build_profile"), false);
    assert.equal(existsSync(w.paths.profile_dir), true, "the profile under the running app is kept");
  } finally { w.done(); }
});

test("open and reload refuse a symlinked window folder before building or writing", async () => {
  const w = world();
  try {
    mkdirSync(w.paths.cache_root, { recursive: true });
    mkdirSync(join(w.base, "elsewhere"));
    symlinkSync(join(w.base, "elsewhere"), w.paths.window_dir);
    await assert.rejects(open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps), /symlink/);
    await assert.rejects(reload_window(request(w), undefined, undefined, w.deps), /symlink/);
    assert.equal(await close_action(request(w), w.deps).catch(() => "refused"), "refused");
    assert.deepEqual(w.events, [], "nothing was built, signalled or deleted");
    assert.equal(existsSync(join(w.base, "elsewhere", "profile")), false);
  } finally { w.done(); }
});

test("open refuses a cache root that is a symlink into a real profile folder", async () => {
  const w = world();
  try {
    mkdirSync(join(w.base, "home", ".thunderbird"), { recursive: true });
    symlinkSync(join(w.base, "home", ".thunderbird"), join(w.base, "cache2"));
    const paths = window_paths("/w/tree", { cache_home: join(w.base, "cache2"), state_home: join(w.base, "state") });
    await assert.rejects(open_window({ worktree: "/w/tree", paths }, "betterbird", "/usr/bin/betterbird", { ...w.deps, homes: [join(w.base, "home")] }), /real profile folder/);
    assert.deepEqual(w.events, []);
    assert.equal(existsSync(join(w.base, "home", ".thunderbird", "desertbird")), false);
  } finally { w.done(); }
});

test("a failed reload start names the close command", async () => {
  const w = world();
  try {
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    w.start_ok = false;
    await assert.rejects(reload_window(request(w), undefined, undefined, w.deps), /owner-test-close/);
  } finally { w.done(); }
});

test("a window opened with a non-default binary is reloaded only when --binary names the same binary", async () => {
  const w = world();
  try {
    await open_window(request(w), "betterbird", "/home/x/stand_in", w.deps);
    w.events.length = 0;
    await assert.rejects(reload_window(request(w), undefined, undefined, w.deps), /Pass it again: --binary \/home\/x\/stand_in/);
    await assert.rejects(reload_window(request(w), undefined, "/usr/bin/other", w.deps), /cannot be reloaded with/);
    assert.deepEqual(w.events.filter((event) => event !== "check_worktree"), [], "no build, no signal, no start");
    await reload_window(request(w), undefined, "/home/x/stand_in", w.deps);
    assert.equal(w.events.filter((event) => event.startsWith("start")).length, 1);
  } finally { w.done(); }
});

test("a state file naming a program other than the app's default is not run on reload", async () => {
  const w = world();
  try {
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    const state = read_state(w.paths.state_file);
    assert.equal(state.kind, "ok");
    if (state.kind !== "ok") return;
    write_state(w.paths.state_file, { ...state.state, binary: "/bin/evil" });
    w.events.length = 0;
    await assert.rejects(reload_window(request(w), undefined, undefined, w.deps), /not the default/);
    assert.equal(w.events.some((event) => event.startsWith("start")), false);
  } finally { w.done(); }
});

test("a folder that is not a checkout stops open and reload before any build", async () => {
  const w = world();
  try {
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    w.not_a_checkout = true;
    w.events.length = 0;
    await assert.rejects(open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps), /not a DesertBird checkout/);
    await assert.rejects(reload_window(request(w), undefined, undefined, w.deps), /not a DesertBird checkout/);
    assert.equal(w.events.includes("build"), false);
  } finally { w.done(); }
});

test("close removes a stage folder left by a crashed build, with or without a window", async () => {
  const w = world();
  try {
    mkdirSync(w.paths.stage_dir, { recursive: true });
    await close_action(request(w), w.deps);
    assert.equal(existsSync(w.paths.stage_dir), false, "no window");
    await open_window(request(w), "betterbird", "/usr/bin/betterbird", w.deps);
    mkdirSync(w.paths.stage_dir, { recursive: true });
    await close_action(request(w), w.deps);
    assert.equal(existsSync(w.paths.stage_dir), false, "with a window");
  } finally { w.done(); }
});

test("close leaves a stage folder that is a symlink alone", async () => {
  const w = world();
  try {
    mkdirSync(w.paths.cache_root, { recursive: true });
    mkdirSync(join(w.base, "elsewhere"));
    writeFileSync(join(w.base, "elsewhere", "keep"), "x");
    symlinkSync(join(w.base, "elsewhere"), w.paths.stage_dir);
    await assert.rejects(close_action(request(w), w.deps), /symlink/);
    assert.equal(existsSync(join(w.base, "elsewhere", "keep")), true);
  } finally { w.done(); }
});
