import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { sweep_dead_runs } = await import(join(import.meta.dirname, "..", "tools", "e2e", "sweep.mjs"));
const { process_start_ticks } = await import(join(import.meta.dirname, "..", "tools", "e2e", "run_dir.mjs"));

// A detached group that stands in for an app or a reader: the shell keeps its arguments on its command line.
function fake_process(...args: string[]) {
  const group = spawn("sh", ["-c", "sleep 600; :", "sh", ...args], { detached: true, stdio: "ignore" });
  group.unref();
  return group.pid as number;
}

function is_running(pid: number) {
  try {
    const state = readFileSync(`/proc/${pid}/stat`, "latin1");
    return state.slice(state.lastIndexOf(")") + 2, state.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

async function gone(pid: number) {
  for (let waited = 0; is_running(pid); waited += 25) {
    if (waited > 5000) return false;
    await new Promise((wake) => setTimeout(wake, 25));
  }
  return true;
}

// Stands in for the session's `wtype -s <ms>` holder: a shell that shows wtype as its argv[0], with the runtime dir in its environment and no dir on its command line.
function fake_holder(runtime_dir: string, ...args: string[]) {
  const group = spawn("/bin/sh", ["-c", "sleep 600; :", ...args], { argv0: "wtype", detached: true, stdio: "ignore", env: { PATH: process.env.PATH, XDG_RUNTIME_DIR: runtime_dir } });
  group.unref();
  return group.pid as number;
}

test("sweep_dead_runs kills the apps of a dead or unlocked run and spares a live run, a reader and anything outside the prefix", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-sweep-test-"));
  const dead_dir = join(root, "desertbird-e2e-dead");
  const unlocked_dir = join(root, "desertbird-e2e-unlocked");
  const live_dir = join(root, "desertbird-e2e-live");
  const owner_dir = join(root, "thunderbird-profile");
  for (const dir of [dead_dir, unlocked_dir, live_dir, owner_dir]) mkdirSync(join(dir, "profile"), { recursive: true });
  // The dead run's lock names a pid that does not exist. The live run's lock names this process with its real start time. The unlocked dir has no lock.
  writeFileSync(join(dead_dir, "run.lock"), "999999999 1\n");
  writeFileSync(join(live_dir, "run.lock"), `${process.pid} ${process_start_ticks(process.pid)}\n`);
  const orphan = fake_process("betterbird", "-profile", join(dead_dir, "betterbird", "zoom", "main", "profile"));
  const orphan_labwc = fake_process("labwc", "-C", join(dead_dir, "betterbird", "zoom", "main", "labwc"));
  const unlocked = fake_process("betterbird", "-profile", join(unlocked_dir, "betterbird", "zoom", "main", "profile"));
  const live = fake_process("betterbird", "-profile", join(live_dir, "betterbird", "zoom", "main", "profile"));
  const outside = fake_process("betterbird", "-profile", join(owner_dir, "profile"));
  // A reader of the kept evidence of the dead run: it names the dir without the flags a run's processes carry.
  const reader = fake_process("less", join(dead_dir, "betterbird", "zoom", "main", "app.log"));
  const holder = fake_holder(join(dead_dir, "betterbird", "zoom", "main", "runtime"), "-s", "86400000");
  const live_holder = fake_holder(join(live_dir, "betterbird", "zoom", "main", "runtime"), "-s", "86400000");
  const outside_holder = fake_holder(join(owner_dir, "runtime"), "-s", "86400000");
  // A one-shot wtype of the dead run (no -s) is no holder.
  const one_shot = fake_holder(join(dead_dir, "betterbird", "zoom", "main", "runtime"), "-k", "Escape");
  const all = [orphan, orphan_labwc, unlocked, live, outside, reader, holder, live_holder, outside_holder, one_shot];
  try {
    // Wait until each shell has started, so the sweep can see its command line.
    await new Promise((wake) => setTimeout(wake, 300));
    const swept: { run_dir: string; groups: number[] }[] = sweep_dead_runs(root);
    assert.deepEqual(swept.map(({ run_dir, groups }) => ({ run_dir, groups: groups.sort() })).sort((first, second) => first.run_dir.localeCompare(second.run_dir)), [
      { run_dir: dead_dir, groups: [orphan, orphan_labwc, holder].sort() },
      { run_dir: unlocked_dir, groups: [unlocked] },
    ]);
    for (const pid of [orphan, orphan_labwc, unlocked, holder]) assert.ok(await gone(pid), `${pid} is killed`);
    assert.ok(is_running(live), "the live run's app survives");
    assert.ok(is_running(outside), "a process outside the prefix survives");
    assert.ok(is_running(reader), "a reader of the dead run's logs survives");
    assert.ok(is_running(live_holder), "the live run's holder survives");
    assert.ok(is_running(outside_holder), "a holder outside the prefix survives");
    assert.ok(is_running(one_shot), "a wtype with no -s survives");
    assert.equal(existsSync(join(unlocked_dir, "run.lock")), false, "the sweep releases the lock it took");
  } finally {
    for (const pid of all) try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});
