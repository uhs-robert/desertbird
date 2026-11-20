import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { default_roots, homes_to_guard, is_strictly_inside, is_unredirected, real_profile_roots, refusal_reason, window_paths, worktree_key } from "../../tools/owner_test/paths.ts";
import { launch_argv, launch_env } from "../../tools/owner_test/launch.ts";

const HOME = "/home/someone";
const roots = default_roots({}, HOME);

test("roots follow XDG and fall back to the home folder", () => {
  assert.deepEqual(roots, { state_home: `${HOME}/.local/state`, cache_home: `${HOME}/.cache` });
  assert.deepEqual(default_roots({ XDG_STATE_HOME: "/s", XDG_CACHE_HOME: "/c" }, HOME), { state_home: "/s", cache_home: "/c" });
});

test("two worktrees with the same folder name get different keys, one worktree always the same key", () => {
  assert.notEqual(worktree_key("/a/work"), worktree_key("/b/work"));
  assert.equal(worktree_key("/a/work"), worktree_key("/a/work"));
});

test("every path of a window lies under the cache root, and only the window folder is the delete target", () => {
  const paths = window_paths("/a/work", roots);
  assert.equal(paths.cache_root, `${HOME}/.cache/desertbird/owner-test`);
  for (const path of [paths.window_dir, paths.profile_dir, paths.home_dir, paths.stage_dir, paths.staged_xpi, paths.log_file]) assert.ok(is_strictly_inside(paths.cache_root, path), path);
  assert.equal(paths.window_dir, join(paths.cache_root, paths.key));
  assert.equal(refusal_reason(paths, [HOME]), null);
});

test("two keys never share a profile folder", () => {
  assert.notEqual(window_paths("/a/work", roots).profile_dir, window_paths("/b/work", roots).profile_dir);
  assert.notEqual(window_paths("/a/work", roots).window_dir, window_paths("/b/work", roots).window_dir);
});

test("guard: no computed path, argument or environment value names a real profile folder", () => {
  const real_roots = real_profile_roots(HOME);
  assert.ok(real_roots.includes(`${HOME}/.thunderbird`));
  const configs = [{}, { XDG_CACHE_HOME: "/var/cache/me", XDG_STATE_HOME: "/var/state/me" }];
  for (const env of configs) {
    const paths = window_paths("/home/someone/Development/proj", default_roots(env, HOME));
    const argv = launch_argv("/usr/bin/betterbird", paths.profile_dir);
    const app_env = launch_env({ ...env, HOME, PATH: "/bin", WAYLAND_DISPLAY: "w", XDG_CONFIG_HOME: `${HOME}/.thunderbird` }, paths.home_dir);
    const named = [...Object.values(paths).filter((value) => value.startsWith("/")), ...argv.filter((word) => word.startsWith("/")), ...Object.values(app_env).filter((value): value is string => typeof value === "string" && value.startsWith("/"))];
    for (const path of named) for (const root of real_roots) assert.ok(!is_strictly_inside(root, path) && path !== root, `${path} names ${root}`);
    assert.equal(argv.includes(`${HOME}/.thunderbird`), false);
    assert.equal(app_env.HOME, paths.home_dir);
  }
});

test("refuses a cache or state root inside a real profile folder", () => {
  for (const bad of [`${HOME}/.thunderbird`, `${HOME}/.thunderbird/profile`, `${HOME}/.betterbird/x`, `${HOME}/.mozilla/thunderbird`, `${HOME}/.config/thunderbird/y`]) {
    assert.match(refusal_reason(window_paths("/a/work", { cache_home: bad, state_home: `${HOME}/.local/state` }), [HOME]) ?? "", /real profile folder/, bad);
    assert.match(refusal_reason(window_paths("/a/work", { cache_home: `${HOME}/.cache`, state_home: bad }), [HOME]) ?? "", /real profile folder/, bad);
  }
});

