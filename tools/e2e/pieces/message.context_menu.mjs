// The context menu key in a message window opened after the app started (see context_checks.mjs).
import { run_context_menu_message_window } from "../context_checks.mjs";

export const areas = ["context_menu"];

export const piece = { kind: "message", section: "context_menu", profile_kind: "message", run: run_context_menu_message_window };
