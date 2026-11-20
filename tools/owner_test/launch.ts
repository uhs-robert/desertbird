// What touches the machine: finding the app binary, building and stamping the xpi, the profile, starting the app and the real system calls close uses.

import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CloseDeps } from "./close.ts";
import type { WindowPaths } from "./paths.ts";
import { read_start_ticks } from "./process_guard.ts";
import { Refusal } from "./refusal.ts";

export const APPS = ["betterbird", "thunderbird"] as const;
export type App = (typeof APPS)[number];

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// The two places the other tools look for a binary: Betterbird from the system, Thunderbird from tools/measure/fetch_thunderbird.sh.
export function app_binary(app: App, env: NodeJS.ProcessEnv, override: string | undefined): string {
  if (override !== undefined) return override;
  if (app === "betterbird") return "/usr/bin/betterbird";
  return join(env.MEASURE_DIR ?? "/tmp/desertbird-measure", "thunderbird-153.7.0esr", "thunderbird", "thunderbird");
}

// An explicit profile and no remote: the app never picks a profile from profiles.ini and never hands the window to a running instance.
export function launch_argv(binary: string, profile_dir: string): string[] {
  return [binary, "-profile", profile_dir, "-no-remote"];
}

// The display and locale variables only. HOME is the window's own folder, so an app that wants ~/.thunderbird (Betterbird does) finds an empty one, and nothing else of the real environment (XDG dirs, DBus) reaches it.
export function launch_env(env: NodeJS.ProcessEnv, home_dir: string): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = { HOME: home_dir };
  for (const name of ["PATH", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DISPLAY", "MOZ_ENABLE_WAYLAND", "XDG_SESSION_TYPE", "LANG", "LC_ALL"]) if (env[name] !== undefined) kept[name] = env[name];
  return kept;
}

export function check_display(env: NodeJS.ProcessEnv): void {
  if (!env.WAYLAND_DISPLAY) throw new Refusal("WAYLAND_DISPLAY is not set, so there is no desktop to open a window on.");
}

// Names the build in the window: branch, short commit, a dirty mark and the time. The time tells two builds of one commit apart.
export function stamp_label(branch: string, commit: string, dirty: boolean, now_iso: string): string {
  return `${branch}@${commit}${dirty ? "+dirty" : ""} ${now_iso}`;
}

export function stamp_manifest(manifest: Record<string, unknown>, label: string): Record<string, unknown> {
  return { ...manifest, version_name: label };
}

function git(worktree: string, ...args: string[]): string {
  return execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
}

export function check_worktree(worktree: string): void {
  if (!existsSync(join(worktree, "src", "manifest.json")) || !existsSync(join(worktree, "package.json"))) throw new Refusal(`${worktree} is not a DesertBird checkout`);
}

// Builds the worktree, then writes a copy of its xpi whose manifest carries the stamp. The worktree's own dist/ stays as built.
export function build_stamped_xpi(worktree: string, xpi_file: string, stage_dir: string): string {
  try {
    execFileSync("npm", ["run", "--silent", "build"], { cwd: worktree, stdio: "inherit" });
  } catch {
    throw new Refusal("the build failed");
  }
  const dirty = git(worktree, "status", "--porcelain", "--untracked-files=no") !== "";
  const label = stamp_label(git(worktree, "rev-parse", "--abbrev-ref", "HEAD"), git(worktree, "rev-parse", "--short", "HEAD"), dirty, new Date().toISOString());
  const built_xpi = join(worktree, "dist", "desertbird.xpi");
  const manifest = JSON.parse(execFileSync("unzip", ["-p", built_xpi, "manifest.json"], { encoding: "utf8" }));
  rmSync(stage_dir, { recursive: true, force: true });
  mkdirSync(stage_dir, { recursive: true });
  writeFileSync(join(stage_dir, "manifest.json"), JSON.stringify(stamp_manifest(manifest, label), null, 2));
  rmSync(xpi_file, { force: true });
  execFileSync("cp", [built_xpi, xpi_file]);
  // zip replaces the one entry and leaves the rest.
  execFileSync("zip", ["-q", "-X", xpi_file, "manifest.json"], { cwd: stage_dir });
  rmSync(stage_dir, { recursive: true, force: true });
  return label;
}

// Builds the profile with the fixture mail of the e2e tests (kind "owner") and installs the xpi. The caller has already checked the paths. build_profile deletes its folder first, so it must only ever get paths.profile_dir.
export async function build_owner_profile(paths: WindowPaths, xpi_file: string): Promise<string> {
  mkdirSync(paths.home_dir, { recursive: true, mode: 0o700 });
  const { build_profile, install_xpi } = await import(join(import.meta.dirname, "..", "e2e", "profile.mjs"));
  build_profile(paths.profile_dir, { kind: "owner" });
  return install_xpi(paths.profile_dir, xpi_file) as string;
}

// extensions.json is the app's own record of what it loaded. The add-on must be there and active, and its update date must not be older than the xpi file in the profile: a record from before a reload shows an older date. Thunderbird sets the date to the file's modification time, Betterbird to the load time, so the bound is the file's mtime less 1 ms for the rounding. This proves the app read the xpi file written for this launch, which holds the stamp.
export function addon_loaded_since(extensions_json: string, addon_id: string, since_ms: number): boolean {
  try {
    const addons = (JSON.parse(extensions_json) as { addons?: { id: string; active: boolean; updateDate?: number }[] }).addons ?? [];
    return addons.some((addon) => addon.id === addon_id && addon.active === true && (addon.updateDate ?? 0) >= since_ms);
  } catch {
    return false;
  }
}

export function installed_stamp(profile_dir: string, addon_id: string): string | null {
  try {
    const manifest = JSON.parse(execFileSync("unzip", ["-p", join(profile_dir, "extensions", `${addon_id}.xpi`), "manifest.json"], { encoding: "utf8" }));
    return typeof manifest.version_name === "string" ? manifest.version_name : null;
  } catch {
    return null;
  }
}

export function is_addon_loaded(profile_dir: string, addon_id: string): boolean {
  const file = join(profile_dir, "extensions.json");
  const xpi_mtime_ms = Math.floor(statSync(join(profile_dir, "extensions", `${addon_id}.xpi`)).mtimeMs);
  return existsSync(file) && addon_loaded_since(readFileSync(file, "utf8"), addon_id, xpi_mtime_ms - 1);
}

// A plain detached spawn. A later change adds a systemd unit in front of it and returns its name.
export function start_app(argv: string[], env: NodeJS.ProcessEnv, cwd: string, log_file: string): { unit: string | null; pid: number } {
  const log_fd = openSync(log_file, "a");
  const child = spawn(argv[0] as string, argv.slice(1), { cwd, env, detached: true, stdio: ["ignore", log_fd, log_fd] });
  child.on("error", () => {});
  child.unref();
  closeSync(log_fd);
  return { unit: null, pid: child.pid ?? 0 };
}

// The main process of an app run with this exact profile folder: its command line holds `-profile <dir>` and no `-contentproc` (child processes carry that).
export function find_app_by_profile(profile: string, proc_root = "/proc"): { pid: number; start_ticks: number } | null {
  for (const entry of readdirSync(proc_root)) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const words = readFileSync(`${proc_root}/${entry}/cmdline`, "utf8").split("\0");
      const at = words.indexOf("-profile");
      if (at < 0 || words[at + 1] !== profile || words.includes("-contentproc")) continue;
      const start_ticks = read_start_ticks(Number(entry), proc_root);
      if (start_ticks !== null) return { pid: Number(entry), start_ticks };
    } catch { /* the process ended */ }
  }
  return null;
}

export function real_close_deps(): CloseDeps {
  return {
    read_start_ticks: (pid) => read_start_ticks(pid),
    signal: (pid, signal) => {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    },
    sleep,
    find_app_by_profile: (profile) => find_app_by_profile(profile),
    // No unit exists yet, so a state that names one is not ours to trust: not confirmed.
    stop_unit: () => false,
    remove_window_dir: (window_dir) => rmSync(window_dir, { recursive: true, force: true }),
  };
}
