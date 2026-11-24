import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mock, test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { load_pieces, select_pieces, DEFAULT_KINDS } = await import(join(import.meta.dirname, "..", "tools", "e2e", "registry.mjs"));
const pieces: { name: string; kind: string; section: string; opt_in?: boolean }[] = await load_pieces();
const names = (chosen: { name: string }[]) => chosen.map((piece) => piece.name);

test("every piece has its own <kind>/<section> name", () => {
  assert.equal(new Set(names(pieces)).size, pieces.length);
  for (const piece of pieces) assert.equal(piece.name, `${piece.kind}/${piece.section}`);
});

test("every kind of the default run has a piece", () => {
  for (const kind of DEFAULT_KINDS) assert.ok(pieces.some((piece) => piece.kind === kind), kind);
});

test("a run with no setting takes every piece but the opt-in ones, kinds in their order", () => {
  const chosen = select_pieces(pieces, {});
  assert.deepEqual(chosen.filter((piece: { opt_in?: boolean }) => piece.opt_in), []);
  assert.deepEqual([...new Set(chosen.map((piece: { kind: string }) => piece.kind))], DEFAULT_KINDS);
});

test("E2E_KINDS takes every piece of each kind, in the order given", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_KINDS: "pages,zoom" })), ["pages/keys", "pages/page_hints", "pages/typing", "zoom/main"]);
});

test("a web_hints list still selects the web piece and the other sections", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "web_hints,typing" })), ["pages/typing", "web/main"]);
});

test("E2E_ONLY narrows the pieces by section name or alias, across kinds when E2E_KINDS is unset", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "page_hints" })), ["pages/page_hints"]);
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "web_hints" })), ["web/main"]);
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "hud", E2E_KINDS: "default" })), ["default/hud"]);
  assert.deepEqual(names(select_pieces(pieces, { E2E_ONLY: "typing,keys" })), ["default/keys", "pages/keys", "pages/typing"]);
});

const DEFAULT_SECTIONS = ["cmdline", "cmdline_launch", "context_compose", "context_menu", "filter_by_message", "folders", "followup", "hud", "keys", "mode_label", "panes_chrome", "panes_focus", "panes_undo", "popup", "search", "steps", "tabs", "threads", "view_settings", "visual", "window_hints"];

test("the default kind is one piece per section, popup included and scale left out", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_KINDS: "default" })), DEFAULT_SECTIONS.map((section) => `default/${section}`));
});

test("the aliases of the default sections select their pieces", () => {
  const only = (alias: string) => names(select_pieces(pieces, { E2E_KINDS: "default", E2E_ONLY: alias }));
  assert.deepEqual(only("panes"), ["default/panes_chrome", "default/panes_focus", "default/panes_undo"]);
  assert.deepEqual(only("hints"), ["default/window_hints"]);
  for (const alias of ["popup", "steps", "threads", "cmdline", "cmdline_launch", "search", "mode_label", "keys"]) assert.deepEqual(only(alias), [`default/${alias}`]);
  assert.deepEqual(only("tabs"), ["default/tabs"]);
});

test("E2E_SCALE=1 takes the scale piece alone, and E2E_ONLY=scale without it throws", () => {
  assert.deepEqual(names(select_pieces(pieces, { E2E_SCALE: "1", E2E_KINDS: "web" })), ["default/scale"]);
  assert.throws(() => select_pieces(pieces, { E2E_ONLY: "scale" }), /E2E_SCALE=1/);
});

test("a name that matches nothing throws and lists the valid ones", () => {
  assert.throws(() => select_pieces(pieces, { E2E_ONLY: "nope" }), /nope.*typing/);
  assert.throws(() => select_pieces(pieces, { E2E_KINDS: "nope" }), /nope.*zoom/);
  assert.throws(() => select_pieces(pieces, { E2E_KINDS: "zoom", E2E_ONLY: "typing" }), /matches no piece/);
});

test("a throw in before_start is a FAIL line, keeps the timings entry and returns ok false", async () => {
  const { run_piece } = await import(join(import.meta.dirname, "..", "tools", "e2e", "piece_runner.mjs"));
  const { create_timings } = await import(join(import.meta.dirname, "..", "tools", "e2e", "timings.mjs"));
  const run_dir = mkdtempSync(join(tmpdir(), "desertbird-pieces-test-"));
  try {
    const timings = create_timings(join(run_dir, "timings.json"));
    const piece = { kind: "k", section: "main", before_start: async () => { throw new Error("no reference"); }, run: async () => {} };
    // run_piece prints the FAIL line it records. Keep it out of the check output, where a grep for FAIL would find it.
    const log = mock.method(console, "log", () => {});
    const result = await run_piece("betterbird", piece, { binaries: { betterbird: "/bin/true" }, xpi_path: "x.xpi", run_dir, timings, start_app: async () => { throw new Error("must not start"); } });
    const printed = log.mock.calls.map((call) => String(call.arguments[0]));
    log.mock.restore();
    assert.ok(printed.some((line) => line.startsWith("FAIL betterbird/k ")));
    assert.equal(result.ok, false);
    assert.equal(result.report.checks.length, 1);
    assert.match(result.report.checks[0].detail, /no reference/);
    assert.deepEqual(timings.report().pieces.map((entry: { name: string }) => entry.name), ["betterbird/k/main"]);
  } finally {
    rmSync(run_dir, { recursive: true, force: true });
  }
});

