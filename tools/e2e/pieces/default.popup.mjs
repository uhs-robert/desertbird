// The popup key checks (see popup_checks.mjs): plain keys while a menu is open. Part of the default run.
import { run_popup_keys } from "../popup_checks.mjs";

export const piece = {
  kind: "default",
  section: "popup",
  toast_seed: true,
  only: ["popup"],
  run: async (instance, ctx) => {
    const opened = await ctx.open_inbox(instance);
    ctx.check(ctx.app, ctx.kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
    await run_popup_keys(instance, ctx);
  },
};
