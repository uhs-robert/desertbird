import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { start_session, holder_argv } = await import(join(import.meta.dirname, "..", "..", "tools", "measure", "session.mjs"));

const { sweep_dead_runs } = await import(join(import.meta.dirname, "..", "..", "tools", "e2e", "sweep.mjs"));

const SEAT_KEYBOARD_BIT = 2;
const missing_tool = ["labwc", "wtype", "wlrctl"].find((tool) => {
  try {
    execFileSync("which", [tool], { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
});
const skip = missing_tool === undefined ? false : `${missing_tool} is not installed`;

// What a client that connects now sees: the seat capabilities that the compositor sends on bind. A wlrctl run with no toplevels may exit nonzero, so only its protocol trace is read.
function seat_capabilities(env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile("wlrctl", ["toplevel", "list"], { env: { ...env, WAYLAND_DEBUG: "1" }, timeout: 15000 }, (_error, _stdout, stderr) => {
      const found = /wl_seat#\d+\.capabilities\((\d+)\)/.exec(stderr);
      return found ? resolve(Number(found[1])) : reject(new Error(`no wl_seat.capabilities in the trace: ${stderr.slice(0, 300)}`));
    });
  });
}

const holder_pids = (runtime_dir: string) =>
  readdirSync("/proc").filter((entry) => {
    if (!/^\d+$/.test(entry)) return false;
    try {
      const args = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      const environment = readFileSync(`/proc/${entry}/environ`, "utf8").split("\0");
      return args[0]?.endsWith("wtype") === true && args.includes("-s") && environment.includes(`XDG_RUNTIME_DIR=${runtime_dir}`);
    } catch {
      return false;
    }
  });

async function until_empty(list: () => string[], deadline_ms = 8000) {
  for (let waited = 0; list().length > 0 && waited <= deadline_ms; waited += 50) await new Promise((wake) => setTimeout(wake, 50));
  return list();
}

// wtype multiplies each -s value by 1000 in an unsigned 32-bit int. 86400000 wrapped to about 510 s and the holder died mid-run. This needs no compositor, so it runs everywhere.
test("the holder argv keeps every sleep below the wtype overflow and lasts a day", () => {
  const [command, ...args]: string[] = holder_argv();
  assert.equal(command, "wtype");
  const sleeps = args.flatMap((arg, at) => (arg === "-s" ? [Number(args[at + 1])] : []));
  assert.equal(args.length, sleeps.length * 2, "the argv holds only -s pairs");
  for (const ms of sleeps as number[]) assert.ok(ms * 1000 < 2 ** 32, `${ms} ms wraps in wtype`);
  assert.ok((sleeps as number[]).reduce((sum: number, ms: number) => sum + ms, 0) >= 86_400_000, "the holder lasts at least a day");
});

test("the seat keeps its keyboard after a key and a click", { skip, timeout: 60_000 }, async () => {
  const work_dir = mkdtempSync(join(tmpdir(), "session-keyboard-test-"));
  const session = await start_session(work_dir);
  try {
    await session.press(["-k", "Shift_L"]);
    execFileSync("wlrctl", ["pointer", "click", "left"], { env: session.env, timeout: 15000 });
    await new Promise((wake) => setTimeout(wake, 200));
    const capabilities = await seat_capabilities(session.env);
    assert.equal(capabilities & SEAT_KEYBOARD_BIT, SEAT_KEYBOARD_BIT, `seat capabilities ${capabilities} lack the keyboard bit`);
  } finally {
    session.stop();
    rmSync(work_dir, { recursive: true, force: true });
  }
});

test("stop ends the held keyboard with the session", { skip, timeout: 60_000 }, async () => {
  const work_dir = mkdtempSync(join(tmpdir(), "session-keyboard-test-"));
  const session = await start_session(work_dir);
  try {
    const runtime_dir = session.env.XDG_RUNTIME_DIR;
    assert.equal(holder_pids(runtime_dir).length, 1, "one holder runs while the session runs");
    session.stop();
    assert.deepEqual(await until_empty(() => holder_pids(runtime_dir)), [], "the holder is gone after stop");
  } finally {
    session.stop();
    rmSync(work_dir, { recursive: true, force: true });
  }
});

test("a session that cannot start its holder stops labwc and throws", { skip, timeout: 60_000 }, async () => {
  const work_dir = mkdtempSync(join(tmpdir(), "session-keyboard-test-"));
  const bin_dir = join(work_dir, "bin");
  mkdirSync(bin_dir);
  for (const tool of ["labwc", "sh"]) symlinkSync(execFileSync("which", [tool], { encoding: "utf8" }).trim(), join(bin_dir, tool));
  const real_path = process.env.PATH;
  // A PATH with labwc and sh and no wtype: the holder cannot exec.
  process.env.PATH = bin_dir;
  try {
    await assert.rejects(start_session(join(work_dir, "session")), /keyboard holder/);
  } finally {
    process.env.PATH = real_path;
  }
  const labwc_pids = () => readdirSync("/proc").filter((entry) => /^\d+$/.test(entry) && (() => {
    try {
      return readFileSync(`/proc/${entry}/cmdline`, "utf8").includes(join(work_dir, "session"));
    } catch {
      return false;
    }
  })());
  try {
    assert.deepEqual(await until_empty(labwc_pids), [], "labwc is gone after the failed start");
  } finally {
    rmSync(work_dir, { recursive: true, force: true });
  }
});

test("the sweep ends the holder of a run that SIGKILL ended", { skip, timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "session-keyboard-test-"));
  const run_dir = join(root, "desertbird-e2e-d");
  // Short names: a unix socket path holds about 100 bytes, and the scratch TMPDIR of `just test` is long.
  const runtime_dir = join(run_dir, "m", "runtime");
  mkdirSync(run_dir, { recursive: true });
  const session_module = join(import.meta.dirname, "..", "..", "tools", "measure", "session.mjs");
  // The child starts a session and waits. SIGKILL gives it no chance to stop the session.
  const child = spawn(process.execPath, ["--input-type=module", "-e", `const { start_session } = await import(${JSON.stringify(session_module)}); await start_session(${JSON.stringify(join(run_dir, "m"))}); console.log("up"); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("exit", () => reject(new Error("the session child ended before it was up")));
    });
    assert.equal(holder_pids(runtime_dir).length, 1, "the holder runs");
    child.kill("SIGKILL");
    await new Promise((wake) => child.once("exit", wake));
    assert.equal(holder_pids(runtime_dir).length, 1, "the holder outlives the killed run");
    sweep_dead_runs(root);
    assert.deepEqual(await until_empty(() => holder_pids(runtime_dir)), [], "the sweep killed the holder");
  } finally {
    child.kill("SIGKILL");
    sweep_dead_runs(root);
    rmSync(root, { recursive: true, force: true });
  }
});
