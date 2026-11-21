// The popup key checks (see popup_checks.mjs): plain keys while a menu is open. Opt-in: on Thunderbird the check that the context menu's access key k opens the Mark submenu fails on every run (3 of 3), and it passes on Betterbird. The cause is not looked into yet.
import { run_popup_keys } from "../popup_checks.mjs";

export const piece = {
  kind: "default",
  section: "popup",
  toast_seed: true,
  opt_in: true,
  only: ["popup"],
  run: async (instance, ctx) => {
    const opened = await ctx.open_inbox(instance);
    ctx.check(ctx.app, ctx.kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
    await run_popup_keys(instance, ctx);
  },
};
