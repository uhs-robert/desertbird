// The scale fixture: step keys on a folder of 10,000 messages. Opt-in, because the fixture takes about a minute to read.

import { BIG_MESSAGES } from "../../measure/fixtures.mjs";
import { same } from "../predicates.mjs";

export const areas = ["motions"];

// Timing for the step keys on the scale fixture (E2E_SCALE=1: a folder of 10,000 messages, 3 of every 10 unread and 1 in 25 starred, plus 50 folders of 100). Each time is the wall time from the key to the selection change, polled through the light selection command.
async function run_scale(instance, ctx) {
  const { check, note, open_inbox, wait_state } = ctx;
  const app = instance.app;
  const kind = "default";
  const selection = () => instance.ask("selection", 60000);
  await open_inbox(instance);
  await instance.ask("show_folder", 20000, { path: "/Big" });
  // Thunderbird lists the folder only once it has read the whole mbox.
  await wait_state(instance, "/Big to list all its messages", (state) => state.mail_tab?.folder === "/Big" && state.listed.length >= BIG_MESSAGES, { timeout_ms: 60000, step_ms: 2000 });
  const timed = async (name, keys, expect = null) => {
    const before = await selection();
    for (const key of keys.slice(0, -1)) await instance.press([key]);
    const started = Date.now();
    await instance.press([keys.at(-1)]);
    let now = before;
    while (Date.now() - started < 40000 && same(now.ids, before.ids) && now.folder === before.folder) now = await selection();
    const elapsed = Date.now() - started;
    note(app, kind, `time ${name}`, `${elapsed} ms, now ${now.folder} ${now.ids.slice(0, 2).join(" ")}`);
    if (expect !== null) check(app, kind, `${name} selects ${expect}`, now.ids[0] === expect, `selected ${now.ids[0]}`);
    return now;
  };
  await instance.press(["g"]);
  await timed("g g", ["g"]);
  await timed("j (baseline)", ["j"]);
  await timed("] u (next unread, 1 row away)", ["]", "u"]);
  await timed("] s (next starred, up to 25 rows away)", ["]", "s"]);
  await timed("2000 ] u (a pass over 6,000 rows)", ["2", "0", "0", "0", "]", "u"]);
  await timed("] U with unread rows ahead", ["]", "U"]);
  await timed("G", ["G"]);
  await timed("] U from the last row (no unread ahead: folder counts, then one query)", ["]", "U"]);
  await timed("[ U back across folders", ["[", "U"]);
}

export const piece = {
  kind: "default",
  section: "scale",
  toast_seed: true,
  opt_in: true,
  // profile.mjs reads E2E_SCALE itself to add the Big folder, so a run that names this piece without it would use a profile with no Big folder. The registry refuses that.
  needs_env: "E2E_SCALE",
  run: (instance, ctx) => run_scale(instance, ctx),
};
