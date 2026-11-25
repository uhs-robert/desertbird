// Flake-rate tracking for the e2e run. `npm run e2e:flakes -- <n> [run.mjs args]` does n full runs, each writing its merged timings file
// into .logs/e2e-flakes-<stamp>/, folds those files into one JSON line, appends it to the history file and raises the alert.
//   node tools/e2e/flakes.mjs run <n> [thunderbird|betterbird]...
//   node tools/e2e/flakes.mjs fold <commit> <timings file>...   (a missing, unreadable or serial file is a run error)
// A check is a flake when it fails in some runs of the batch and passes in others. A check that fails in every run is broken, and the alert says so.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const FAIL_ALERT_RUNS = 2;
export const RUN_ERROR_ALERT_RUNS = 3;
// Three workers is the count the flake batches were sized for. The default of `npm run e2e` stays its own.
export const DEFAULT_SHARDS = "3";

const repo_dir = join(import.meta.dirname, "..", "..");

export const history_path = () => process.env.E2E_FLAKES_HISTORY || join(homedir(), ".local", "state", "desertbird", "e2e-flakes.jsonl");

// A coordinator failure is "<app>/<kind>/<section>: <what happened>" for a piece that died, timed out or failed with no failed check. It counts as one case per piece, so a piece that dies in every run alerts. Text with no piece id is one case of the run.
const PIECE_FAILURE_CASE = "(piece failure)";
function failure_key(failure) {
  const match = /^([\w.-]+\/[\w.-]+\/[\w.-]+): /.exec(failure);
  return match ? `${match[1]}\n${PIECE_FAILURE_CASE}` : `(run)\n${failure}`;
}

// A run error is a run with no usable file: setup failed, the run died before it wrote one, or it ran serially and so has no merged `exit_code`.
// `reports` has one entry per run, undefined for a run error. A batch with fewer than half its runs completed is too thin to read.
export function fold_batch(reports, { commit, at }) {
  const completed = reports.filter(Boolean);
  const cases = new Map();
  for (const report of completed) {
    const failed_here = new Set([...(report.failed_checks ?? []).map((failed) => `${failed.piece}\n${failed.name}`), ...(report.failures ?? []).map(failure_key)]);
    for (const key of failed_here) {
      const [piece, name] = key.split("\n");
      if (!cases.has(key)) cases.set(key, { piece, case: name, fail: 0 });
      cases.get(key).fail += 1;
    }
  }
  const is_clean = (report) => report.exit_code === 0 && (report.failures ?? []).length === 0 && (report.failed_checks ?? []).length === 0;
  const failing = [...cases.values()].sort((left, right) => right.fail - left.fail || left.case.localeCompare(right.case));
  return {
    at,
    commit,
    runs: reports.length,
    clean_runs: completed.filter(is_clean).length,
    run_errors: reports.length - completed.length,
    too_thin: completed.length * 2 < reports.length,
    cases: failing,
  };
}

// Why the batch needs the owner, or an empty list.
export function alert_reasons(line) {
  const reasons = [];
  for (const failing of line.cases) {
    if (failing.fail < FAIL_ALERT_RUNS) continue;
    // A run error never ran the check, so it is not a run the check could pass.
    const ran = line.runs - line.run_errors;
    const verdict = failing.fail === ran ? "failed in every run that completed (broken, not flaky)" : `failed in ${failing.fail} of ${line.runs} runs`;
    reasons.push(`${failing.piece} "${failing.case}" ${verdict}`);
  }
  if (line.run_errors >= RUN_ERROR_ALERT_RUNS) reasons.push(`${line.run_errors} of ${line.runs} runs errored`);
  return reasons;
}

export function summary_lines(line) {
  const lines = [`e2e-flakes ${line.commit}: ${line.clean_runs} of ${line.runs} runs clean, ${line.run_errors} run errors`];
  if (line.too_thin) lines.push("batch too thin to read: fewer than half the runs completed");
  for (const failing of line.cases) lines.push(`${failing.piece}  "${failing.case}"  failed ${failing.fail}/${line.runs}`);
  return lines;
}

// A serial run writes no merged `exit_code`, so its file cannot say which pieces failed.
function read_report(path) {
  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    return typeof report.exit_code === "number" ? report : undefined;
  } catch {
    return undefined;
  }
}

