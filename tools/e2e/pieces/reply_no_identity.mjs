// The kind with no identity: the New Message button is disabled, a reply has no sender, and the toasts say so.

import { sleep, first_selected, at_bottom } from "../predicates.mjs";

async function run_no_identity(instance, ctx) {
  const { report, check, open_inbox, expect_absent, key_and_state, toast_cycle } = ctx;
  const app = instance.app;
  const kind = "reply_no_identity";
  const shot = async (name, line) => { const path = await instance.shot(`${app}_${name}`); report.shots.push({ app, kind, path, name, line }); return path; };
  const opened = await open_inbox(instance, 6);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  await instance.press(["g"]);
  let state = await key_and_state(instance, ["g"], { what: "g g to select the first row", until: (current) => first_selected(current) !== null && first_selected(current) === current.listed[0], show: (current) => `selected ${first_selected(current)}` });
  check(app, kind, "g g selects the first row", first_selected(state) !== null);
  // One message, so the refusal is the identity one and not the "select one message" one.
  await key_and_state(instance, ["G"], at_bottom);
  const refused_r = await toast_cycle(instance, `${app}_r`, ["r"]);
  state = refused_r.state;
  check(app, kind, "r with no identity shows the refusal as a toast", refused_r.shown, `selected ${state.selected.length}`);
  check(app, kind, "the toast of r is gone after toast_error_ms", refused_r.gone);
  check(app, kind, "r with no identity opens no compose window", !state.windows.some((window) => window.type === "messageCompose"));
  check(app, kind, "r with no identity does not crash the app", instance.exited() === null);
  // Forward and new refuse the same way. Unguarded, forward hangs with no window and new opens a window that cannot send, so the missing window is the proof for new.
  // The headless session logs the libnotify warning for the first notification only, so these two checks cannot see the refusal itself. The unit tests do.
  for (const [name, keys] of [["g F", ["g", "F"]], ["c", ["c"]]]) {
    for (const key of keys) await instance.press([key]);
    await expect_absent(instance, `${name} with no identity opens no compose window`, (current) => (current.windows.some((window) => window.type === "messageCompose") ? `selected ${current.selected.length}` : null), { margin_ms: 4000, in_list: true });
    check(app, kind, `${name} with no identity does not crash the app`, instance.exited() === null);
  }
  await shot("refusal", "mail window after r with no identity; the refusal notification should show");
  await sleep(2000);
  await shot("refusal_later", "same window two seconds later");
}

export const piece = {
  kind: "reply_no_identity",
  section: "main",
  toast_seed: true,
  run: (instance, ctx) => run_no_identity(instance, ctx),
};
