// What the pieces of the default kind share: the start every one makes and the Views folder the command line pieces need.

import { folder_shown } from "../predicates.mjs";

// The piece a default section is. `setup` runs after the shared start and before the section's own checks, for the state the section leaned on from the sections that ran before it in one long run.
export function section_piece({ section, only = [], setup = null, run }) {
  return {
    kind: "default",
    section,
    toast_seed: true,
    only,
    run: async (instance, ctx) => {
      const start = await open_inbox_checked(instance, ctx);
      await setup?.(instance, ctx);
      await run(instance, ctx, start);
      const { wait_stats } = ctx;
      ctx.note(ctx.app, ctx.kind, "polled waits", `${wait_stats.count} waits took ${(wait_stats.ms / 1000).toFixed(1)} s in total, ${wait_stats.timeouts} timed out`);
    },
  };
}

// Opens the Inbox with keys and checks that both add-ons are up. Returns the helper state at that point.
export async function open_inbox_checked(instance, ctx) {
  const { app, kind, check, shot } = ctx;
  const opened = await ctx.open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  const start = await instance.ask("state");
  check(app, kind, "helper add-on and DesertBird both enabled", start.desertbird_enabled === true);
  await shot("inbox_opened");
  return start;
}

// The command line checks work in the Views folder. A piece run alone starts in the Inbox, where Betterbird has the last row selected and Down cannot move, so the helper shows Views first.
export async function ensure_views_folder(instance, ctx) {
  const { app, kind, check, wait_for_state } = ctx;
  const state = await instance.ask("state");
  if (state.mail_tab?.folder === "/Views") return;
  const prepared = await instance.ask("prepare_views", 30000);
  const shown = (await wait_for_state(instance, folder_shown("/Views"))).mail_tab?.folder;
  check(app, kind, "the helper shows the Views folder before the command line checks", prepared.prepared === true && shown === "/Views", prepared.error ?? `folder ${shown}`);
}
