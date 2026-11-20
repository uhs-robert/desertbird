// Regenerates the block between the markers of docs/keymap.md from the default keymaps.
// Usage: node tools/gen-keymap-docs.ts --write | --check [--doc path]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_KEYMAP, GROUP_NAMES, registry } from "../src/background/commands/index.ts";
import { default_keymap_of, default_typing_keymap } from "../src/background/commands/tab_keymaps.ts";
import { render, type KeymapSection } from "./keymap_docs/render.ts";
import { splice } from "./keymap_docs/splice.ts";

const root = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const doc_flag = args.indexOf("--doc");
const doc_path = doc_flag >= 0 ? args[doc_flag + 1]! : fileURLToPath(new URL("docs/keymap.md", root));
const write = args.includes("--write");
const check = args.includes("--check");
if (write === check) {
  console.error("usage: node tools/gen-keymap-docs.ts --write | --check [--doc path]");
  process.exit(2);
}

// The mail tab has no entry in TAB_KINDS: its keys are DEFAULT_KEYMAP itself.
const sections: KeymapSection[] = [
  { title: "Mail tab", about: "The thread list and the folder pane.", keymap: DEFAULT_KEYMAP },
  { title: "Message", about: "A message in a tab, a window or the message pane.", keymap: default_keymap_of("message") },
  { title: "Own pages", about: "The options page and the help page.", keymap: default_keymap_of("own") },
  { title: "Other tabs", about: "Calendar, tasks, chat, the address book, settings and `about:` pages.", keymap: default_keymap_of("page") },
  { title: "Text fields", about: "A text field in a page tab or in the mail tab (the quick filter, the search box). Plain keys are text there. Alt+j and Alt+k also work in insert mode.", keymap: default_typing_keymap() },
];

const current = readFileSync(doc_path, "utf8");
const next = splice(current, render(sections, registry, GROUP_NAMES));
if (next !== current) {
  if (write) {
    writeFileSync(doc_path, next);
  } else {
    const current_lines = current.split("\n");
    const first_diff = next.split("\n").findIndex((line, at) => line !== current_lines[at]);
    console.error(`the generated keymap tables are stale (first difference at line ${first_diff + 1}); run \`npm run docs:gen\``);
    process.exit(1);
  }
}
