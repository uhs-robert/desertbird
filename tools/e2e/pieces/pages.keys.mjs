// The pages kind, the keys of the page tabs (see pages_checks.mjs).
import { run_pages } from "../pages_checks.mjs";

export const piece = {
  kind: "pages",
  section: "keys",
  run: (instance, ctx) => run_pages(instance, ctx),
};
