// The kind with a POP3 account that has a main and an alias identity.

import { selects, compose_opens, mail_window_ready } from "../predicates.mjs";

export const areas = ["compose", "mail_keys"];

// A default POP3 account with the identities "id2" (main) and "id3" (alias), plus Local Folders with none. A message of Local Folders borrows the default account's identity, and a message addressed to the alias keeps the alias.
async function run_mail_account(instance, ctx) {
  const { check, wait_for_state, key_and_state, close_compose } = ctx;
  const app = instance.app;
  const kind = "mail_account";
  const compose_identity = (state) => state.windows.find((window) => window.type === "messageCompose")?.tabs.find((tab) => tab.identity_id)?.identity_id ?? null;
  await wait_for_state(instance, mail_window_ready);
  await instance.press(["-k", "F6"]);
  const cases = [
    ["Local Folders message", "inbox-s2@fixture.invalid", [["r"], "r", "id2"], [["g", "F"], "g F", "id2"]],
    ["mail account message to the main identity", "mail-plain@fixture.invalid", [["r"], "r", "id2"], [["g", "F"], "g F", "id2"]],
    ["mail account message to the alias identity", "mail-alias@fixture.invalid", [["r"], "r", "id3"], [["g", "F"], "g F", "id3"]],
  ];
  for (const [label, header_id, ...keys] of cases) {
    for (const [presses, name, expected] of keys) {
      await instance.ask(`select:${header_id}`, 30000);
      const selected = selects(header_id);
      await wait_for_state(instance, selected);
      for (const key of presses.slice(0, -1)) await instance.press([key]);
      const state = await key_and_state(instance, [presses.at(-1)], compose_opens((tab) => Boolean(tab.identity_id)));
      check(app, kind, `${name} on a ${label} composes from identity ${expected}`, compose_identity(state) === expected, `compose identity ${compose_identity(state)}, selected ${state.selected.map((message) => message.header_id)}`);
      await close_compose(instance);
    }
  }
  check(app, kind, "the app survived", instance.exited() === null);
}

export const piece = {
  kind: "mail_account",
  section: "main",
  run: (instance, ctx) => run_mail_account(instance, ctx),
};
