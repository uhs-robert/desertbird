// The context menu key in the mail tab: thread list, folder pane and message body (see context_checks.mjs). Part of the default run.
import { run_context_menu_mail_tab } from "../context_checks.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["context_menu"];

export const piece = section_piece({ section: "context_menu", only: ["context_menu"], run: (instance, ctx) => run_context_menu_mail_tab(instance, ctx) });