const committed_weights: Record<string, number> = JSON.parse(readFileSync(join(import.meta.dirname, "..", "tools", "e2e", "piece_seconds.json"), "utf8"));
const APPS = ["thunderbird", "betterbird"];
const { DEFAULT_PIECE_DEADLINE_S, parse_piece_id } = await import(join(import.meta.dirname, "..", "tools", "e2e", "shards.mjs"));
const run_dir_module = await import(join(import.meta.dirname, "..", "tools", "e2e", "run_dir.mjs"));

test("every weight names a real <app>/<kind>/<section>, and every piece of a full run has one", () => {
  const ids = APPS.flatMap((app) => pieces.map((piece) => `${app}/${piece.name}`));
  for (const id of Object.keys(committed_weights)) assert.ok(ids.includes(id), `${id} is no piece`);
  for (const app of APPS) for (const piece of pieces.filter((candidate) => !candidate.opt_in)) assert.ok(`${app}/${piece.name}` in committed_weights, `${app}/${piece.name} has no weight`);
});

// A piece that grows near its deadline fails here first, so raising a deadline_s is a conscious edit and not a surprise kill in a sharded run.
test("every weight times 1.5 fits its piece's deadline", () => {
  for (const [id, seconds] of Object.entries(committed_weights)) {
    const piece = pieces.find((candidate) => candidate.name === parse_piece_id(id).name) as { deadline_s?: number } | undefined;
    const deadline_s = piece?.deadline_s ?? DEFAULT_PIECE_DEADLINE_S;
    assert.ok(seconds * 1.5 <= deadline_s, `${id} weighs ${seconds} s, over two thirds of its ${deadline_s} s deadline`);
  }
});

// Two workers share one run dir and nothing else. Each piece's dir holds its own labwc socket (runtime), HOME and profile, and its sink binds port 0.
// The coordinator reaps a dead worker's piece by the dir join(run_dir, id), so that dir must be the one piece_runner starts the app in.
test("every piece of a full run gets a dir of its own, apart from every other piece's display, HOME and profile", () => {
  const run_dir = join(tmpdir(), "desertbird-e2e-XXXXXX");
  const { start_paths_of } = run_dir_module;
  const ids = APPS.flatMap((app) => pieces.map((piece) => `${app}/${piece.name}`));
  const dirs = ids.map((id) => {
    const { app, name } = parse_piece_id(id);
    const piece = pieces.find((candidate) => candidate.name === name)!;
    assert.equal(join(run_dir, id), join(run_dir, app, piece.kind, piece.section));
    return join(run_dir, id);
  });
  for (const [at, dir] of dirs.entries()) {
    for (const [other_at, other] of dirs.entries()) {
      if (at === other_at) continue;
      for (const path of start_paths_of(dir)) assert.ok(path !== other && !path.startsWith(`${other}/`), `${path} lies in ${other}`);
    }
  }
});

// A Unix socket path ends at 108 bytes. The longest piece name under a default run dir in /tmp must leave room for that.
// A fixed /tmp, not tmpdir(): `just test` points TMPDIR at a longer scratch dir, and this test pins the piece layout, not the caller's TMPDIR.
test("the longest private Wayland socket path stays under 100 bytes", () => {
  const run_dir = join("/tmp", "desertbird-e2e-XXXXXX");
  const longest = Math.max(...APPS.flatMap((app) => pieces.map((piece) => join(run_dir, app, piece.kind, piece.section, "runtime", "wayland-1").length)));
  assert.ok(longest < 100, `${longest} bytes`);
});

// Two equal apps would give two workers one piece id and one profile dir. The runner refuses them before it opens a run dir or starts anything.
test("the runner refuses an app named twice with the setup exit code", { timeout: 30_000 }, () => {
  const { E2E_DIR: _unset, ...env } = process.env;
  const run = spawnSync(process.execPath, [join(import.meta.dirname, "..", "tools", "e2e", "run.mjs"), "thunderbird", "thunderbird"], { encoding: "utf8", env: { ...env, E2E_SHARDS: "2" }, timeout: 20_000, killSignal: "SIGKILL" });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stderr, /thunderbird is named twice/);
  assert.doesNotMatch(run.stdout, /work dir/);
});
