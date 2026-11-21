import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { sweep_dead_runs } = await import(join(import.meta.dirname, "..", "tools", "e2e", "sweep.mjs"));
const { process_start_ticks } = await import(join(import.meta.dirname, "..", "tools", "e2e", "run_dir.mjs"));

// A detached group that stands in for an app: the shell keeps the path on its command line.
function fake_app(path: string) {
  const group = spawn("sh", ["-c", "sleep 600; :", "sh", path], { detached: true, stdio: "ignore" });
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

test("sweep_dead_runs kills the apps of a dead run and spares a live run and anything outside the prefix", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-sweep-test-"));
  const dead_dir = join(root, "desertbird-e2e-dead");
  const live_dir = join(root, "desertbird-e2e-live");
  const owner_dir = join(root, "thunderbird-profile");
  for (const dir of [dead_dir, live_dir, owner_dir]) mkdirSync(join(dir, "profile"), { recursive: true });
  // The dead run's lock names a pid that does not exist. The live run's lock names this process with its real start time.
  writeFileSync(join(dead_dir, "run.lock"), "999999999 1\n");
  writeFileSync(join(live_dir, "run.lock"), `${process.pid} ${process_start_ticks(process.pid)}\n`);
  const orphan = fake_app(join(dead_dir, "betterbird", "zoom", "main", "profile"));
  const live = fake_app(join(live_dir, "betterbird", "zoom", "main", "profile"));
  const outside = fake_app(join(owner_dir, "profile"));
  try {
    for (let waited = 0; !is_running(orphan) && waited < 5000; waited += 25) await new Promise((wake) => setTimeout(wake, 25));
    // Wait until sh has exec'd its command line, so the sweep can see the path.
    await new Promise((wake) => setTimeout(wake, 200));
    const swept = sweep_dead_runs(root);
    assert.deepEqual(swept, [{ run_dir: dead_dir, groups: [orphan] }]);
    assert.ok(await gone(orphan), "the dead run's app is killed");
    assert.ok(is_running(live), "the live run's app survives");
    assert.ok(is_running(outside), "a process outside the prefix survives");
  } finally {
    for (const pid of [orphan, live, outside]) try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});
