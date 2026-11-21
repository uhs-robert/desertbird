import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The coordinator forks test/e2e_fake_worker.mjs, which speaks the worker's messages and starts no app. A word in each piece id picks its behavior.
// This file never imports harness.mjs: its shutdown state is per process, and the signal test runs the lifecycle in a child of its own.
const tools_dir = join(import.meta.dirname, "..", "tools", "e2e");
const { run_sharded } = await import(join(tools_dir, "coordinator.mjs"));
const fake_worker = join(import.meta.dirname, "e2e_fake_worker.mjs");

const LIMIT = { timeout: 30_000 };

type Merged = { pieces: { name: string; worker: number; timed_out?: boolean; died?: boolean; in_flight?: boolean }[]; failures: string[]; failed_checks: { piece: string }[]; incomplete?: { reason: string; in_flight: string[]; not_started: string[] }; workers: { worker: number; pieces: string[] }[]; exit_code: number };

function group_members_running(pgid: number) {
  return readdirSync("/proc").filter((entry) => {
    if (!/^\d+$/.test(entry)) return false;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "latin1");
      const [state, , group] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return Number(group) === pgid && state !== "Z";
    } catch {
      return false;
    }
  });
}
async function until(predicate: () => boolean, deadline_ms = 5000) {
  for (const started = Date.now(); !predicate(); await new Promise((wake) => setTimeout(wake, 25))) {
    if (Date.now() - started > deadline_ms) return false;
  }
  return true;
}
const pid_alive = (pid: number) => existsSync(`/proc/${pid}`) && !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "latin1"));
const numbers_after = (lines: string[], word: string) => lines.flatMap((line) => { const found = new RegExp(`\\] ${word} (\\d+)$`).exec(line); return found ? [Number(found[1])] : []; });

// The pieces that hang, crash or run slow weigh more, so they go out first.
const heavy_first = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, /hang|app|crash|slow/.test(id) ? 9 : 1]));

// Runs the coordinator on the fake worker in a fresh temp dir. Every worker and fake app it named is killed when the test ends, pass or fail.
type Handle = { stop: (reason: string, code: number) => void };
async function run_fake(t: { signal: AbortSignal }, ids: string[], options: Record<string, unknown> = {}, during?: (lines: string[], sharded: Handle) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "e2e-coordinator-test-"));
  const lines: string[] = [];
  const cleanup = () => {
    for (const pid of numbers_after(lines, "pid")) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    for (const pid of numbers_after(lines, "app")) try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  };
  t.signal.addEventListener("abort", cleanup, { once: true });
  try {
    const sharded = run_sharded({
      ids, weights: heavy_first(ids), shard_count: 2, deadline_s: 20, piece_deadline_of: () => 10,
      init: { run_dir: root, xpi_path: "x.xpi", binaries: {} },
      timings_path: join(root, "timings.json"), report_path: join(root, "timings.report.json"), filter: undefined,
      worker_file: fake_worker, stagger_ms: 0, stop_grace_ms: 500, log: (line: string) => lines.push(...line.split("\n")),
      env: { ...process.env },
      ...options,
    });
    await during?.(lines, sharded);
    const result = await sharded.done;
    const merged: Merged = JSON.parse(readFileSync(join(root, "timings.json"), "utf8"));
    const report = existsSync(join(root, "timings.report.json")) ? JSON.parse(readFileSync(join(root, "timings.report.json"), "utf8")) : null;
    // No worker outlives the run, and no app a worker started either.
    for (const pid of numbers_after(lines, "pid")) assert.ok(await until(() => !pid_alive(pid)), `worker ${pid} is gone`);
    for (const pid of numbers_after(lines, "app")) assert.ok(await until(() => group_members_running(pid).length === 0), `app group ${pid} is gone`);
    return { result, merged, report, lines };
  } finally {
    cleanup();
  }
}

