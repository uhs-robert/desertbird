// Which e2e pieces a change can affect. A src file maps to feature areas, a piece file lists the areas it exercises, and a change runs the pieces that share an area.
// Copied from DesertFox test/key/areas.mjs with the departures in tools/e2e/README.md (Changed-only runs).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pieces_dir = join(import.meta.dirname, "pieces");

export const area_names = ["motions", "mail_keys", "threads", "search", "views", "cmdline", "hud", "hints", "visual", "panes", "tabs", "folders", "message_body", "compose", "quick_reply", "own_pages", "mode_label", "theme", "followup", "pages", "web", "zoom", "popup"];

// Key path and command contract: any change here can break any piece.
const shared_files = [
  "src/manifest.json",
  "src/background/{main,router,notify}.ts",
  "src/background/commands/{define,index,tab_keymaps}.ts",
  "src/background/config/**",
  "src/shared/{protocol,swallow,keymap_tree}.ts",
  "src/chrome/{runtime,parent_keys,platform,focus,view,motions,page_focus,mode_label,overlay,overlay_id,parent_overlay}.ts",
  "src/experiment/{keys,overlay}.schema.json",
];

// First match wins, so order matters: a narrow rule sits before the folder glob that would also take its file.
export const area_rules = [
  // Docs carry no behavior a piece reads.
  { globs: ["src/**/README.md"], areas: [] },
  { globs: shared_files, areas: area_names },
  // The bridge serves an outside client, and no piece drives it, so only its unit tests read it.
  { globs: ["src/background/bridge/**"], areas: [] },
  // Themed hint labels draw in the hint pieces too.
  { globs: ["src/background/theme/themed_hints.ts"], areas: ["theme", "hints"] },
  { globs: ["src/background/theme/**", "src/shared/{follow_theme,theme_choice,theme_css}.ts"], areas: ["theme"] },
  // The folder list of the command line completes from the folder pane.
  { globs: ["src/background/cmdline/folder_rows.ts"], areas: ["cmdline", "folders"] },
  { globs: ["src/background/cmdline/**", "src/background/{commands,handlers}/cmdline.ts", "src/overlay/{cmdline,confirm,line_edit}.*"], areas: ["cmdline"] },
  // The message window type is read by the command line, the body requests and the tab close.
  { globs: ["src/background/window_types.ts"], areas: ["cmdline", "message_body", "tabs"] },
  { globs: ["src/background/hud/**", "src/overlay/hud.*", "src/background/new_mail_notify.ts", "src/background/commands/new_mail.ts"], areas: ["hud"] },
  // The help page shows in the hud piece and the own_pages piece.
  { globs: ["src/help/**", "src/background/{commands,handlers}/help.ts"], areas: ["hud", "own_pages"] },
  { globs: ["src/options/**"], areas: ["own_pages"] },
  // The toolbar popup and its icon run only by hand: no piece clicks a toolbar button, and the unit tests read the request handler.
  { globs: ["src/popup/**", "src/icons/**", "src/background/popup_requests.ts"], areas: [] },
  { globs: ["src/content/body_hints.ts"], areas: ["hints", "message_body"] },
  // The own pages (options, help) run these same body scripts for j, q and /.
  { globs: ["src/content/{body_find,body_keys}.ts"], areas: ["message_body", "own_pages"] },
  { globs: ["src/content/page_keys.ts"], areas: ["own_pages"] },
  { globs: ["src/chrome/{hint_pick,hint_targets,parent_hints,page_hints_child}.ts", "src/shared/{hint_labels,hint_view}.ts", "src/background/commands/hints.ts", "src/background/handlers/hint_window.ts", "src/experiment/hints.schema.json"], areas: ["hints"] },
  { globs: ["src/content/message_display.ts", "src/background/{body_requests,handlers/message_find}.ts", "src/background/commands/reading.ts"], areas: ["message_body"] },
  { globs: ["src/background/search/**", "src/background/{commands,handlers}/search.ts"], areas: ["search"] },
  { globs: ["src/background/handlers/{folder_collapse,folder_marks,folder_open,folder_state,special_folder,displayed_folder,jump_history}.ts", "src/background/commands/folders.ts", "src/chrome/parent_folderpane.ts", "src/experiment/folderpane.schema.json"], areas: ["folders", "panes"] },
  { globs: ["src/background/{commands,handlers}/view.ts", "src/chrome/view_verbs.ts"], areas: ["views"] },
  { globs: ["src/background/{commands,handlers}/thread*.ts"], areas: ["threads"] },
  // The compose label is checked in the compose editor and quick reply pieces.
  { globs: ["src/content/compose_mode_label.ts"], areas: ["mode_label", "compose", "quick_reply"] },
  { globs: ["src/chrome/{pane_resize,readable_focus}.ts"], areas: ["panes"] },
  { globs: ["src/background/commands/motion.ts"], areas: ["motions", "visual"] },
  { globs: ["src/background/{commands,handlers}/step.ts"], areas: ["motions", "views", "panes"] },
  { globs: ["src/background/{commands,handlers}/tabs.ts"], areas: ["tabs", "popup"] },
  { globs: ["src/background/{commands,handlers}/zoom.ts", "src/chrome/parent_zoom.ts", "src/experiment/zoom.schema.json"], areas: ["zoom"] },
  { globs: ["src/chrome/{page_actions,page_actor_child,page_actor_parent,page_focus,page_runtime,parent_pages}.ts", "src/background/commands/page.ts", "src/experiment/pages.schema.json"], areas: ["pages", "web"] },
  { globs: ["src/background/{commands,handlers}/followup.ts", "src/background/{followup_presets,followup_store}.ts"], areas: ["followup"] },
  { globs: ["src/background/{commands,handlers}/quick_reply.ts", "src/background/quick_reply_store.ts"], areas: ["quick_reply", "compose"] },
  { globs: ["src/background/{commands,handlers}/compose.ts", "src/background/{compose_markdown,external_editor}.ts", "src/content/compose_{edit_key,keys}.ts", "src/background/commands/account_param.ts", "src/background/handlers/{account_choice,identity}.ts"], areas: ["compose"] },
  // The first display of a folder waits through loading.ts, for the folder and view handlers.
  { globs: ["src/background/handlers/loading.ts"], areas: ["mail_keys", "folders", "views"] },
  // The record store backs the snooze, follow-up and quick reply stores.
  { globs: ["src/background/record_store.ts"], areas: ["mail_keys", "followup", "quick_reply"] },
  // Flags, archive, delete, undo, snooze and the other commands that act on the selected messages. app.schema.json is the Experiment those verbs run through.
  {
    globs: [
      "src/background/{commands,handlers}/{app,messages,message,message_state,message_query,each_message,undo,snooze,unsubscribe,attachments,clipboard}.ts",
      "src/background/commands/captures.ts",
      "src/background/{snooze_presets,snooze_store,undo_log,list_unsubscribe,record_store,scheduler,safe_filename}.ts",
      "src/chrome/{app_verbs,parent_app}.ts",
      "src/experiment/app.schema.json",
    ],
    areas: ["mail_keys"],
  },
];

