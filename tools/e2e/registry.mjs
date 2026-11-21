// The pieces of the e2e run and the choice of which ones run. A piece is one (kind, section): one fresh profile, one app start, one set of checks. Its name is `<kind>/<section>`, and with the app `<app>/<kind>/<section>`.
// Each file in pieces/ exports `piece` or `pieces`. A file whose name starts with `_` is shared code and holds no piece.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The kinds of a run with no E2E_KINDS, in the order they run.
export const DEFAULT_KINDS = ["default", "reply_no_identity", "mail_account", "message", "message_remote", "quick_reply_plain", "quick_reply_html", "mode_label_badge", "mode_label_off", "mode_label_themed", "own_pages", "pages", "zoom", "web", "compose_editor", "compose_editor_html", "compose_editor_html_top"];

// The piece deadline of the pieces that run longer than the default 120 s allows (`deadline_s` on the piece). A unit test fails when a piece's weight times 1.5 passes its deadline.
export const LONG_PIECE_DEADLINE_S = 250;

const pieces_dir = join(import.meta.dirname, "pieces");

// Loads every piece, each with its `name` set. Throws on a duplicate name.
export async function load_pieces(dir = pieces_dir) {
  const loaded = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".mjs") && !name.startsWith("_")).sort()) {
    const exported = await import(pathToFileURL(join(dir, file)).href);
    for (const piece of exported.pieces ?? [exported.piece]) loaded.push({ ...piece, name: `${piece.kind}/${piece.section}`, file });
  }
  const seen = new Set();
  for (const piece of loaded) {
    if (seen.has(piece.name)) throw new Error(`two pieces are named ${piece.name}`);
    seen.add(piece.name);
  }
  return loaded;
}

// The pieces a run takes, in run order, from the three env settings.
// E2E_KINDS is a comma list of kinds and takes every piece of each, apart from the opt-in ones. E2E_ONLY is a comma list of section names or aliases and narrows the chosen kinds to the pieces that carry one of them (an opt-in piece runs only when named). E2E_SCALE=1 takes the scale piece alone. A name that matches nothing throws and lists the valid ones.
export function select_pieces(pieces, env = {}) {
  const { E2E_KINDS, E2E_ONLY, E2E_SCALE } = env;
  if (E2E_SCALE === "1") return pieces.filter((piece) => piece.name === "default/scale");
  const kinds = E2E_KINDS ? E2E_KINDS.split(",") : DEFAULT_KINDS;
  const known_kinds = [...new Set(pieces.map((piece) => piece.kind))];
  const unknown_kinds = kinds.filter((kind) => !known_kinds.includes(kind));
  if (unknown_kinds.length) throw new Error(`E2E_KINDS names no kind: ${unknown_kinds.join(", ")}. Kinds: ${known_kinds.join(", ")}`);
  const only = E2E_ONLY ? E2E_ONLY.split(",") : null;
  const names_of = (piece) => [piece.section, ...(piece.only ?? [])];
  if (only) {
    const valid = [...new Set(pieces.flatMap(names_of))];
    const unknown = only.filter((name) => !valid.includes(name));
    if (unknown.length) throw new Error(`E2E_ONLY names no section: ${unknown.join(", ")}. Names: ${valid.join(", ")}`);
  }
  const chosen = kinds.flatMap((kind) => pieces.filter((piece) => piece.kind === kind && (only ? names_of(piece).some((name) => only.includes(name)) : !piece.opt_in)));
  const unmet = chosen.find((piece) => piece.needs_env && env[piece.needs_env] !== "1");
  if (unmet) throw new Error(`${unmet.name} needs ${unmet.needs_env}=1 in the environment, which prepares its profile. Run it with ${unmet.needs_env}=1 alone.`);
  if (chosen.length === 0) throw new Error(`E2E_ONLY=${E2E_ONLY} matches no piece of the kinds ${kinds.join(", ")}`);
  return [...new Map(chosen.map((piece) => [piece.name, piece])).values()];
}
