// The zoom keys in the mail tab (see zoom_checks.mjs).
import { run_zoom } from "../zoom_checks.mjs";

export const areas = ["zoom"];

export const piece = {
  kind: "zoom",
  section: "main",
  run: (instance, ctx) => run_zoom(instance, ctx),
};
