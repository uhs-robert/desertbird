import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { CommandDef } from "../../vendor/desertfox/command.ts";
import { render } from "../../tools/keymap_docs/render.ts";
import { BEGIN_MARKER, cell, code, END_MARKER, splice } from "../../tools/keymap_docs/splice.ts";

const root = new URL("../../", import.meta.url);
const generator = fileURLToPath(new URL("tools/gen-keymap-docs.ts", root));
const keymap_doc = fileURLToPath(new URL("docs/keymap.md", root));

const fake_commands: Record<string, Partial<CommandDef>> = {
  "scroll.lines": { id: "scroll.lines", name: "scroll", label: "Scroll", params: [{ name: "count", type: "number", positional: true } as never] },
  "tab.next": { id: "tab.next", label: "Next tab" },
  "tab.prev": { id: "tab.prev", label: "Previous tab" },
};
const fake_registry = { get: (id: string) => fake_commands[id] as CommandDef | undefined };

// Runs the generator on a copy of the doc, so a test never writes docs/keymap.md.
function run_generator(mode: "--write" | "--check", doc_text: string): { status: number | null; stderr: string; doc_after: string } {
  const dir = mkdtempSync(join(tmpdir(), "keymap-docs-"));
  try {
    const doc = join(dir, "keymap.md");
    writeFileSync(doc, doc_text);
    const run = spawnSync(process.execPath, ["--no-warnings", generator, mode, "--doc", doc], { encoding: "utf8" });
    return { status: run.status, stderr: run.stderr, doc_after: readFileSync(doc, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("splice replaces only the block between the markers", () => {
  const doc = `intro\n${BEGIN_MARKER}\nold\n${END_MARKER}\noutro\n`;
  assert.equal(splice(doc, "new"), `intro\n${BEGIN_MARKER}\n\nnew\n\n${END_MARKER}\noutro\n`);
});

test("splice rejects missing, duplicated and reversed markers", () => {
  assert.throws(() => splice("no markers", "x"), /exactly one/);
  assert.throws(() => splice(`${BEGIN_MARKER}\n${BEGIN_MARKER}\n${END_MARKER}`, "x"), /exactly one/);
  assert.throws(() => splice(`${END_MARKER}\n${BEGIN_MARKER}`, "x"), /comes before/);
});

test("cell escapes pipes and collapses whitespace, and code survives backticks", () => {
  assert.equal(cell("a |  b\n c"), "a \\| b c");
  assert.equal(code("<C-`>"), "``<C-`>``");
  assert.equal(code("`"), "`` ` ``");
});

test("render groups keys by the longest named prefix, covers chained and prompting bindings, and skips null", () => {
  const keymap = {
    normal: {
      J: { id: "tab.next" },
      j: { id: "scroll.lines", args: { count: 10 } },
      "<C-d>": { id: "tab.prev" },
      gn: [{ id: "tab.next" }, { id: "tab.prev" }],
      gpn: { id: "scroll.lines", prompt: { param: "count" } },
      xz: { id: "tab.next" },
      gone: null,
    },
  };
  const text = render([{ title: "Mail", about: "About mail.", keymap }], fake_registry, { g: "Go", gp: "Pages" });
  assert.match(text, /^bound: 6 \(Mail 6\)$/m);
  assert.match(text, /### Mail\n\nAbout mail\./);
  assert.match(text, /#### Single keys\n\n\| Key \| Command \|\n\| --- \| --- \|\n\| `J` \| `tab\.next` \|\n\| `j` \| `scroll --count=10` \|\n\| `<C-d>` \| `tab\.prev` \|\n\| `xz` \| `tab\.next` \|/);
  assert.match(text, /#### Go\n\n[^#]*\| `gn` \| `tab\.next ; tab\.prev` \|/);
  assert.match(text, /#### Pages\n\n[^#]*\| `gpn` \| `scroll` \(prompts\) \|/);
  assert.ok(!text.includes("gone"));
  assert.ok(text.indexOf("#### Single keys") < text.indexOf("#### Go") && text.indexOf("#### Go") < text.indexOf("#### Pages"));
});

test("render leaves out a group that has no keys", () => {
  const text = render([{ title: "Mail", about: "x", keymap: { normal: { J: { id: "tab.next" } } } }], fake_registry, { g: "Go" });
  assert.ok(!text.includes("#### Go"));
});

test("--check fails on a stale doc and passes once --write has run", () => {
  const stale = `intro\n${BEGIN_MARKER}\n\nold\n\n${END_MARKER}\n`;
  const checked = run_generator("--check", stale);
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /stale/);
  assert.equal(checked.doc_after, stale);
  const written = run_generator("--write", stale);
  assert.equal(written.status, 0);
  assert.equal(run_generator("--check", written.doc_after).status, 0);
});

test("the generator fails on a doc with no markers", () => {
  assert.notEqual(run_generator("--check", "no markers").status, 0);
});

test("docs/keymap.md is current", () => {
  const dir = mkdtempSync(join(tmpdir(), "keymap-docs-"));
  try {
    const copy = join(dir, "keymap.md");
    copyFileSync(keymap_doc, copy);
    const run = spawnSync(process.execPath, ["--no-warnings", generator, "--check", "--doc", copy], { encoding: "utf8" });
    assert.equal(run.status, 0, `run \`npm run docs:gen\`: ${run.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