test("pieces spread over two workers, and the merged checks follow the registry order whatever order they finished in", LIMIT, async (t) => {
  // The slow piece goes out first and ends last.
  const ids = ["thunderbird/a/slow", "thunderbird/b/main", "betterbird/a/main", "betterbird/b/main"];
  const { result, merged, report, lines } = await run_fake(t, ids, {});
  assert.equal(result.exit_code, 0, lines.join("\n"));
  assert.deepEqual(report.checks.map((check: { piece: string }) => check.piece), ids);
  assert.ok(report.checks.every((check: { worker: number }) => check.worker === 1 || check.worker === 2));
  // Either worker can be ready first. The one that took the slow piece ran nothing else.
  assert.deepEqual(merged.workers.map((worker) => worker.pieces.length).sort(), [1, 3]);
  assert.deepEqual(merged.workers.find((worker) => worker.pieces.length === 1)?.pieces, ["thunderbird/a/slow"]);
  assert.equal(merged.pieces.length, 4);
  assert.equal(merged.incomplete, undefined);
  assert.ok(lines.some((line) => /^\[w2\] running /.test(line)) && lines.some((line) => /^\[w1\] running /.test(line)), "worker lines carry their tag");
  assert.ok(lines.includes("e2e: 4 of 4 checks passed"));
});

test("a failed check fails the run and is listed by piece", LIMIT, async (t) => {
  const { result, merged } = await run_fake(t, ["thunderbird/a/fail", "thunderbird/b/main"]);
  assert.equal(result.exit_code, 1);
  assert.deepEqual(merged.failed_checks.map((check) => check.piece), ["thunderbird/a/fail"]);
  assert.deepEqual(merged.failures, []);
});

test("a hung piece hits its piece deadline, fails by name, and a fresh worker takes the rest of the queue", LIMIT, async (t) => {
  const { result, merged, lines } = await run_fake(t, ["thunderbird/a/hang", "thunderbird/b/main", "thunderbird/c/main"], { shard_count: 1, piece_deadline_of: (id: string) => (id.includes("hang") ? 1 : 10) });
  assert.equal(result.exit_code, 1);
  assert.deepEqual(merged.failures, ["thunderbird/a/hang: no result within 1 s (piece deadline)"]);
  assert.ok(merged.pieces.some((entry) => entry.name === "thunderbird/a/hang" && entry.timed_out));
  assert.deepEqual(merged.workers.map((worker) => worker.pieces), [["thunderbird/a/hang"], ["thunderbird/b/main", "thunderbird/c/main"]]);
  assert.equal(merged.incomplete, undefined);
  assert.ok(lines.includes("e2e: w1 is gone, starting a fresh worker"));
});

test("a worker that ignores SIGTERM after its piece deadline is killed, and the apps of its piece are reaped", LIMIT, async (t) => {
  const { result, merged, lines } = await run_fake(t, ["thunderbird/a/stubborn_app", "thunderbird/b/main"], { shard_count: 1, piece_deadline_of: (id: string) => (id.includes("app") ? 1 : 10) });
  assert.equal(result.exit_code, 1);
  assert.ok(lines.includes("[w1] ignoring SIGTERM"));
  assert.ok(lines.some((line) => /w1 did not stop within 0.5 s, killing it/.test(line)));
  assert.ok(lines.some((line) => /w1 left 1 process groups of thunderbird\/a\/stubborn_app, killed them/.test(line)), lines.join("\n"));
  assert.deepEqual(merged.failures, ["thunderbird/a/stubborn_app: no result within 1 s (piece deadline)"]);
  assert.deepEqual(merged.workers.map((worker) => worker.pieces), [["thunderbird/a/stubborn_app"], ["thunderbird/b/main"]]);
});

test("a worker that crashes mid-piece fails that piece, and a fresh worker runs on", LIMIT, async (t) => {
  const { result, merged } = await run_fake(t, ["thunderbird/a/crash", "thunderbird/b/main", "thunderbird/c/main"], { shard_count: 1 });
  assert.equal(result.exit_code, 1);
  assert.deepEqual(merged.failures, ["thunderbird/a/crash: worker w1 died (exit 3) while running it"]);
  assert.ok(merged.pieces.some((entry) => entry.name === "thunderbird/a/crash" && entry.died));
  assert.deepEqual(merged.workers.map((worker) => worker.pieces), [["thunderbird/a/crash"], ["thunderbird/b/main", "thunderbird/c/main"]]);
  assert.equal(merged.incomplete, undefined);
});

