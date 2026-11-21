// A stand-in for tools/e2e/worker.mjs in the coordinator tests. It speaks the same messages and starts no app.
// A word in the piece id picks what it does: `hang` never answers, `stubborn` also ignores SIGTERM, `crash` exits 3 mid-piece,
// `fail` reports a failed check, `slow` takes 400 ms, and `app` starts a detached group that names the piece dir on its command line, then hangs.
// FAKE_WORKER_START=fail makes every worker fail before `ready`, and FAKE_WORKER_START=silent makes it never answer `init`.
import { spawn } from "node:child_process";
import { join } from "node:path";

const send = (message) => new Promise((resolve) => {
  if (process.connected) process.send(message, () => resolve());
  else resolve();
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`pid ${process.pid}`);
process.on("disconnect", () => process.exit(1));
let run_dir = null;

process.on("message", async (message) => {
  if (message.type === "init") {
    if (process.env.FAKE_WORKER_START === "silent") return;
    if (process.env.FAKE_WORKER_START === "fail") {
      await send({ type: "startup_failed", reason: "the fake worker was told to fail" });
      process.exit(1);
    }
    run_dir = message.run_dir;
    await send({ type: "ready" });
  } else if (message.type === "stop") {
    process.exit(0);
  } else if (message.type === "run") {
    const { id } = message;
    console.log(`running ${id}`);
    if (id.includes("stubborn")) process.on("SIGTERM", () => console.log("ignoring SIGTERM"));
    if (id.includes("app")) {
      const group = spawn("sh", ["-c", "sleep 600; :", "sh", join(run_dir, id, "profile")], { detached: true, stdio: "ignore" });
      group.unref();
      console.log(`app ${group.pid}`);
    }
    if (id.includes("hang") || id.includes("app")) return;
    if (id.includes("crash")) {
      await sleep(50);
      process.exit(3);
    }
    await sleep(id.includes("slow") ? 400 : 50);
    const ok = !id.includes("fail");
    const [app, kind] = id.split("/");
    await send({
      type: "piece_done",
      id,
      ok,
      wall_ms: 50,
      report: { checks: [{ app, kind, name: `${id} ran`, ok, detail: ok ? "" : "told to fail" }], shots: [], notes: [] },
      timing_entries: [{ name: id, wall_ms: 50, startups: [{}], peak_memory_kb: { app: { rss_kb: 1024 } } }],
    });
  }
});
