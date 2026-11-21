import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
