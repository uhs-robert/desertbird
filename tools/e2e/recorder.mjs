// wf-recorder on the headless output of a session, for the demo piece. It runs in its own process group so one signal reaches the encoder it forks, and `adopt_group` hands that group to the session, whose stop (an interrupt, a deadline) kills it with the app.
// A recorder that cannot start or ends early fails the piece with the tail of its own log, since a film with a hole in it is worse than no film.
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Time the recorder gets to fail at start (no binary, no output, a bad codec) before the piece goes on.
const START_GRACE_MS = 1500;
const STOP_GRACE_MS = 20000;

const log_tail = (log_file) => (existsSync(log_file) ? readFileSync(log_file, "utf8").trim().split("\n").slice(-8).join("\n") : "");

export async function start_recording({ command = "wf-recorder", args, env, log_file, adopt_group = () => {}, start_grace_ms = START_GRACE_MS, stop_grace_ms = STOP_GRACE_MS }) {
  const log_fd = openSync(log_file, "a");
  let ended = null;
  let spawn_error = null;
  const child = spawn(command, args, { env, detached: true, stdio: ["ignore", log_fd, log_fd] });
  closeSync(log_fd);
  const exited = new Promise((resolve) => {
    child.on("error", (error) => { spawn_error = error; ended = { code: null, signal: null }; resolve(ended); });
    child.on("exit", (code, signal) => { ended = { code, signal }; resolve(ended); });
  });
  if (child.pid !== undefined) adopt_group(child.pid);
  const started_at = Date.now();
  let stop_requested = false;
  const describe = () => (spawn_error ? `${command} did not start: ${spawn_error.message}` : `${command} ${ended ? `ended with ${ended.signal ?? `code ${ended.code}`}` : "did not end after the stop signal"}`) + (log_tail(log_file) ? `. Its log ${log_file}:\n${log_tail(log_file)}` : "");

  await Promise.race([sleep(start_grace_ms), exited]);
  if (ended) throw new Error(`the recording failed at start: ${describe()}`);

  return {
    started_at,
    // Throws once the recorder has ended on its own.
    assert_alive: () => { if (ended && !stop_requested) throw new Error(`the recording ended during the run: ${describe()}`); },
    // SIGINT makes wf-recorder finish the file. A clean end is code 0, or the SIGINT it was sent.
    stop: async () => {
      // An exit before the stop, even a clean one, left the film short.
      if (ended) { stop_requested = true; throw new Error(`the recording ended before the stop: ${describe()}`); }
      stop_requested = true;
      try { process.kill(-child.pid, "SIGINT"); } catch {}
      let kill_timer;
      const killer = new Promise((resolve) => { kill_timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve("killed"); }, stop_grace_ms); });
      const result = await Promise.race([exited, killer]);
      clearTimeout(kill_timer);
      if (result === "killed" || (result.code !== 0 && result.signal !== "SIGINT")) throw new Error(`the recording did not end cleanly: ${describe()}`);
    },
  };
}
