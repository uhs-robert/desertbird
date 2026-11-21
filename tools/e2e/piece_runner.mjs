// Runs one piece on one app: the work dir and its guards, the seeds, the app start, the checks, the stop. The serial runner loops it, and a parallel worker calls the same function.
import { assert_start_paths, start_paths_of } from "./run_dir.mjs";
import { create_ctx } from "./ctx.mjs";
import { seed_storage } from "./seed.mjs";
import { E2E_SETTINGS } from "./profile.mjs";
import { join } from "node:path";

// The kinds whose checks wait for a toast to expire get the shortened toast time of `E2E_SETTINGS`.
const with_toast_time = (piece, seeds) => (piece.toast_seed ? { ...seeds, desertbird_settings: { ...E2E_SETTINGS, ...seeds?.desertbird_settings } } : seeds);

// deps: { binaries, xpi_path, run_dir, timings, start_app }. With no xpi the piece only proves the setup: its app starts and one screenshot is taken.
// Returns { name, ok, report, wall_ms }.
export async function run_piece(app, piece, deps) {
  const { binaries, xpi_path, run_dir, timings, start_app } = deps;
  const { kind, section } = piece;
  const work_dir = join(run_dir, app, kind, section);
  // Before prepare and seed_storage write into the work dir.
  assert_start_paths({ run_dir, paths: start_paths_of(work_dir) });
  const ctx = create_ctx({ app, kind, section, piece_dir: work_dir, deps });
  const seeds = with_toast_time(piece, piece.seeds);
  piece.prepare?.(work_dir, kind);
  const piece_xpi = xpi_path && (seeds || piece.extra_script) ? seed_storage(xpi_path, work_dir, seeds ?? {}, piece.extra_script ?? "") : xpi_path;
  const began = Date.now();
  let instance = null;
  let ok = true;
  // A throw anywhere from before_start to the stop is one FAIL line. The report so far and the timings entry stay, and the run goes on to the next piece.
  try {
    if (xpi_path) ctx.reference = (await piece.before_start?.(ctx)) ?? null;
    instance = await start_app({ app, app_binary: binaries[app], work_dir, run_dir, kind: piece.profile_kind ?? kind, xpi_path: piece_xpi });
    if (xpi_path) {
      ctx.instance = { ...instance, kind };
      await piece.run(ctx.instance, ctx);
    } else {
      const shot = await instance.shot(`${app}_${kind}_start`);
      const exited = instance.exited();
      console.log(`${app} ${kind}: ${exited ? `app exited ${JSON.stringify(exited)}` : "running"}, screenshot ${shot}`);
      ok = !exited;
    }
  } catch (error) {
    ctx.check(app, kind, "the piece ran to its end", false, String(error?.stack ?? error));
  } finally {
    await instance?.stop();
    timings.add_piece({ app, kind, section, wall_ms: Date.now() - began, startups: instance?.startups, peak_memory_kb: instance?.memory(), reference_apps: ctx.extra_instances.map((extra) => ({ startups: extra.startups, peak_memory_kb: extra.memory() })) });
    timings.write();
  }
  ok = ok && ctx.report.checks.every((entry) => entry.ok);
  return { name: `${app}/${kind}/${section}`, ok, report: ctx.report, wall_ms: Date.now() - began };
}
