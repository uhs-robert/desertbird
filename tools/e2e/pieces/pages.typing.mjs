// The pages kind, typing keys in a page tab and the quick filter (see typing_checks.mjs).
import { run_typing } from "../typing_checks.mjs";

export const areas = ["pages", "tabs"];

export const piece = {
  kind: "pages",
  section: "typing",
  run: (instance, ctx) => run_typing(instance, ctx),
};