test("a worker killed with SIGKILL mid-piece has its apps reaped and is replaced", LIMIT, async (t) => {
  const kill_worker_when_its_app_runs = async (lines: string[]) => {
    assert.ok(await until(() => numbers_after(lines, "app").length > 0), "the fake app started");
    process.kill(numbers_after(lines, "pid")[0] as number, "SIGKILL");
  };
  const { result, merged, lines } = await run_fake(t, ["thunderbird/a/app", "thunderbird/b/main"], { shard_count: 1 }, kill_worker_when_its_app_runs);
  assert.equal(result.exit_code, 1);
  assert.deepEqual(merged.failures, ["thunderbird/a/app: worker w1 died (signal SIGKILL) while running it"]);
  assert.ok(lines.some((line) => /w1 left 1 process groups of thunderbird\/a\/app/.test(line)));
  assert.deepEqual(merged.workers.map((worker) => worker.pieces), [["thunderbird/a/app"], ["thunderbird/b/main"]]);
});

test("a worker that dies before ready is not replaced, and the queue is reported incomplete", LIMIT, async (t) => {
  const { result, merged } = await run_fake(t, ["thunderbird/a/main", "thunderbird/b/main", "thunderbird/c/main"], { env: { ...process.env, FAKE_WORKER_START: "fail" } });
  assert.equal(result.exit_code, 1);
  assert.equal(merged.workers.length, 2);
  assert.deepEqual([...merged.failures].sort(), ["worker w1 startup: the fake worker was told to fail", "worker w2 startup: the fake worker was told to fail"]);
  assert.deepEqual(merged.incomplete, { reason: "every worker exited before the queue was empty", in_flight: [], not_started: ["thunderbird/a/main", "thunderbird/b/main", "thunderbird/c/main"] });
});

test("the run deadline also stops workers that never say ready", LIMIT, async (t) => {
  const started = Date.now();
  const { result, merged } = await run_fake(t, ["thunderbird/a/main", "thunderbird/b/main"], { deadline_s: 1, env: { ...process.env, FAKE_WORKER_START: "silent" } });
  assert.ok(Date.now() - started < 8000);
  assert.equal(result.exit_code, 1);
  assert.match(result.stop_reason, /the 1 s deadline passed/);
  assert.deepEqual(merged.incomplete?.not_started, ["thunderbird/a/main", "thunderbird/b/main"]);
});

// A fork that cannot spawn emits error and close, and no exit. The run must still end, or the lock stays held.
test("a worker that fails to spawn ends the run with a startup failure", LIMIT, async (t) => {
  const { fork } = await import("node:child_process");
  const fork_with_no_node = (file: string, args: string[], options: object) => fork(file, args, { ...options, execPath: "/nonexistent/node" });
  const { result, merged } = await run_fake(t, ["thunderbird/a/main", "thunderbird/b/main"], { fork: fork_with_no_node });
  assert.equal(result.exit_code, 1);
  assert.equal(merged.workers.length, 2, "no replacement for a worker that never started");
  assert.equal(merged.failures.length, 2);
  for (const failure of merged.failures) assert.match(failure, /^worker w\d startup/);
  assert.deepEqual(merged.incomplete?.not_started, ["thunderbird/a/main", "thunderbird/b/main"]);
});

test("the run deadline stops every worker mid-piece and names the pieces in flight and not started", LIMIT, async (t) => {
  const ids = ["thunderbird/a/hang", "thunderbird/b/app", "thunderbird/c/main", "thunderbird/d/main"];
  const started = Date.now();
  const { result, merged } = await run_fake(t, ids, { deadline_s: 1 });
  assert.ok(Date.now() - started < 8000);
  assert.equal(result.exit_code, 1);
  assert.match(result.stop_reason, /the 1 s deadline passed/);
  assert.deepEqual(merged.failures, [], "a stop is no worker failure");
  assert.deepEqual(merged.incomplete?.in_flight.sort(), ["thunderbird/a/hang", "thunderbird/b/app"]);
  assert.deepEqual(merged.incomplete?.not_started, ["thunderbird/c/main", "thunderbird/d/main"]);
  assert.equal(merged.pieces.filter((entry) => entry.in_flight).length, 2);
});

