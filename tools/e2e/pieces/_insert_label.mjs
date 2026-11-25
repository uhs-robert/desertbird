// The checks of insert mode (`i`, then Escape) in a pane of the main window or in a message window, read from the mode label strip. The label is an element of the window, so a check reads its pixels, as `_mode_label.mjs` does.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { holds_twice, drawn_since, back_to } from "../predicates.mjs";
import { LABEL_STRIP } from "./_mode_label.mjs";

// `region` is the label strip of the window under test: the main window's by default, a message window's when the caller passes it.
export function insert_label(instance, ctx, region = LABEL_STRIP) {
  const { app, kind, wait_pixels } = ctx;
  const strip_of = async (name) => createHash("sha256").update(readFileSync(await instance.shot_region(`${app}_${kind}_insert_${name}`, region))).digest("hex");
  const poll = (what, until) => wait_pixels(instance, what, `${app}_${kind}_insert_poll`, region, until, { timeout_ms: 5000 });
  return {
    // The label in normal mode, once the strip holds still.
    async normal() {
      await poll("the strip to hold still", holds_twice());
      return strip_of("normal");
    },
    // Presses `enter_key` (`i` by default) and returns the strip once it differs from `normal`.
    async enter(normal, enter_key = "i") {
      await instance.press([enter_key]);
      await poll(`${enter_key} to change the label`, drawn_since(normal));
      return strip_of("insert");
    },
    // Presses Escape (or `leave_keys`) and returns the strip once it is back to `normal`, or what it holds when the wait ends. With `leave_keys` null it presses nothing, for a caller that moved the focus by a click.
    async leave(normal, leave_keys = ["-k", "Escape"]) {
      if (leave_keys) await instance.press(leave_keys);
      await poll("Escape to bring the label back", back_to(normal));
      return strip_of("after");
    },
  };
}
