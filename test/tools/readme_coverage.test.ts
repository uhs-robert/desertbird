import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { test } from "node:test";

const SOURCE_FILE = /\.(ts|css|html)$/;
const DECLARATION_FILE = /\.d\.ts$/;

// A folder without its own README is described by the nearest README above it, up to src.
function readme_of(folder: string): string {
  for (let current = folder; current !== "."; current = dirname(current)) {
    const path = join(current, "README.md");
    if (existsSync(path)) return path;
  }
  throw new Error(`no README above ${folder}`);
}

// A README names a file as `name.ts`, or as `name` where it lists modules without the extension. Either form may carry the path from the README's folder (`handlers/undo.ts`), since the background README lists the files of its subfolders that way.
function is_named(readme_text: string, readme: string, file_path: string): boolean {
  const from_readme = relative(dirname(readme), file_path);
  const forms = [basename(file_path), from_readme];
  return forms.some((form) => readme_text.includes(`\`${form}\``) || readme_text.includes(`\`${form.replace(/\.ts$/, "")}\``));
}

test("every source file under src has an entry in its folder README", () => {
  const problems: string[] = [];
  for (const entry of readdirSync("src", { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE_FILE.test(entry.name) || DECLARATION_FILE.test(entry.name)) continue;
    const readme = readme_of(entry.parentPath);
    if (!is_named(readFileSync(readme, "utf8"), readme, join(entry.parentPath, entry.name))) problems.push(`${join(entry.parentPath, entry.name)}: add a line "- \`${entry.name}\`: what it does" to ${readme}`);
  }
  assert.equal(problems.length, 0, `\n${problems.length} source file(s) have no README entry:\n${problems.sort().join("\n")}\n`);
});
