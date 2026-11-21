import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const e2e_dir = join(import.meta.dirname, "..", "tools", "e2e");
const { area_names, area_rules, areas_of_file, read_piece_file_areas, select_piece_files } = await import(join(e2e_dir, "areas.mjs"));
const { load_pieces, select_pieces, changed_run_apps } = await import(join(e2e_dir, "registry.mjs"));

const src_files: string[] = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", cwd: join(import.meta.dirname, "..") })
  .split("\n")
  .filter(Boolean);
const file_areas: Map<string, string[]> = read_piece_file_areas();
const files_of = (paths: string[]): string[] => select_piece_files(paths, file_areas).files;

test("every src file matches an area rule", () => {
  const unplaced = src_files.filter((path) => areas_of_file(path) === null);
  assert.deepEqual(unplaced, [], "add a glob to area_rules in tools/e2e/areas.mjs for each of these files");
});

test("every rule names known areas", () => {
  for (const rule of area_rules) for (const area of rule.areas) assert.ok(area_names.includes(area), `unknown area ${area}`);
});

test("every piece file lists a non-empty set of known areas", () => {
  assert.ok(file_areas.size > 0);
  for (const [file, areas] of file_areas) {
    assert.ok(areas.length > 0, `${file} must export a non-empty areas`);
    for (const area of areas) assert.ok(area_names.includes(area), `${file} lists unknown area ${area}`);
  }
});

test("every area has a rule and a piece", () => {
  for (const area of area_names) {
    assert.ok(area_rules.some((rule: { areas: string[] }) => rule.areas.includes(area)), `no rule maps to ${area}`);
    assert.ok([...file_areas.values()].some((areas) => areas.includes(area)), `no piece lists ${area}`);
  }
});

test("a shared file selects every piece file, a docs file none, a piece file its own", () => {
  const all = [...file_areas.keys()];
  for (const path of ["src/manifest.json", "src/background/router.ts", "src/shared/protocol.ts", "src/chrome/runtime.ts", "vendor/desertfox/command.ts", "tools/build.mjs"]) assert.deepEqual(files_of([path]), all, path);
  for (const name of ["harness", "profile", "run", "registry", "piece_runner"]) assert.deepEqual(files_of([`tools/e2e/${name}.mjs`]), all, name);
  assert.deepEqual(files_of(["src/help/README.md"]), []);
  assert.deepEqual(files_of(["docs/design.md", "README.md", "tools/e2e/README.md"]), []);
  assert.deepEqual(files_of(["tools/e2e/pieces/default.search.mjs"]), ["default.search.mjs"]);
});

test("an src file selects the pieces that share its area, and an unplaced src file selects every piece", () => {
  assert.deepEqual(files_of(["src/background/search/service.ts"]), ["default.search.mjs"]);
  assert.ok(files_of(["src/chrome/mode_label.ts"]).includes("mode_label.mjs"));
  assert.equal(files_of(["src/no_such_area/file.ts"]).length, file_areas.size);
});

test("a shared helper of some pieces selects those pieces", () => {
  assert.ok(files_of(["tools/e2e/pieces/_default_shared.mjs"]).every((file) => file.startsWith("default.")));
  assert.deepEqual(files_of(["tools/e2e/zoom_checks.mjs"]), ["zoom.main.mjs"]);
});

test("E2E_CHANGED=1 keeps the pieces of the changed files and runs Betterbird alone", async () => {
  const pieces = await load_pieces();
  const names = (chosen: { name: string }[]) => chosen.map((piece) => piece.name);
  assert.deepEqual(names(select_pieces(pieces, { E2E_CHANGED: "1", E2E_CHANGED_PATHS: "src/background/search/service.ts" })), ["default/search"]);
  assert.deepEqual(select_pieces(pieces, { E2E_CHANGED: "1", E2E_CHANGED_PATHS: "docs/design.md" }), []);
  assert.equal(select_pieces(pieces, { E2E_CHANGED: "1", E2E_CHANGED_PATHS: "src/manifest.json" }).length, select_pieces(pieces, {}).length);
  assert.deepEqual(changed_run_apps({ E2E_CHANGED: "1" }), ["betterbird"]);
  assert.equal(changed_run_apps({}), null);
});

// A value import loads the file for every key, so a file that a shared key runtime file reaches must be shared too. The background main.ts wires every feature, so the walk stays in chrome, content and shared. Type imports vanish at build time and are skipped.
function value_imports(path: string): string[] {
  const text = readFileSync(join(import.meta.dirname, "..", path), "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gms)) {
    const target = join(path, "..", (match[1] as string)).replaceAll("\\", "/");
    if (/^src\/(chrome|content|shared)\//.test(target) && existsSync(join(import.meta.dirname, "..", target))) found.push(target);
  }
  return found;
}

test("every src file that a shared file imports is shared too", () => {
  const is_shared = (path: string) => areas_of_file(path)?.length === area_names.length;
  const seen = new Set<string>();
  const queue = src_files.filter((path) => path.endsWith(".ts") && /^src\/(chrome|content|shared)\//.test(path) && is_shared(path));
  const unshared: string[] = [];
  while (queue.length) {
    const path = queue.pop() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const target of value_imports(path)) {
      if (!is_shared(target)) unshared.push(`${path} imports ${target}`);
      queue.push(target);
    }
  }
  assert.deepEqual(unshared, [], "add each imported file to shared_files in tools/e2e/areas.mjs");
});
