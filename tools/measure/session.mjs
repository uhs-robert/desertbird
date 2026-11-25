// An invisible Wayland session for the probe: headless labwc, with wtype as the keyboard. Nothing shows on the user's screen.
// Every process starts in its own process group and stops by that group, never by name, because the user may run the same programs.
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The session has no input device of its own, and every wlrctl click and wtype run adds and drops a virtual one. A seat that loses its keyboard makes the app bind a new wl_keyboard, and that one sometimes gets no enter event, so every key is lost until the next click (issues #139 and #178). One wtype that sleeps for the whole session keeps a keyboard on the seat. It outlasts any run (the longest deadline is 7200 s).
const HOLDER_SLEEP_MS = 86_400_000;
// Time for wtype to make its virtual keyboard before the session hands out, or the first key could still race the holder.
const HOLDER_SETTLE_MS = 300;

export async function start_session(work_dir) {
  const runtime_dir = join(work_dir, "runtime");
  mkdirSync(runtime_dir, { recursive: true, mode: 0o700 });
  const labwc_config = join(work_dir, "labwc");
  mkdirSync(labwc_config, { recursive: true });
  writeFileSync(join(labwc_config, "rc.xml"), "<labwc_config/>\n");
  const groups = [];
  const base_env = { PATH: process.env.PATH, XDG_RUNTIME_DIR: runtime_dir, HOME: join(work_dir, "home"), DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent", LANG: "C.UTF-8" };
  mkdirSync(base_env.HOME, { recursive: true });

  function start_child(argv, env, log_name) {
    const log = join(work_dir, log_name);
    const child = spawn("sh", ["-c", `exec "$@" >>"${log}" 2>&1`, "sh", ...argv], { env, detached: true, stdio: "ignore" });
    groups.push(child.pid);
    child.unref();
    return child;
  }

  // A failed start must not leave the compositor running.
  const stop_on_failure = (error) => { stop(); throw error; };
  start_child(["labwc", "-C", labwc_config], { ...base_env, WLR_BACKENDS: "headless", WLR_HEADLESS_OUTPUTS: "1", WLR_LIBINPUT_NO_DEVICES: "1", LABWC_UPDATE_ACTIVATION_ENV: "0" }, "labwc.log");
  const socket = () => readdirSync(runtime_dir).find((entry) => /^wayland-\d+$/.test(entry));
  for (let waited = 0; !socket(); waited += 100) {
    if (waited > 10000) stop_on_failure(new Error("labwc made no socket"));
    await sleep(100);
  }
  const env = { ...base_env, WAYLAND_DISPLAY: socket(), MOZ_ENABLE_WAYLAND: "1" };

  let holder_ended = false;
  start_child(["wtype", "-s", String(HOLDER_SLEEP_MS)], env, "keyboard_holder.log").on("exit", () => { holder_ended = true; });
  await sleep(HOLDER_SETTLE_MS);
  if (holder_ended) stop_on_failure(new Error("the keyboard holder (wtype -s) ended at start, see keyboard_holder.log"));

  const run = (command, args) => new Promise((resolve, reject) => execFile(command, args, { env, timeout: 15000 }, (error, stdout, stderr) => (error ? reject(new Error(`${command} ${args.join(" ")}: ${stderr || error.message}`)) : resolve(stdout))));

  function stop() {
    for (const group of groups) {
      try { process.kill(-group, "SIGTERM"); } catch {}
    }
    setTimeout(() => {
      for (const group of groups) {
        try { process.kill(-group, "SIGKILL"); } catch {}
      }
    }, 3000).unref();
  }

  return {
    env,
    home: base_env.HOME,
    // wtype-style args: "-k Escape", "-M shift x -m shift", or text.
    press: (args) => run("wtype", args),
    shot: (path) => run("grim", [path]),
    spawn_app: (argv, log_name) => start_child(argv, env, log_name),
    stop,
    groups,
  };
}
