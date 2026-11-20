import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve, isAbsolute, sep } from "node:path";

export type Roots = { state_home: string; cache_home: string };

export function default_roots(env: NodeJS.ProcessEnv, home: string): Roots {
  return {
    state_home: env.XDG_STATE_HOME || join(home, ".local", "state"),
    cache_home: env.XDG_CACHE_HOME || join(home, ".cache"),
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

// window_dir is the one folder close deletes. It holds the profile, the app's private home, the stamped xpi and the log.
export type WindowPaths = { worktree: string; key: string; lock_file: string; state_file: string; cache_root: string; window_dir: string; profile_dir: string; home_dir: string; xpi_file: string; log_file: string };

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
    xpi_file: join(window_dir, "stamped.xpi"),
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

const is_inside_or_equal = (root: string, path: string) => resolve(root) === resolve(path) || is_strictly_inside(root, path);

// Why these paths must not be used, or null when they are safe. Checked before anything is created, copied or deleted. A cache root that resolves into a real profile folder (through a symlink or an odd XDG_CACHE_HOME) is refused as well as a literal match.
export function unsafe_reason(paths: WindowPaths, home: string): string | null {
  const real_roots = real_profile_roots(home);
  const named = [paths.cache_root, paths.window_dir, paths.profile_dir, paths.home_dir, paths.xpi_file, paths.log_file, paths.state_file, paths.lock_file];
  for (const path of named) {
    const resolved = existsSync(path) ? realpathSync(path) : resolve(path);
    for (const root of real_roots) if (is_inside_or_equal(root, resolved) || is_inside_or_equal(root, path)) return `${path} is inside ${root}, a real profile folder`;
  }
  if (!is_strictly_inside(paths.cache_root, paths.window_dir) || basename(paths.window_dir) !== paths.key) return `${paths.window_dir} is not the folder derived for this worktree under ${paths.cache_root}`;
  if (paths.profile_dir !== join(paths.window_dir, "profile")) return `${paths.profile_dir} is not the profile folder of ${paths.window_dir}`;
  return null;
}

// A window folder that is a symlink, or sits behind one, would send a delete somewhere else. The folder is safe to delete only when its real path is its own path below the real cache root.
export function is_unredirected(paths: WindowPaths): boolean {
  if (!existsSync(paths.window_dir)) return true;
  if (!existsSync(paths.cache_root)) return false;
  return realpathSync(paths.window_dir) === join(realpathSync(paths.cache_root), paths.key);
}
