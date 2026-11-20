import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from "node:path";

export type Roots = { state_home: string; cache_home: string };

export function default_roots(env: NodeJS.ProcessEnv, home: string): Roots {
  return {
    // An empty value is kept, not replaced by the default, so `roots_problem` refuses it. The XDG spec would ignore it, but a mistyped export must not quietly move where this tool writes.
    state_home: env.XDG_STATE_HOME ?? join(home, ".local", "state"),
    cache_home: env.XDG_CACHE_HOME ?? join(home, ".cache"),
  };
}

// The same worktree reached through a symlink must map to one window, so the key is taken from the real path.
export function canonical_worktree(worktree: string): string {
  return realpathSync(resolve(worktree));
}

// The name that keys one worktree's state file and window folder. The hash of the full path keeps two worktrees with the same folder name apart.
export function worktree_key(worktree: string): string {
  const path = resolve(worktree);
  const readable = basename(path).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  return `${readable}-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`;
}

// window_dir is the one folder close deletes. It holds the profile, the app's private home and the log.
// stage_dir holds the build of the next window (the stamped xpi) beside window_dir, so a build runs before the old window is closed and a failed build leaves that window alone.
export type WindowPaths = { worktree: string; key: string; lock_file: string; state_file: string; cache_root: string; window_dir: string; profile_dir: string; home_dir: string; stage_dir: string; staged_xpi: string; log_file: string };

export function window_paths(worktree: string, roots: Roots): WindowPaths {
  const key = worktree_key(worktree);
  const cache_root = join(roots.cache_home, "desertbird", "owner-test");
  const window_dir = join(cache_root, key);
  return {
    worktree: resolve(worktree),
    key,
    lock_file: join(roots.state_home, "desertbird", "owner-test", `${key}.lock`),
    state_file: join(roots.state_home, "desertbird", "owner-test", `${key}.json`),
    cache_root,
    window_dir,
    profile_dir: join(window_dir, "profile"),
    home_dir: join(window_dir, "home"),
    stage_dir: join(cache_root, `${key}.stage`),
    staged_xpi: join(cache_root, `${key}.stage`, "stamped.xpi"),
    log_file: join(window_dir, "app.log"),
  };
}

// True only for a path strictly below `root`. The root itself and any `..` escape fail.
export function is_strictly_inside(root: string, path: string): boolean {
  const from_root = relative(resolve(root), resolve(path));
  return from_root !== "" && !isAbsolute(from_root) && from_root.split(sep)[0] !== "..";
}

// Where the apps keep their real profiles. Betterbird reads ~/.thunderbird too.
export function real_profile_roots(home: string): string[] {
  return [".thunderbird", ".betterbird", join(".mozilla", "thunderbird"), join(".config", "thunderbird")].map((name) => join(home, name));
}

// The homes whose real profiles must stay out of reach: the HOME of the environment and the one the account database names. `HOME=/tmp/x` must not hide the real one.
export function homes_to_guard(env_home: string): string[] {
  let account_home = "";
  try {
    account_home = userInfo().homedir;
  } catch { /* no account entry: the environment's HOME is all there is */ }
  return [...new Set([env_home, account_home].filter((home) => isAbsolute(home)))];
}

// A path with its symlinks resolved as far as it exists: the nearest existing ancestor through realpath, the rest joined on. A cache folder linked into a real profile folder shows up before the folders below it exist.
export function resolve_real(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing) && existing !== dirname(existing)) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...rest);
}

const is_inside_or_equal = (root: string, path: string) => resolve(root) === resolve(path) || is_strictly_inside(root, path);

// Why this tool must not run with these roots, or null when they are safe. Checked before anything is created, copied, written or deleted. It refuses a relative or empty root, any path that resolves into a real profile folder (literally or through a symlink), and a window folder that is a symlink or sits behind one, because a delete would follow it.
export function refusal_reason(paths: WindowPaths, homes: string[]): string | null {
  const named = [paths.cache_root, paths.window_dir, paths.profile_dir, paths.home_dir, paths.stage_dir, paths.staged_xpi, paths.log_file, paths.state_file, paths.lock_file];
  for (const path of named) if (!isAbsolute(path)) return `${path} is not an absolute path. Set HOME, XDG_CACHE_HOME and XDG_STATE_HOME to absolute folders.`;
  const real_roots = homes.flatMap(real_profile_roots);
  for (const path of named) {
    const resolved = resolve_real(path);
    for (const root of real_roots) if (is_inside_or_equal(root, resolved) || is_inside_or_equal(root, path) || is_inside_or_equal(resolve_real(root), resolved)) return `${path} is inside ${root}, a real profile folder`;
  }
  if (!is_strictly_inside(paths.cache_root, paths.window_dir) || basename(paths.window_dir) !== paths.key) return `${paths.window_dir} is not the folder derived for this worktree under ${paths.cache_root}`;
  if (paths.profile_dir !== join(paths.window_dir, "profile")) return `${paths.profile_dir} is not the profile folder of ${paths.window_dir}`;
  if (!is_plain_stage(paths)) return `${paths.stage_dir} is a symlink or sits behind one, so it is not the plain folder derived under ${paths.cache_root}`;
  if (!is_unredirected(paths)) return `${paths.window_dir} is a symlink or sits behind one, so it is not the plain folder derived under ${paths.cache_root}`;
  return null;
}

// The stage folder is deleted by close, so it gets the same test: its real path must be its own path below the real cache root.
export function is_plain_stage(paths: WindowPaths): boolean {
  if (!existsSync(paths.stage_dir)) return true;
  if (!existsSync(paths.cache_root)) return false;
  return realpathSync(paths.stage_dir) === join(realpathSync(paths.cache_root), basename(paths.stage_dir));
}

// A window folder that is a symlink, or sits behind one, would send a delete somewhere else. The folder is safe only when its real path is its own path below the real cache root.
export function is_unredirected(paths: WindowPaths): boolean {
  if (!existsSync(paths.window_dir)) return true;
  if (!existsSync(paths.cache_root)) return false;
  return realpathSync(paths.window_dir) === join(realpathSync(paths.cache_root), paths.key);
}