test("refuses a cache root that is a symlink into a real profile folder", () => {
  const home = mkdtempSync(join(tmpdir(), "owner-test-home-"));
  try {
    mkdirSync(join(home, ".thunderbird", "z.default"), { recursive: true });
    mkdirSync(join(home, "cache"), { recursive: true });
    mkdirSync(join(home, "cache", "desertbird"), { recursive: true });
    symlinkSync(join(home, ".thunderbird"), join(home, "cache", "desertbird", "owner-test"));
    const paths = window_paths("/a/work", { cache_home: join(home, "cache"), state_home: join(home, "state") });
    assert.match(refusal_reason(paths, [home]) ?? "", /real profile folder/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a window folder behind a symlink is not unredirected, a plain one is", () => {
  const base = mkdtempSync(join(tmpdir(), "owner-test-redirect-"));
  try {
    const paths = window_paths("/a/work", { cache_home: join(base, "cache"), state_home: join(base, "state") });
    assert.equal(is_unredirected(paths), true, "absent folder");
    mkdirSync(paths.window_dir, { recursive: true });
    assert.equal(is_unredirected(paths), true, "plain folder");
    rmSync(paths.window_dir, { recursive: true });
    mkdirSync(join(base, "elsewhere"));
    symlinkSync(join(base, "elsewhere"), paths.window_dir);
    assert.equal(is_unredirected(paths), false, "symlinked folder");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("is_strictly_inside refuses the root and an escape", () => {
  assert.equal(is_strictly_inside("/r", "/r"), false);
  assert.equal(is_strictly_inside("/r", "/r/../x"), false);
  assert.equal(is_strictly_inside("/r", "/r/a/b"), true);
  assert.equal(is_strictly_inside("/r", "/rx/a"), false);
});

test("refuses an empty or relative root, and a relative HOME", () => {
  for (const roots of [default_roots({ XDG_CACHE_HOME: "" }, HOME), default_roots({ XDG_CACHE_HOME: "rel/cache" }, HOME), default_roots({ XDG_STATE_HOME: "" }, HOME), default_roots({}, "")]) {
    assert.match(refusal_reason(window_paths("/a/work", roots), [HOME]) ?? "", /not an absolute path/);
  }
  assert.deepEqual(homes_to_guard(""), homes_to_guard("relative"), "a bad HOME adds no guarded home of its own");
});

test("a mocked HOME does not hide the real home: both are guarded", () => {
  const homes = homes_to_guard("/tmp/x");
  assert.ok(homes.includes("/tmp/x"));
  assert.ok(homes.length >= 1);
  const real = homes.find((home) => home !== "/tmp/x");
  if (real === undefined) return;
  const paths = window_paths("/a/work", { cache_home: join(real, ".thunderbird"), state_home: "/tmp/x/state" });
  assert.match(refusal_reason(paths, homes) ?? "", /real profile folder/);
  assert.equal(refusal_reason(paths, ["/tmp/x"]), null, "the check alone against the mocked HOME would pass: that is the gap");
});

test("a cache folder symlinked into a real profile folder is refused before the folders below it exist", () => {
  const home = mkdtempSync(join(tmpdir(), "owner-test-home-"));
  try {
    mkdirSync(join(home, ".thunderbird"), { recursive: true });
    symlinkSync(join(home, ".thunderbird"), join(home, "cache"));
    const paths = window_paths("/a/work", { cache_home: join(home, "cache"), state_home: join(home, "state") });
    assert.match(refusal_reason(paths, [home]) ?? "", /real profile folder/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a window folder that is a symlink is refused by refusal_reason, so open cannot write through it", () => {
  const base = mkdtempSync(join(tmpdir(), "owner-test-link-"));
  try {
    const paths = window_paths("/a/work", { cache_home: join(base, "cache"), state_home: join(base, "state") });
    mkdirSync(paths.cache_root, { recursive: true });
    mkdirSync(join(base, "elsewhere"));
    symlinkSync(join(base, "elsewhere"), paths.window_dir);
    assert.match(refusal_reason(paths, ["/nonexistent-home"]) ?? "", /symlink/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
