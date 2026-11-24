// The context menu key in a web page tab and in another add-on's page tab (see context_checks.mjs).
import { run_context_menu_pages } from "../context_checks.mjs";

export const areas = ["context_menu", "web"];

export const piece = { kind: "web", section: "context_menu", run: run_context_menu_pages };
