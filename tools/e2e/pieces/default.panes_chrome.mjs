import { run_pane_moves, run_resize_mode } from "../panes_checks.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["panes"];

// The relative pane keys (H, L, Alt+h, Alt+l) and the resize mode (w r): the hooks of panes_checks.mjs.
async function run_panes_chrome(instance, ctx) {
  await run_pane_moves(instance, ctx);
  await run_resize_mode(instance, ctx);
}

export const piece = section_piece({ section: "panes_chrome", only: ["panes"], run: run_panes_chrome });
