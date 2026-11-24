// The checks of insert mode (`i`, then Escape) in a pane of the main window, read from the mode label strip. The label is an element of the window, so a check reads its pixels, as `_mode_label.mjs` does.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { holds_twice, drawn_since, back_to } from "../predicates.mjs";
import { LABEL_STRIP } from "./_mode_label.mjs";

export function insert_label(instance, ctx) {
  const { app, kind, wait_pixels } = ctx;
  const strip_of = async (name) => createHash("sha256").update(readFileSync(await instance.shot_region(`${app}_${kind}_insert_${name}`, LABEL_STRIP))).digest("hex");
  const poll = (what, until) => wait_pixels(instance, what, `${app}_${kind}_insert_poll`, LABEL_STRIP, until, { timeout_ms: 5000 });
  return {
    // The label in normal mode, once the strip holds still.
    async normal() {
      await poll("the strip to hold still", holds_twice());
      return strip_of("normal");
    },
    // Presses `i` and returns the strip once it differs from `normal`.
    async enter(normal) {
      await instance.press(["i"]);
      await poll("i to change the label", drawn_since(normal));
      return strip_of("insert");
    },
    // Presses Escape and returns the strip once it is back to `normal`, or what it holds when the wait ends.
    async leave(normal) {
      await instance.press(["-k", "Escape"]);
      await poll("Escape to bring the label back", back_to(normal));
      return strip_of("after");
    },
  };
}
