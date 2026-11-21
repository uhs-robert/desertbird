// Quick replies, plain and HTML. The seeded slots are in the xpi each piece installs (see `seed_storage`).

import { compose_opens, compose_tab, reply_is_loaded, mail_window_ready, selects_inbox_s2 } from "../predicates.mjs";
import { QUICK_REPLY_SEED } from "../seed.mjs";

async function run_quick_replies(instance, ctx) {
  const { report, check, note, wait_for_state, key_and_state, close_compose, toast_cycle } = ctx;
  const app = instance.app;
  const kind = instance.kind;
  await wait_for_state(instance, mail_window_ready);
  await instance.press(["-k", "F6"]);
  await instance.ask("select:inbox-s2@fixture.invalid", 30000);
  await wait_for_state(instance, selects_inbox_s2);
  await instance.press(["g"]);
  await instance.press(["r"]);
  let state = await key_and_state(instance, ["1"], compose_opens((tab) => reply_is_loaded(tab) && tab.body.includes("Quick reply one.")));
  const tab = compose_tab(state);
  const body = tab?.body ?? "";
  const at_text = body.indexOf("Quick reply one.");
  const at_quote = body.indexOf("Body of inbox-s2.");
  const at_signature = body.indexOf("E2E signature line");
  check(app, kind, "g r 1 opens a reply to the sender with the slot text", tab?.subject?.startsWith("Re: ") === true && at_text >= 0, `subject ${JSON.stringify(tab?.subject)}, body ${JSON.stringify(body)}`);
  check(app, kind, "the slot text sits above the quote and the quote survives", at_text >= 0 && at_quote > at_text, `text at ${at_text}, quote at ${at_quote}`);
  check(app, kind, "the compose is plain or HTML as the identity says", tab?.is_plain === (kind === "quick_reply_plain"), `isPlainText ${tab?.is_plain}`);
  if (kind === "quick_reply_html") check(app, kind, "markup in the slot text is escaped and not live", /&lt;b&gt;line&lt;\/b&gt;/.test(tab?.html ?? "") && !/<b>line/.test(tab?.html ?? ""), `html ${JSON.stringify(tab?.html)}`);
  check(app, kind, "the signature survives below the quote", at_signature > at_quote, `quote at ${at_quote}, signature at ${at_signature}`);
  check(app, kind, "a blank line separates the slot text from the cite line", /line<\/b>\.\n\n+On /.test(body), `body ${JSON.stringify(body)}`);
  note(app, kind, "quick reply draft layout", `text at ${at_text}, quote at ${at_quote}, signature at ${at_signature} (-1 means absent), body ${JSON.stringify(body)}`);
  const quick_draft = await instance.ask("save_draft_raw", 30000);
  // An element of the label, even an empty one, would show as markup after the body of a saved HTML draft.
  const label_free = !/-- (INSERT|NORMAL) --/.test(quick_draft.raw ?? "") && (kind !== "quick_reply_html" || /<\/body>\s*<\/html>/.test(quick_draft.raw ?? ""));
  check(app, kind, "the mode label leaves no text and no element in the saved draft", /Quick reply one/.test(quick_draft.raw ?? "") && label_free, `draft ${JSON.stringify((quick_draft.raw ?? "").slice(-200))}`);
  report.shots.push({ app, kind, path: await instance.shot(`${app}_after_gr1_${kind}`), name: `after_gr1_${kind}`, line: "compose window with the quick reply above the quote" });
  await close_compose(instance);
  const refused_slot = await toast_cycle(instance, `${app}_gr2_${kind}`, ["2"], ["g", "r"]);
  check(app, kind, "g r 2 on an empty slot opens no compose window", !refused_slot.state.windows.some((window) => window.type === "messageCompose"));
  check(app, kind, "g r 2 on an empty slot shows the refusal as a toast", refused_slot.shown, "the toast strip differs while the toast shows");
  check(app, kind, "the toast of g r 2 is gone after toast_error_ms", refused_slot.gone, "the toast strip matches the strip from before");
  check(app, kind, "the app survived the quick reply keys", instance.exited() === null);
}

export const pieces = ["quick_reply_plain", "quick_reply_html"].map((kind) => ({
  kind,
  section: "main",
  toast_seed: true,
  seeds: { desertbird_quick_replies: { record_version: 1, slots: QUICK_REPLY_SEED } },
  run: (instance, ctx) => run_quick_replies(instance, ctx),
}));
