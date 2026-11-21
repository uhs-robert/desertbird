// The work dir of one e2e run, the lock that keeps two runs out of one dir, and the guard that keeps an app away from the owner's home and display.
// Copied in shape from DesertFox's test/key/session.mjs (make_run_dir, owner file, process_start_ticks). Departures:
// - the lock sits in the work dir and a second run refuses a live one, where DesertFox makes a fresh dir for every run and sweeps dead ones;
// - no sweep: a kept dir (failure, E2E_KEEP=1) is the evidence the owner asked for, and stays until the owner removes it;
// - a dir named by E2E_DIR is never removed, only unlocked, because the owner chose it and may hold other files there;
// - DesertFox's process sweeps (sweep_dead_sessions, sweep_orphan_compositors) are left out of this PR. A SIGKILLed run can orphan its apps, and PR 7's systemd scope is what ends them.
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const LOCK_FILE = "run.lock";
const TAKEOVER_GUARD = "run.lock.takeover";
// A takeover finishes in microseconds, so a guard this old belongs to a process that died inside it.
const TAKEOVER_GUARD_MAX_AGE_MS = 5000;

// The start time of a process in clock ticks since boot (field 22 of /proc/<pid>/stat), or undefined when it is gone.
// A pid that the kernel hands to a new process comes with a later start time, so the pair names one process.
export function process_start_ticks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}

// The path with every symlink resolved, so a link into the real home cannot pass for a path in the run dir.
// It walks the components itself, because realpathSync throws on a dangling link and a lexical fallback would then accept the link's own name.
// A dangling link is followed to its target, and the part of the path that does not exist yet is appended as it is.
function real_path(path) {
  let pending = resolve(path).split(sep).filter(Boolean);
  let resolved = sep;
  for (let links = 0; pending.length > 0; ) {
    const [next, ...rest] = pending;
    pending = rest;
    if (next === ".") continue;
    if (next === "..") {
      resolved = dirname(resolved);
      continue;
    }
    const candidate = join(resolved, next);
    let found;
    try {
      found = lstatSync(candidate);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      return join(candidate, ...pending);
    }
    if (!found.isSymbolicLink()) {
      resolved = candidate;
      continue;
    }
    if (++links > 40) throw new Error(`too many symlinks in ${path}`);
    const target = readlinkSync(candidate);
    if (isAbsolute(target)) resolved = sep;
    pending = [...target.split(sep).filter(Boolean), ...pending];
  }
  return resolved;
}

// Every path under a work dir that an app start writes or removes. start_app and the run loop check them all before the first write.
export const start_paths_of = (work_dir) => [work_dir, ...["profile", "out", "home", "runtime"].map((name) => join(work_dir, name))];

// The homes the guards protect. os.homedir() reads $HOME, which a sandbox or a caller can point anywhere, so the passwd entry counts too.
export function real_homes() {
  return [...new Set([userInfo().homedir, homedir()])];
}
const homes_of = (real_home) => (real_home === undefined ? real_homes() : [].concat(real_home));

function is_inside(path, folder) {
  const found = relative(real_path(folder), real_path(path));
  return found === "" || (!found.startsWith("..") && !isAbsolute(found));
}

function holder_of(lock_path) {
  let text;
  try {
    text = readFileSync(lock_path, "utf8");
  } catch {
    return null;
  }
  const [pid, ticks] = text.trim().split(" ");
  return { text, pid: /^\d+$/.test(pid) ? Number(pid) : null, ticks };
}

// A lock is live when its pid runs with the start time it recorded. A garbled lock is stale: the lock is linked into place whole, so it is never half written.
function lock_is_live(holder) {
  return holder.pid !== null && process_start_ticks(holder.pid) === holder.ticks;
}

