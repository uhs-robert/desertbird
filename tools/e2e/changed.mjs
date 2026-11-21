// node tools/e2e/changed.mjs [base [head]] | --paths a,b: the dry run of a changed-only run. Prints the choice on stderr and the comma-separated piece names on stdout (empty for none), and runs nothing.
// It sits apart from areas.mjs because registry.mjs imports areas.mjs, and this file imports both.
import { changed_paths_since, read_piece_file_areas, select_piece_files } from "./areas.mjs";
import { load_pieces } from "./registry.mjs";

const [first = "origin/main", head] = process.argv.slice(2);
const by_paths = first === "--paths";
const paths = by_paths ? (head ?? "").split(",").filter(Boolean) : changed_paths_since(first, head);
const { src_paths, areas, files } = select_piece_files(paths, read_piece_file_areas());
const runnable = (await load_pieces()).filter((piece) => !piece.opt_in);
const names = runnable.filter((piece) => files.includes(piece.file)).map((piece) => piece.name);
console.error(`e2e-changed: against ${by_paths ? "the given paths" : first}: ${paths.length} changed path(s), ${src_paths.length} in src; areas: ${areas.join(", ") || "none"}`);
console.error(`e2e-changed: ${names.length} of ${runnable.length} pieces: ${names.join(", ")}`);
console.log(names.join(","));
