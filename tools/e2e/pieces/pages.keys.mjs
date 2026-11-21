// The pages kind, the keys of the page tabs (see pages_checks.mjs).
import { run_pages } from "../pages_checks.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";

export const piece = {
  kind: "pages",
  section: "keys",
  deadline_s: LONG_PIECE_DEADLINE_S,
  run: (instance, ctx) => run_pages(instance, ctx),
};
