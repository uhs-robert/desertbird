// The mode label of the classic style in the Inbox: normal, visual and insert mode, and the quick filter. The three style pieces (`mode_label.mjs`) reuse its checks.
import { run_mode_label } from "./_mode_label.mjs";
import { section_piece } from "./_default_shared.mjs";

export const piece = section_piece({ section: "mode_label", only: ["mode_label"], run: run_mode_label });