test("stop() from a signal handler ends the run with the signal's code and starts no replacement", LIMIT, async (t) => {
  const ids = ["thunderbird/a/hang", "thunderbird/b/hang", "thunderbird/c/main"];
  const stop_when_both_run = async (lines: string[], sharded: Handle) => {
    assert.ok(await until(() => lines.filter((line) => line.includes("] running ")).length === 2));
    sharded.stop("received SIGINT", 130);
  };
  const { result, merged } = await run_fake(t, ids, {}, stop_when_both_run);
  assert.equal(result.exit_code, 130);
  assert.equal(merged.workers.length, 2);
  assert.deepEqual(merged.incomplete?.in_flight.sort(), ["thunderbird/a/hang", "thunderbird/b/hang"]);
  assert.deepEqual(merged.incomplete?.not_started, ["thunderbird/c/main"]);
});

// The real lifecycle: SIGINT to a process that holds the lock and runs workers whose pieces hold apps.
test("SIGINT to the coordinator stops every worker and app, writes the report and frees the lock", LIMIT, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "e2e-coordinator-signal-test-"));
  const script = `
    import { install_lifecycle } from ${JSON.stringify(join(tools_dir, "harness.mjs"))};
    import { open_run_dir } from ${JSON.stringify(join(tools_dir, "run_dir.mjs"))};
    import { run_sharded } from ${JSON.stringify(join(tools_dir, "coordinator.mjs"))};
    const run_dir = open_run_dir({ env: { E2E_DIR: ${JSON.stringify(root)} } });
    let sharded = null;
    install_lifecycle(run_dir, { on_signal: async (signal) => { sharded?.stop("received " + signal, 130); await sharded?.done; console.log("on_signal done"); } });
    sharded = run_sharded({ ids: ["thunderbird/a/app", "thunderbird/b/app", "thunderbird/c/main"], weights: { "thunderbird/a/app": 9, "thunderbird/b/app": 9 }, shard_count: 2, deadline_s: 20, piece_deadline_of: () => 10,
      init: { run_dir: run_dir.dir, xpi_path: "x.xpi", binaries: {} }, timings_path: ${JSON.stringify(join(root, "timings.json"))}, report_path: null, worker_file: ${JSON.stringify(fake_worker)}, stagger_ms: 0, stop_grace_ms: 2000 });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"], signal: t.signal, killSignal: "SIGKILL" });
  child.on("error", () => {});
  const lines: string[] = [];
  let fragment = "";
  child.stdout.on("data", (data) => { const parts = (fragment + data).split("\n"); fragment = parts.pop() ?? ""; lines.push(...parts); });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  const cleanup = () => {
    for (const pid of numbers_after(lines, "pid")) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    for (const pid of numbers_after(lines, "app")) try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  };
  t.signal.addEventListener("abort", cleanup, { once: true });
  try {
    assert.ok(await until(() => numbers_after(lines, "app").length === 2, 10_000), `both fake apps started: ${lines.join("\n")} ${stderr}`);
    assert.ok(existsSync(join(root, "run.lock")));
    child.kill("SIGINT");
    assert.equal(await exited, 130, stderr);
    assert.ok(lines.includes("on_signal done"), "the hook ran before the exit");
    assert.ok(!existsSync(join(root, "run.lock")), "the lock is free");
    const merged = JSON.parse(readFileSync(join(root, "timings.json"), "utf8"));
    assert.equal(merged.exit_code, 130);
    assert.deepEqual(merged.incomplete.in_flight.sort(), ["thunderbird/a/app", "thunderbird/b/app"]);
    for (const pid of numbers_after(lines, "pid")) assert.ok(await until(() => !pid_alive(pid)), `worker ${pid} is gone`);
    for (const pid of numbers_after(lines, "app")) assert.ok(await until(() => group_members_running(pid).length === 0), `app group ${pid} is gone`);
  } finally {
    cleanup();
  }
});
