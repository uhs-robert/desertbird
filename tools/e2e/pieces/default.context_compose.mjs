// The context menu key in a compose window opened after the app started: body, To and Subject (see context_checks.mjs). Part of the default run.
import { run_context_menu_compose } from "../context_checks.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["context_menu", "compose"];

export const piece = section_piece({ section: "context_compose", only: ["context_compose"], run: (instance, ctx) => run_context_menu_compose(instance, ctx) });
