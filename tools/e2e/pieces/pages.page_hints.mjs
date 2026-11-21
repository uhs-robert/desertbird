// The pages kind, `f` in the page tabs (see page_hints_checks.mjs).
import { run_page_hints } from "../page_hints_checks.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";

export const piece = {
  kind: "pages",
  section: "page_hints",
  only: ["page_hints"],
  deadline_s: LONG_PIECE_DEADLINE_S,
  run: (instance, ctx) => run_page_hints(instance, ctx),
};