// Takes the lock of `dir` or throws when a live run holds it. Returns a release function.
// The lock is a complete file linked into place, so a second run never reads it half written and exactly one link wins.
// A stale lock is replaced under a short guard dir, so two runs that find the same stale lock cannot both take it over.
export function acquire_lock(dir) {
  const lock_path = join(dir, LOCK_FILE);
  const guard_path = join(dir, TAKEOVER_GUARD);
  const mine = `${process.pid} ${process_start_ticks(process.pid)}\n`;
  const staged = join(dir, `${LOCK_FILE}.${process.pid}`);
  const try_link = () => {
    writeFileSync(staged, mine);
    try {
      linkSync(staged, lock_path);
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    } finally {
      rmSync(staged, { force: true });
    }
  };
  const refuse = (holder) => new Error(`${dir} is held by the run with pid ${holder.pid}. Give each parallel run its own E2E_DIR, or leave E2E_DIR unset.`);
  let taken = try_link();
  for (let attempt = 0; !taken && attempt < 100; attempt++) {
    const holder = holder_of(lock_path);
    if (holder && lock_is_live(holder)) throw refuse(holder);
    try {
      mkdirSync(guard_path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - (statSync(guard_path, { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > TAKEOVER_GUARD_MAX_AGE_MS) rmSync(guard_path, { recursive: true, force: true });
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      continue;
    }
    try {
      // Read again under the guard: another run may have replaced the stale lock since the read above.
      const again = holder_of(lock_path);
      if (again && lock_is_live(again)) throw refuse(again);
      rmSync(lock_path, { force: true });
      taken = try_link();
    } finally {
      rmSync(guard_path, { recursive: true, force: true });
    }
  }
  if (!taken) throw new Error(`could not take the lock ${lock_path}`);
  return () => {
    // Only a lock that still names this process, so a release after a takeover leaves the new holder's lock alone.
    if (holder_of(lock_path)?.text === mine) rmSync(lock_path, { force: true });
  };
}

// A dir the run may not use as its work dir: a real home, anything above it, or anything in a Thunderbird profile root.
export function refuse_dangerous_dir(dir, real_home) {
  const resolved = real_path(dir);
  for (const home of homes_of(real_home)) {
    if (is_inside(home, resolved)) throw new Error(`E2E_DIR ${dir} is the home dir or holds it`);
    if (is_inside(resolved, join(home, ".thunderbird"))) throw new Error(`E2E_DIR ${dir} is inside ~/.thunderbird`);
  }
}

// Throws unless each path resolves, through every symlink, to a place inside the run dir that is not a real home or in ~/.thunderbird.
// start_app calls it before it removes or writes anything, so a symlink that points at the owner's home is refused first.
export function assert_start_paths({ run_dir, paths, real_home }) {
  for (const path of paths) {
    if (!is_inside(path, run_dir)) throw new Error(`refusing to start an app: ${path} resolves to ${real_path(path)}, outside the run dir ${run_dir}`);
    for (const home of homes_of(real_home)) {
      if (real_path(path) === real_path(home) || is_inside(path, join(home, ".thunderbird"))) throw new Error(`refusing to start an app: ${path} resolves into the real home ${home}`);
    }
  }
}

// The work dir of this run. E2E_DIR names one (kept as the owner's own dir, and refused while a live run holds it). Otherwise a fresh mkdtemp dir, which cleanup removes after a success.
export function open_run_dir({ env = process.env, tmp_root = tmpdir(), real_home } = {}) {
  const named = env.E2E_DIR !== undefined && env.E2E_DIR !== "";
  const dir = named ? resolve(env.E2E_DIR) : mkdtempSync(join(tmp_root, "desertbird-e2e-"));
  if (named) {
    refuse_dangerous_dir(dir, real_home);
    mkdirSync(dir, { recursive: true });
  }
  let release;
  try {
    release = acquire_lock(dir);
  } catch (error) {
    if (!named) rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const keep = env.E2E_KEEP === "1";
  let closed = false;
  return {
    dir,
    named,
    // Releases the lock and, after a success of a dir this run made, removes it. A failure or E2E_KEEP=1 keeps the dir for its logs.
    // Returns what it did, for the line the run prints.
    close: (ok) => {
      if (closed) return "closed";
      closed = true;
      release();
      if (named) return "kept (E2E_DIR is yours)";
      if (ok && !keep) {
        rmSync(dir, { recursive: true, force: true });
        return "removed";
      }
      return "kept";
    },
  };
}

// Throws unless the app about to start can reach nothing of the owner's: its profile, HOME and runtime dir are in the run dir, HOME is not a real home, and its Wayland socket is the private one.
// `env` is the environment the app is spawned with. The session builds it explicitly and never copies the parent's, and this checks that it stayed so,
// because a WAYLAND_DISPLAY from the parent would point grim and wtype at the owner's session. Every path is resolved through its symlinks first.
export function assert_app_isolated({ run_dir, profile_dir, env, real_home }) {
  const homes = homes_of(real_home);
  const problems = [];
  if (!is_inside(profile_dir, run_dir)) problems.push(`profile dir ${profile_dir} is not under the run dir ${run_dir}`);
  for (const home of homes) if (is_inside(profile_dir, join(home, ".thunderbird"))) problems.push(`profile dir ${profile_dir} is inside ~/.thunderbird`);
  if (!env.HOME) problems.push("HOME is not set in the app environment");
  else {
    for (const home of homes) {
      if (real_path(env.HOME) === real_path(home)) problems.push("HOME is the real home");
      if (is_inside(env.HOME, join(home, ".thunderbird"))) problems.push(`HOME ${env.HOME} is inside ~/.thunderbird`);
    }
    if (!is_inside(env.HOME, run_dir)) problems.push(`HOME ${env.HOME} is not under the run dir ${run_dir}`);
  }
  if (!env.XDG_RUNTIME_DIR || !is_inside(env.XDG_RUNTIME_DIR, run_dir)) problems.push(`XDG_RUNTIME_DIR ${env.XDG_RUNTIME_DIR} is not under the run dir ${run_dir}`);
  else {
    const socket = env.WAYLAND_DISPLAY && !isAbsolute(env.WAYLAND_DISPLAY) && !env.WAYLAND_DISPLAY.includes(sep) ? join(env.XDG_RUNTIME_DIR, env.WAYLAND_DISPLAY) : null;
    const is_private_socket = socket !== null && is_inside(socket, run_dir) && statSync(socket, { throwIfNoEntry: false })?.isSocket();
    if (!is_private_socket) problems.push(`WAYLAND_DISPLAY ${env.WAYLAND_DISPLAY} is not a socket in the run dir's runtime dir, so grim and wtype could reach another session`);
  }
  if (problems.length) throw new Error(`refusing to start an app: ${[...new Set(problems)].join("; ")}`);
}
