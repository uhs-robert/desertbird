// The which-key panel, toasts and the help page.

import { COLLAPSED_ROWS } from "../fixture_rows.mjs";
import { ALT_QUESTION, sleep, selects, HUD_REGION, holds_twice, drawn_since, back_to, KEY_LIST_REGION, TOAST_EXPIRY_MS } from "../predicates.mjs";
import { section_piece } from "./_default_shared.mjs";

export const areas = ["hud", "theme"];

// The which-key panel, the root key list, a toast and the help page, in the Inbox with the thread list focused. The screenshots carry the E2E_THEME name. A panel is shown or gone when the window's pixels differ or match: the same selection and no panel draws the same window.
async function run_hud(instance, ctx) {
  const { app, kind, shot, check, wait_state, key_and_state, hud_pixels, wait_pixels } = ctx;
  const theme = process.env.E2E_THEME ?? "default";
  const pixels_of = (name) => hud_pixels(instance, `${app}_${name}_${theme}`);
  const poll = (what, name, until, options) => wait_pixels(instance, what, `${app}_${name}_${theme}`, HUD_REGION, until, { timeout_ms: 5000, ...options });
  const selection_of = (state) => state.selected.map((message) => message.header_id).join(",");
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], selects(COLLAPSED_ROWS[0]));
  // A toast from an earlier step lasts up to the toast time of the profile, and it would change the reference pixels when it expires.
  await sleep(TOAST_EXPIRY_MS);
  const bare = await poll("the strip to hold still before the panel", "hud_bare", holds_twice());
  // g is a prefix key: after the which-key delay (300 ms) the panel lists the keys that can follow.
  await instance.press(["g"]);
  const which_key = await poll("the which-key panel to show", "hud_which_key_pixels", drawn_since(bare));
  await shot(`hud_which_key_${theme}`, "the which-key panel after g: the keys that can follow");
  check(app, kind, "after g and the delay the which-key panel shows", which_key !== bare);
  await instance.press(["-k", "Escape"]);
  check(app, kind, "Escape after g closes the panel", (await poll("Escape to close the panel", "hud_after_escape", back_to(bare))) === bare);
  // The sequence completes while the panel shows: the panel goes and the command runs.
  await instance.press(["g"]);
  await poll("the which-key panel to show before the second g", "hud_before_complete", drawn_since(bare));
  await instance.press(["g"]);
  check(app, kind, "g then g with the panel up closes it", (await poll("g g to close the panel", "hud_after_complete", back_to(bare))) === bare);
  // A key that leads nowhere cancels the sequence before the delay: no panel ever shows. The key is x, which nothing binds, alone or after g (g s opens the Sent folder). A prefix key such as z would start a new sequence and show its own panel.
  // Nothing shows that a panel is not coming, so this keeps its fixed margin.
  await instance.press(["g"]);
  await instance.press(["x"]);
  await sleep(1500);
  check(app, kind, "g x before the delay shows no panel", (await pixels_of("hud_after_stray")) === bare);
  // Backspace goes back one key. After g p the panel shows the children of g p, and Backspace leaves the panel of g, which differs from no panel and from the panel of g p. The next g then completes g g from the kept g, so the panel goes. A Backspace that only ended the sequence would leave no panel.
  await instance.press(["g"]);
  await instance.press(["p"]);
  const panel_of_p = await poll("the panel of g p to show", "hud_panel_p", drawn_since(bare));
  await instance.press(["-k", "BackSpace"]);
  const after_backspace = await poll("Backspace to change the panel", "hud_after_backspace", drawn_since(panel_of_p));
  check(app, kind, "Backspace after g p leaves the panel of g", after_backspace !== bare && after_backspace !== panel_of_p);
  await instance.press(["g"]);
  check(app, kind, "g after that Backspace completes g g and closes the panel", (await poll("g to close the panel", "hud_backspace_complete", back_to(bare))) === bare);
  // J with only the main mail tab is refused, so a toast shows for toast_error_ms.
  await instance.press(["J"]);
  const toast = await poll("the toast of J to show", "hud_toast_pixels", drawn_since(bare));
  await shot(`hud_toast_${theme}`, "a toast: J with one tab is refused");
  check(app, kind, "a refused command shows a toast", toast !== bare);
  check(app, kind, "the toast is gone after toast_error_ms", (await poll("the toast of J to go", "hud_toast_gone", back_to(bare), { timeout_ms: TOAST_EXPIRY_MS + 2000 })) === bare);
  // The hud lets keys and clicks through. With a toast up, j still moves the list. With the which-key panel up, a key that is no continuation still runs as a first key.
  // q is a focus-only key, so it keeps its margin.
  await instance.press(["q"]);
  await sleep(800);
  const before_j = selection_of(await instance.ask("state"));
  await instance.press(["J"]);
  await poll("the toast of J to show before j", "hud_toast_before_j", drawn_since(bare));
  const moved = await key_and_state(instance, ["j"], { what: "j to move the list while the toast shows", until: (state) => selection_of(state) !== before_j, show: (state) => `selected ${selection_of(state)}` });
  check(app, kind, "j moves the list while a toast shows", selection_of(moved) !== before_j);
  // The pixels of the strip follow the selection from here on, so the toast has no baseline to return to, and nothing shows that it has gone.
  await sleep(TOAST_EXPIRY_MS);
  const before_g_j = selection_of(await instance.ask("state"));
  const before_panel = await poll("the strip to hold still before the second panel", "hud_before_panel_j", holds_twice());
  await instance.press(["g"]);
  await poll("the which-key panel to show before j", "hud_panel_before_j", drawn_since(before_panel));
  const moved_in_panel = await key_and_state(instance, ["j"], { what: "j to move the list while the which-key panel shows", until: (state) => selection_of(state) !== before_g_j, show: (state) => `selected ${selection_of(state)}` });
  check(app, kind, "j moves the list while the which-key panel shows", selection_of(moved_in_panel) !== before_g_j);
  // A click on a folder row, which sits under the hud box, reaches the folder pane. The row to click depends on which folder shows, so it is picked from the shown folder.
  const displayed = (await instance.ask("state")).mail_tab?.folder;
  await instance.press(["q"]);
  await sleep(800);
  // The click is tested with a toast up: the toast of an earlier step is gone, so J raises a new one.
  const before_toast = await poll("the strip to hold still before the toast", "hud_before_click_toast", holds_twice());
  await instance.press(["J"]);
  const click_toast_at = Date.now();
  await poll("the toast of J to show before the click", "hud_toast_before_click", drawn_since(before_toast));
  await instance.click(130, displayed === "/Views" ? 224 : 252);
  // The folder change is polled for up to 8 s, so a slow repaint is not a failure, while a click the hud swallows never changes the folder.
  const clicked = await wait_state(instance, "the click to change the folder", (state) => state.mail_tab !== null && state.mail_tab?.folder !== displayed, { timeout_ms: 8000, soft: true });
  const folder_after = clicked.mail_tab?.folder;
  check(app, kind, "a click under the toast reaches the folder pane", folder_after !== displayed, `displayed folder was ${displayed}, after ${folder_after}`);
  // The click moves the focus into the folder pane and loads the folder. Nothing shows when keys reach the runtime again, so this keeps a margin (keys pressed 1 s after the click went nowhere in measured runs).
  await sleep(2500);
  // Alt+? shows the root key list in the window (g? opens help). ? is a backward search. The new folder first draws its status text, so the list is compared with the strip once that holds still.
  // The toast of J lasts 3 s from its key and would sit in the baseline of the key list.
  await sleep(Math.max(0, TOAST_EXPIRY_MS - (Date.now() - click_toast_at)));
  const key_list_base = await wait_pixels(instance, "the key list region to hold still", `${app}_key_list_base_${theme}`, KEY_LIST_REGION, holds_twice(), { timeout_ms: 5000 });
  await instance.press(ALT_QUESTION);
  const key_list_shown = await wait_pixels(instance, "the key list to show", `${app}_key_list_shown_${theme}`, KEY_LIST_REGION, drawn_since(key_list_base), { timeout_ms: 5000 });
  await shot(`hud_key_list_${theme}`, "the root key list panel");
  await instance.press(["-k", "Escape"]);
  const key_list_gone = await wait_pixels(instance, "Escape to remove the key list", `${app}_key_list_gone_${theme}`, KEY_LIST_REGION, drawn_since(key_list_shown), { timeout_ms: 5000 });
  check(app, kind, "the next key after Alt+? removes the key list", key_list_gone !== key_list_shown);
  check(app, kind, "the app survived the hud keys", instance.exited() === null);
  // The click above moved the shown folder, and the steps after this one start in the Inbox.
  await instance.press(["g"]);
  await key_and_state(instance, ["i"], { what: "g i to show the Inbox", until: (state) => state.mail_tab?.folder === "/Inbox", timeout_ms: 10000 });
  // The click above put the focus in the folder pane, and g i opens a folder without moving it (probe, both apps: g g then selected no message, and Down moved the folder). g e returns it to the list, and has no state, so it keeps its margin.
  await instance.press(["g"]);
  await instance.press(["e"]);
  await sleep(1000);
}

export const piece = section_piece({ section: "hud", only: ["hud"], run: run_hud });
