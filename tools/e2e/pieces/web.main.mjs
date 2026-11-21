// The page actor in a web page (see web_checks.mjs). E2E_ONLY=web_hints narrows it inside web_checks.mjs.
import { run_web } from "../web_checks.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";

export const areas = ["web", "hints", "pages"];

export const piece = {
  kind: "web",
  section: "main",
  only: ["web_hints"],
  deadline_s: LONG_PIECE_DEADLINE_S,
  run: (instance, ctx) => run_web(instance, ctx),
};
