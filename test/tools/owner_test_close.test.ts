import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { close_window, type CloseDeps, type RunningApp } from "../../tools/owner_test/close.ts";
import { window_paths, type WindowPaths } from "../../tools/owner_test/paths.ts";
import { read_state, write_state, type WindowState } from "../../tools/owner_test/state.ts";

type Fake = { more: RunningApp[]; groups: Map<number, RunningApp[]>; foreign: Set<number>; deps: CloseDeps; signals: string[]; removed: string[]; unit_stops: string[]; processes: Map<number, number>; found: RunningApp | null; on_signal: (pid: number, signal: string) => void };

// A fake machine: pid -> start ticks. SIGTERM removes the process unless `ignore_term` holds its pid.
function fake_machine(ignore_term: number[] = [], survive_kill: number[] = []): Fake {
  const fake: Fake = { more: [], groups: new Map(), foreign: new Set(), signals: [], removed: [], unit_stops: [], processes: new Map(), found: null, on_signal: () => {}, deps: undefined as unknown as CloseDeps };
  fake.deps = {
    read_start_ticks: (pid) => fake.processes.get(pid) ?? null,
    signal: (pid, signal) => {
      fake.signals.push(`${signal} ${pid}`);
      fake.on_signal(pid, signal);
      if ((signal === "SIGKILL" && !survive_kill.includes(pid)) || (signal === "SIGTERM" && !ignore_term.includes(pid))) fake.processes.delete(pid);
    },
    group_members: (pid) => fake.groups.get(pid) ?? [],
    names_profile: (pid) => !fake.foreign.has(pid),
    sleep: async () => {},
    find_app_by_profile: () => [fake.found, ...fake.more].find((app): app is RunningApp => app !== null && fake.processes.get(app.pid) === app.start_ticks) ?? null,
    stop_unit: (unit) => (fake.unit_stops.push(unit), true),
    remove_window_dir: (dir) => fake.removed.push(dir),
    grace_ms: 300,
    kill_wait_ms: 300,
  };
  return fake;
}

function setup(): { base: string; paths: WindowPaths; state: WindowState; done: () => void } {
  const base = mkdtempSync(join(tmpdir(), "owner-test-close-"));
  const paths = window_paths("/w/tree", { cache_home: join(base, "cache"), state_home: join(base, "state") });
  mkdirSync(paths.profile_dir, { recursive: true });
  const state: WindowState = { worktree: paths.worktree, profile: paths.profile_dir, log: paths.log_file, stamp: "s", app: "betterbird", binary: "/usr/bin/betterbird", started: "t", unit: null, app_pid: 100, app_start_ticks: 7 };
  write_state(paths.state_file, state);
  return { base, paths, state, done: () => rmSync(base, { recursive: true, force: true }) };
}

test("nothing open with no state file: nothing signalled, nothing deleted", async () => {
  const { paths, done } = setup();
  try {
    rmSync(paths.state_file);
    const fake = fake_machine();
    const result = await close_window(paths, fake.deps);
    assert.deepEqual([result.closed, result.complete, fake.signals, fake.removed], [false, true, [], []]);
  } finally { done(); }
});

test("closes the app, then deletes exactly the derived window folder and the state file", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine();
    fake.processes.set(100, 7);
    const result = await close_window(paths, fake.deps);
    assert.equal(result.closed, true);
    assert.deepEqual(fake.signals, ["SIGTERM 100"]);
    assert.deepEqual(fake.removed, [paths.window_dir]);
    assert.equal(existsSync(paths.state_file), false);
  } finally { done(); }
});

test("a stale state after a crash (process gone) is cleaned without a signal", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine();
    const result = await close_window(paths, fake.deps);
    assert.deepEqual([result.closed, fake.signals, fake.removed], [true, [], [paths.window_dir]]);
    assert.equal(existsSync(paths.state_file), false);
  } finally { done(); }
});

test("a reused pid (other start ticks) is never signalled", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine();
    fake.processes.set(100, 99999);
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, []);
    assert.match(result.lines.join("\n"), /now belongs to another process/);
    assert.equal(result.closed, true);
  } finally { done(); }
});

test("close racing an app that ignores SIGTERM escalates to SIGKILL and then deletes", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine([100]);
    fake.processes.set(100, 7);
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, ["SIGTERM 100", "SIGKILL 100"]);
    assert.equal(result.closed, true);
    assert.deepEqual(fake.removed, [paths.window_dir]);
  } finally { done(); }
});

test("an app that survives SIGKILL keeps the folder and the state", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine([100], [100]);
    fake.processes.set(100, 7);
    const result = await close_window(paths, fake.deps);
    assert.deepEqual([result.closed, result.complete, fake.removed], [false, false, []]);
    assert.equal(read_state(paths.state_file).kind, "ok");
  } finally { done(); }
});

test("a pid-less state written before the spawn finds the app by its profile and stops it", async () => {
  const { paths, state, done } = setup();
  try {
    write_state(paths.state_file, { ...state, app_pid: 0, app_start_ticks: 0 });
    const fake = fake_machine();
    fake.processes.set(300, 55);
    fake.found = { pid: 300, start_ticks: 55 };
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, ["SIGTERM 300"]);
    assert.equal(result.closed, true);
  } finally { done(); }
});

