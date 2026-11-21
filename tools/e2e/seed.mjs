// What a piece seeds before its app starts: a copy of the xpi with storage records or an extra script, and the external editor host.
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// A copy of the xpi whose background page writes the given records to `storage.local` at start, since the helper add-on cannot write another add-on's storage.
export function seed_storage(xpi, work_dir, records, extra_script = "") {
  const stage = join(work_dir, "seed_stage");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  execFileSync("unzip", ["-q", xpi, "-d", stage]);
  appendFileSync(join(stage, "background.js"), `\nmessenger.storage.local.set(${JSON.stringify(records)});\n${extra_script}`);
  const seeded = join(work_dir, "desertbird_seeded.xpi");
  rmSync(seeded, { force: true });
  execFileSync("zip", ["-qr", seeded, "."], { cwd: stage });
  return seeded;
}

// Quick replies. The seeded slots are in the xpi this kind installs (see `seed_storage`). g r 1 opens a reply with the slot text. The run checks that the quote survives and records where the text, the quote and the signature land.
export const QUICK_REPLY_SEED = ["Quick reply one.\nSecond & <b>line</b>.", "", "", "", "", "", "", "", ""];

// The own_pages kind installs a copy of the xpi that opens its options or help page when the helper add-on sends the page name.
export const OPEN_OWN_PAGES_SCRIPT = `messenger.runtime.onMessageExternal.addListener((page) => (page === "help" ? messenger.tabs.create({ url: messenger.runtime.getURL("help/help.html") }) : messenger.runtime.openOptionsPage()).then(() => true));\n`;

// The external editor kind: the native host from a DesertFox install, reached through a desertbird_host manifest in the session's own HOME, runs a fake editor that rewrites the scratch file. Nothing is written outside the work directory.
export const EDITED_TEXT = "Edited by the e2e editor.";

export const DESERTFOX_HOST = process.env.E2E_DESERTFOX_HOST ?? join(process.env.HOME ?? "", ".local/share/desertfox/desertfox-host");

// The HTML kinds: Markdown the user writes, with a bold word, markup that must not turn live and tag text that must stay text.
export const EDITED_MARKDOWN = "**Edited** by the e2e editor.\n\n<img src=\"x\" onerror=\"document.title='hit'\"> [a link](javascript:alert(1)) &lt;b&gt;kept as text&lt;/b&gt;\n";

// The HTML kinds and the layout each tests: a reply below the quote (Thunderbird's default), and a reply above the quote with the signature above it too.
export const COMPOSE_EDITOR_HTML_KINDS = { compose_editor_html: "below", compose_editor_html_top: "above" };

export function install_editor_host(work_dir, kind) {
  const home = join(work_dir, "home");
  const manifests = join(home, ".mozilla", "native-messaging-hosts");
  mkdirSync(manifests, { recursive: true });
  writeFileSync(join(manifests, "desertbird_host.json"), JSON.stringify({ name: "desertbird_host", description: "DesertBird e2e editor host", path: DESERTFOX_HOST, type: "stdio", allowed_extensions: ["desertbird@uhs-robert"] }));
  const config = join(home, ".config", "desertfox");
  mkdirSync(config, { recursive: true });
  if (kind in COMPOSE_EDITOR_HTML_KINDS) {
    const markdown_file = join(home, "edited.md");
    writeFileSync(markdown_file, EDITED_MARKDOWN);
    // A JSON array of strings is a valid TOML array.
    writeFileSync(join(config, "editor.toml"), `argv = ${JSON.stringify(["cp", markdown_file, "{file}"])}\n`);
    return;
  }
  // The scratch path holds no space, so `$1` goes unquoted and the TOML string needs no escape.
  writeFileSync(join(config, "editor.toml"), `argv = ["sh", "-c", "echo ${EDITED_TEXT} > $1", "sh", "{file}"]\n`);
}