// A shell started outside the desktop session (ssh, a tty) has no session bus address in its environment.
function notify(text) {
  const bus = process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${process.getuid()}/bus`;
  const result = spawnSync("notify-send", ["-u", "critical", "desertbird e2e flakes", text], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: bus }, stdio: "ignore" });
  if (result.error || result.status !== 0) console.error("e2e-flakes: notify-send failed");
}

function fold_and_alert(commit, report_paths) {
  const line = fold_batch(report_paths.map(read_report), { commit, at: new Date().toISOString() });
  const path = history_path();
  // A failed write must not hide the alert, so it is logged and turned into the exit code below.
  let history_failed = false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`);
  } catch (error) {
    history_failed = true;
    console.error(`e2e-flakes: history not written to ${path}: ${error.message}`);
  }
  console.log(JSON.stringify(line));
  for (const text of summary_lines(line)) console.log(text);
  const reasons = alert_reasons(line);
  if (reasons.length > 0) {
    for (const reason of reasons) console.log(`ALERT ${reason}`);
    notify(reasons.join("\n"));
  }
  return reasons.length > 0 || history_failed ? 1 : 0;
}

// A serial run writes no merged file, so n serial runs would take hours and all count as run errors.
export function shards_error(value) {
  return /^[2-9]$|^[1-9][0-9]+$/.test(value) ? null : `E2E_SHARDS must be a number of 2 or more, got ${value}`;
}

const SIGNAL_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

// Runs a child and waits for it. A SIGINT, SIGTERM or SIGHUP to this process goes on to the child, which stops its apps and exits, and the wait ends only then. A synchronous spawn would leave the child and its apps running after this process died and the lock freed.
// `signals` is the process by default and an emitter in tests. Resolves { status, signal } with the signal this process received, if any.
export function run_child(command, args, options, signals = process) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let received = null;
    const forwarders = Object.keys(SIGNAL_CODES).map((name) => {
      const forward = () => {
        received ??= name;
        child.kill(name);
      };
      signals.on(name, forward);
      return [name, forward];
    });
    const done = (status) => {
      for (const [name, forward] of forwarders) signals.off(name, forward);
      resolve({ status, signal: received });
    };
    child.on("error", () => done(null));
    child.on("close", (status, child_signal) => done(status ?? child_signal));
  });
}

async function run_batch(n, run_args) {
  const shards = process.env.E2E_SHARDS || DEFAULT_SHARDS;
  const bad_shards = shards_error(shards);
  if (bad_shards) {
    console.error(`e2e-flakes: ${bad_shards}`);
    return 2;
  }
  // The revision the batch tests, read before the build and kept until the fold: HEAD can move while the batch runs.
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo_dir, encoding: "utf8" }).stdout.trim() || "unknown";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const batch_dir = join(repo_dir, ".logs", `e2e-flakes-${stamp}`);
  mkdirSync(batch_dir, { recursive: true });
  const built = spawnSync("npm", ["run", "--silent", "build"], { cwd: repo_dir, stdio: "inherit" });
  if (built.status !== 0) {
    console.error("e2e-flakes: build failed");
    return 2;
  }
  const report_paths = [];
  for (let run = 1; run <= n; run++) {
    console.log(`e2e-flakes: run ${run} of ${n}`);
    const timings_file = join(batch_dir, `run-${run}.json`);
    const log = openSync(join(batch_dir, `run-${run}.log`), "w");
    const env = { ...process.env, E2E_TIMINGS_FILE: timings_file, E2E_SHARDS: shards };
    const result = await run_child(process.execPath, [join(import.meta.dirname, "run.mjs"), "--xpi", join(repo_dir, "dist", "desertbird.xpi"), ...run_args], { cwd: repo_dir, env, stdio: ["ignore", log, log] });
    console.log(`e2e-flakes: run ${run} exit ${result.status}`);
    // The run has stopped its apps by now. The batch stops with it and records nothing, since a cut batch is no sample.
    if (result.signal) {
      console.error(`e2e-flakes: stopped by ${result.signal} in run ${run}, nothing recorded`);
      return SIGNAL_CODES[result.signal];
    }
    report_paths.push(timings_file);
  }
  console.log(`e2e-flakes: logs in ${batch_dir}`);
  return fold_and_alert(head, report_paths);
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === "run") {
    const [n_text, ...run_args] = rest;
    if (!/^[1-9][0-9]*$/.test(n_text ?? "")) {
      console.error(`e2e-flakes: n must be a positive number, got ${n_text}`);
      return 2;
    }
    return await run_batch(Number(n_text), run_args);
  }
  if (command === "fold") {
    const [commit, ...report_paths] = rest;
    return fold_and_alert(commit, report_paths);
  }
  console.error("usage: flakes.mjs run <n> [app...] | fold <commit> <timings file>...");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(await main(process.argv.slice(2)));