test("an app relaunched under a new pid is stopped too, so no process outlives the folder", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine();
    fake.processes.set(100, 7);
    fake.processes.set(400, 66);
    fake.found = { pid: 400, start_ticks: 66 };
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, ["SIGTERM 100", "SIGTERM 400"]);
    assert.equal(result.closed, true);
  } finally { done(); }
});

test("a corrupt state file is no excuse to delete anything but the derived folder, and the app is still found by profile", async () => {
  const { paths, done } = setup();
  try {
    writeFileSync(paths.state_file, "{ cut off");
    const fake = fake_machine();
    fake.processes.set(300, 55);
    fake.found = { pid: 300, start_ticks: 55 };
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, ["SIGTERM 300"]);
    assert.deepEqual(fake.removed, [paths.window_dir]);
    assert.equal(result.closed, true);
  } finally { done(); }
});

test("two keys sharing a profile: a state that names another worktree or profile deletes and signals nothing", async () => {
  const { paths, state, done } = setup();
  try {
    for (const foreign of [{ ...state, worktree: "/other/tree" }, { ...state, profile: "/home/someone/.thunderbird/z3hegesv.default-default" }, { ...state, profile: join(paths.cache_root, "other-key", "profile") }]) {
      write_state(paths.state_file, foreign);
      const fake = fake_machine();
      fake.processes.set(100, 7);
      const result = await close_window(paths, fake.deps);
      assert.deepEqual([result.closed, result.complete, fake.signals, fake.removed], [false, false, [], []]);
      assert.equal(read_state(paths.state_file).kind, "ok", "the foreign record is left for the maintainer");
    }
  } finally { done(); }
});

test("a window folder that is a symlink is left alone", async () => {
  const { base, paths, done } = setup();
  try {
    rmSync(paths.window_dir, { recursive: true });
    mkdirSync(join(base, "elsewhere", "profile"), { recursive: true });
    symlinkSync(join(base, "elsewhere"), paths.window_dir);
    const fake = fake_machine();
    const result = await close_window(paths, fake.deps);
    assert.deepEqual([result.closed, fake.removed], [false, []]);
    assert.ok(existsSync(join(base, "elsewhere", "profile")));
  } finally { done(); }
});

test("a state that names a unit stops it first, and an unconfirmed stop keeps everything", async () => {
  const { paths, state, done } = setup();
  try {
    write_state(paths.state_file, { ...state, unit: "owner-test-unit" });
    const fake = fake_machine();
    const result = await close_window(paths, { ...fake.deps, stop_unit: () => false });
    assert.deepEqual([result.closed, result.complete, fake.removed], [false, false, []]);
    const confirmed = await close_window(paths, fake.deps);
    assert.deepEqual([confirmed.closed, fake.unit_stops], [true, ["owner-test-unit"]]);
  } finally { done(); }
});

test("a recorded pid whose command line does not name this profile is never signalled", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine();
    fake.processes.set(100, 7);
    fake.foreign.add(100);
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, []);
    assert.match(result.lines.join("\n"), /does not run with this window's profile/);
    assert.equal(result.closed, true, "the folder of this window is still cleaned");
  } finally { done(); }
});

test("processes of the app's group that outlive the leader get SIGKILL, and only those listed", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine();
    fake.processes.set(100, 7);
    fake.processes.set(101, 8);
    fake.processes.set(102, 9);
    fake.processes.set(500, 1);
    fake.groups.set(100, [{ pid: 101, start_ticks: 8 }, { pid: 102, start_ticks: 9 }]);
    // The members ignore SIGTERM because nobody sends it to them: only the leader is signalled first.
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, ["SIGTERM 100", "SIGKILL 101", "SIGKILL 102"]);
    assert.equal(fake.processes.has(500), true, "an unrelated process is untouched");
    assert.equal(result.closed, true);
  } finally { done(); }
});

test("a group member whose pid was reused (other ticks) is not signalled", async () => {
  const { paths, done } = setup();
  try {
    const fake = fake_machine();
    fake.processes.set(100, 7);
    fake.processes.set(101, 99);
    fake.groups.set(100, [{ pid: 101, start_ticks: 8 }]);
    await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, ["SIGTERM 100"]);
  } finally { done(); }
});

test("every process found for the profile is stopped, not only the first", async () => {
  const { paths, state, done } = setup();
  try {
    write_state(paths.state_file, { ...state, app_pid: 0, app_start_ticks: 0 });
    const fake = fake_machine();
    fake.processes.set(300, 55);
    fake.processes.set(301, 56);
    fake.found = { pid: 300, start_ticks: 55 };
    fake.more = [{ pid: 301, start_ticks: 56 }];
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, ["SIGTERM 300", "SIGTERM 301"]);
    assert.equal(result.closed, true);
  } finally { done(); }
});

test("with no state file, an app that still runs on the profile is stopped and the folder deleted", async () => {
  const { paths, done } = setup();
  try {
    rmSync(paths.state_file);
    const fake = fake_machine();
    fake.processes.set(300, 55);
    fake.found = { pid: 300, start_ticks: 55 };
    const result = await close_window(paths, fake.deps);
    assert.deepEqual(fake.signals, ["SIGTERM 300"]);
    assert.deepEqual([result.closed, fake.removed], [true, [paths.window_dir]]);
  } finally { done(); }
});