// Supports ** (any depth), * (within one path part) and {a,b}. Nothing else is special.
function glob_to_regex(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (glob.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      out += ".*";
      i += 1;
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "{") out += "(?:";
    else if (ch === "}") out += ")";
    else if (ch === ",") out += glob.slice(0, i).lastIndexOf("{") > glob.slice(0, i).lastIndexOf("}") ? "|" : ",";
    else out += ch.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

const compiled_rules = area_rules.map((rule) => ({ ...rule, patterns: rule.globs.map(glob_to_regex) }));

// The areas of one src path, or null when no rule matches (the unit test fails on that).
export function areas_of_file(path) {
  const rule = compiled_rules.find((candidate) => candidate.patterns.some((pattern) => pattern.test(path)));
  return rule ? rule.areas : null;
}

// The areas of each piece file, read as text from its one-line `export const areas = [...]`, so listing them loads no piece and no harness. A file whose name starts with `_` holds no piece.
export function read_piece_file_areas() {
  const files = new Map();
  for (const file of readdirSync(pieces_dir).filter((name) => name.endsWith(".mjs") && !name.startsWith("_")).sort()) {
    const match = /^export const areas = (\[.*\]);$/m.exec(readFileSync(join(pieces_dir, file), "utf8"));
    files.set(file, match ? JSON.parse(match[1]) : []);
  }
  return files;
}

// What a change under tools/ or vendor/ runs. A piece file selects itself, a shared helper of some pieces selects those, and any other file here selects every piece, so a new file errs to the safe side. Listed first wins.
const piece_file = (glob) => `tools/e2e/pieces/${glob}.mjs`;
const support_rules = [
  { globs: ["tools/e2e/{README.md,timings.mjs,measure_concurrent.mjs,piece_seconds.json}", "tools/e2e/pieces/README.md"], pieces: [] },
  { globs: ["tools/e2e/pieces/_default_shared.mjs"], pieces: [piece_file("default.*")] },
  { globs: ["tools/e2e/pieces/_mode_label.mjs"], pieces: [piece_file("default.mode_label"), piece_file("default.visual"), piece_file("mode_label")] },
  { globs: ["tools/e2e/pieces/_panes_shared.mjs", "tools/e2e/panes_checks.mjs"], pieces: [piece_file("default.panes_*")] },
  { globs: ["tools/e2e/page_hints_checks.mjs"], pieces: [piece_file("pages.page_hints")] },
  { globs: ["tools/e2e/pages_checks.mjs"], pieces: [piece_file("pages.keys")] },
  { globs: ["tools/e2e/typing_checks.mjs"], pieces: [piece_file("pages.typing")] },
  { globs: ["tools/e2e/popup_checks.mjs"], pieces: [piece_file("default.popup")] },
  { globs: ["tools/e2e/web_checks.mjs", "tools/e2e/web_fixture.mjs"], pieces: [piece_file("web.main")] },
  { globs: ["tools/e2e/zoom_checks.mjs"], pieces: [piece_file("zoom.main")] },
  // Anything else in tools/e2e is the harness, and that includes the runner machinery (coordinator, worker, shards, reap), which decides how every piece starts and ends: the profile, the helper add-on, the start, the predicates and the report all sit under every piece.
  { globs: ["tools/e2e/**", "tools/build.mjs", "vendor/**", "package.json", "package-lock.json", "tsconfig.json"], pieces: "all" },
];
const compiled_support_rules = support_rules.map((rule) => ({ ...rule, patterns: rule.globs.map(glob_to_regex), piece_patterns: rule.pieces === "all" ? null : rule.pieces.map(glob_to_regex) }));

// Pieces to run, as piece file names, for a list of changed paths. A src file picks the pieces that list one of its areas, and a src file with no rule picks every piece. Paths outside src, tools and vendor are ignored.
export function select_piece_files(changed_paths, file_areas) {
  const all_files = [...file_areas.keys()];
  const hit = new Set();
  const chosen = new Set();
  const src_paths = changed_paths.filter((path) => path.startsWith("src/"));
  for (const path of src_paths) for (const area of areas_of_file(path) ?? area_names) hit.add(area);
  for (const path of changed_paths) {
    const own = /^tools\/e2e\/pieces\/([^/_][^/]*\.mjs)$/.exec(path)?.[1];
    if (own && file_areas.has(own)) chosen.add(own);
    const support = compiled_support_rules.find((rule) => rule.patterns.some((pattern) => pattern.test(path)));
    if (!support || own) continue;
    for (const file of all_files) if (support.piece_patterns === null || support.piece_patterns.some((pattern) => pattern.test(`tools/e2e/pieces/${file}`))) chosen.add(file);
  }
  for (const [file, areas] of file_areas) if (areas.some((area) => hit.has(area))) chosen.add(file);
  return { src_paths, areas: area_names.filter((area) => hit.has(area)), files: all_files.filter((file) => chosen.has(file)) };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
}

// With head, the commits base...head. Without it, everything since the merge base: commits, working tree and new files.
export function changed_paths_since(base, head) {
  if (head) return git("diff", "--name-only", "--no-renames", `${base}...${head}`);
  const merge_base = git("merge-base", base, "HEAD")[0];
  return [...git("diff", "--name-only", "--no-renames", merge_base), ...git("ls-files", "--others", "--exclude-standard", "--", "src", "tools", "vendor")];
}

// The piece files a run with E2E_CHANGED=1 takes. E2E_CHANGED_PATHS (a comma list) stands in for the git diff against E2E_BASE (default origin/main), for a dry run and for tests.
export function changed_piece_files(env) {
  const paths = env.E2E_CHANGED_PATHS ? env.E2E_CHANGED_PATHS.split(",") : changed_paths_since(env.E2E_BASE || "origin/main");
  return new Set(select_piece_files(paths, read_piece_file_areas()).files);
}
