import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The harness keeps its shutdown state for the life of the process, so this file holds the one test that starts a shutdown.
const { start_app, stop_all_apps } = await import(join(import.meta.dirname, "..", "tools", "e2e", "harness.mjs"));

test("a restart that begins during a shutdown starts no new app", { timeout: 30_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "e2e-shutdown-test-"));
  const server = net.createServer();
  // Stopped at the end: the sink and the memory sampler hold the event loop open.
  let instance: { restart: () => Promise<void>; stop: () => Promise<void> } | undefined;
  const children: number[] = [];
  let released: Promise<void> | undefined;
  const release_all = () => (released ??= (async () => {
    for (const pid of children) try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    server.close();
    await instance?.stop();
    rmSync(root, { recursive: true, force: true });
  })());
  // A timed-out test never reaches its finally, and the server, the sink and the groups would keep the file's process alive.
  t.signal.addEventListener("abort", () => { void release_all(); }, { once: true });
  try {
    const runtime = join(root, "runtime");
    mkdirSync(runtime);
    await new Promise<void>((done) => server.listen(join(runtime, "wayland-0"), done));
    let spawned = 0;
    // A session stand-in: one detached group per app, and an environment that passes the guard.
    const fake_session = {
      env: { HOME: join(root, "home"), XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: "wayland-0" },
      groups: children,
      press: async () => undefined,
      spawn_app: () => {
        spawned++;
        const child = spawn("sleep", ["600"], { detached: true, stdio: "ignore" });
        child.unref();
        children.push(child.pid as number);
        return child;
      },
      stop: () => { for (const pid of children) try { process.kill(-pid, "SIGTERM"); } catch { /* gone */ } },
    };
    const started = await start_app({ app: "betterbird", app_binary: "unused", work_dir: join(root, "work"), run_dir: root, startup_ms: 10, begin_session: async () => fake_session });
    instance = started;
    assert.equal(spawned, 1);
    const stopping = stop_all_apps();
    await assert.rejects(started.restart(), /no app restarts/);
    assert.equal(spawned, 1, "no second app was started");
    await stopping;
    for (const pid of children) assert.throws(() => process.kill(-pid, 0), "the group is gone");
  } finally {
    await release_all();
  }
});

// A child process, so this file keeps its one shutdown and the lifecycle handlers stay out of the test runner.
test("install_lifecycle with announce false prints nothing when the run closes", { timeout: 30_000 }, () => {
  const script = `
    import { install_lifecycle } from ${JSON.stringify(join(import.meta.dirname, "..", "tools", "e2e", "harness.mjs"))};
    const finish = install_lifecycle({ dir: "/nowhere", close: () => "closed" }, { announce: false });
    finish(true);
    console.log("finished");`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" });
  assert.equal(run.stdout, "finished\n", run.stderr);
});

// A worker whose coordinator disconnects calls stop_all_apps while run_piece may be inside start_app. The shutdown must wait for that start, stop its
// compositor and let no app spawn after it. A child process, for the same reason as above.
test("a shutdown during an app start in flight waits for it, stops its session and spawns no app", { timeout: 30_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-start-in-flight-test-"));
  const script = `
    import { spawn } from "node:child_process";
    import { mkdirSync } from "node:fs";
    import net from "node:net";
    import { join } from "node:path";
    import { start_app, stop_all_apps } from ${JSON.stringify(join(import.meta.dirname, "..", "tools", "e2e", "harness.mjs"))};
    const root = ${JSON.stringify(root)};
    const work_dir = join(root, "work");
    const runtime = join(work_dir, "runtime");
    mkdirSync(runtime, { recursive: true });
    const server = net.createServer();
    await new Promise((done) => server.listen(join(runtime, "wayland-0"), done));
    const groups = [];
    let spawned = 0;
    const begin_session = async () => {
      const compositor = spawn("sleep", ["600"], { detached: true, stdio: "ignore" });
      compositor.unref();
      groups.push(compositor.pid);
      console.log("compositor " + compositor.pid);
      await new Promise((wake) => setTimeout(wake, 500));
      return {
        env: { HOME: join(work_dir, "home"), XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: "wayland-0" },
        groups,
        press: async () => undefined,
        spawn_app: () => { spawned++; throw new Error("an app spawned"); },
        stop: () => { for (const pid of groups) try { process.kill(-pid, "SIGKILL"); } catch {} },
      };
    };
    const starting = start_app({ app: "betterbird", app_binary: "unused", work_dir, run_dir: root, startup_ms: 10, begin_session }).catch((error) => console.log("start: " + error.message));
    await new Promise((wake) => setTimeout(wake, 100));
    await stop_all_apps();
    await starting;
    console.log("spawned " + spawned);
    server.close();`;
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" });
    const compositor = Number(/compositor (\d+)/.exec(run.stdout)?.[1]);
    try {
      assert.match(run.stdout, /start: the run is stopping, no app starts/, run.stderr);
      assert.match(run.stdout, /spawned 0/);
      assert.throws(() => process.kill(-compositor, 0), "the compositor group is gone");
    } finally {
      try { process.kill(-compositor, "SIGKILL"); } catch { /* gone */ }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
