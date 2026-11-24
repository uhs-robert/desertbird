// f with the focus in a message body: one label set over the message header and the body, in the reading pane, a message tab and a message window. In a message tab f with the focus in the header labels the same set.

import { sleep, selects, flag_becomes, main_window_tabs, holds_twice, drawn_since, back_to } from "../predicates.mjs";
import { LONG_PIECE_DEADLINE_S } from "../registry.mjs";

export const areas = ["hints", "message_body"];

const HEADER_ID = "header-0@fixture.invalid";

const body_state = (state) => state.body ?? { live: false, scroll_y: -1, inner_height: 0 };

const scroll_is = (what, until) => ({ what, until: (state) => until(body_state(state)), show: (state) => `scrollY ${body_state(state).scroll_y}` });

// A document has reported once the helper holds a report from it that started after `since`. `from_target` picks the reading pane, a message tab or a message window by the sender of the report.
const body_reports = (what, since, from_target) => ({ what: `the document of ${what} to report`, until: (state) => state.body !== null && state.body.doc_start >= since && from_target(state, state.body), show: (state) => `body of tab ${state.body?.tab_id}, window ${state.body?.window_id}, started ${state.body?.doc_start}`, timeout_ms: 10000 });

const in_pane = (state, body) => body.tab_id === state.mail_tab?.id && (body.text_start ?? "").includes(" of header-0.");
const in_tab = (state, body) => body.tab_id === main_window_tabs(state).find((tab) => tab.type === "messageDisplay")?.id;
const in_window = (state, body) => body.window_id === state.windows.find((window) => window.type === "messageDisplay")?.id;

// `since` asks for a report sent after that time, so a report from before a key cannot pass.
const body_focus_is = (focused, since = 0) => ({ what: `the focus to ${focused ? "be in" : "leave"} the body`, until: (state) => body_state(state).has_focus === focused && (body_state(state).reported_at ?? 0) >= since, show: (state) => `has_focus ${body_state(state).has_focus}, reported_at ${body_state(state).reported_at}`, timeout_ms: 5000 });

const window_of_type = (type, present) => ({ what: `a ${type} window to ${present ? "open" : "close"}`, until: (state) => state.windows.some((window) => window.type === type) === present, show: (state) => JSON.stringify(state.windows.map((window) => window.type)), timeout_ms: 15000 });

async function run_header_hints(instance, ctx) {
  const { app, kind, shot, check, note, open_inbox, wait_for_state, key_and_state, wait_pixels } = ctx;
  const labels = MESSAGE_HINT_LABELS[app];
  const window_pixels = (name, until, options) => wait_pixels(instance, name, `${app}_header_hints_${name.replaceAll(" ", "_")}`, WINDOW_REGION, until, { timeout_ms: 5000, ...options });
  // Presses the keys that start a pick and waits for the labels to draw. Returns the pixels before and with the labels.
  const show_labels = async (keys = ["f"]) => {
    const before = await window_pixels("the window before the labels", holds_twice());
    for (const key of keys) await instance.press([key]);
    return { before, labelled: await window_pixels("the labels to draw", drawn_since(before)) };
  };
  // One label typed in full, a letter per press, as the user types it.
  const pick = async (label, keys) => {
    await show_labels(keys);
    for (const letter of label) await instance.press([letter]);
  };
  const flagged = (state) => state.flags[HEADER_ID]?.flagged === true;

  const opened = await open_inbox(instance);
  check(app, kind, "open the Inbox with keys", opened === "/Inbox", `displayed folder ${opened}`);
  const since = Date.now();
  await instance.ask(`select:${HEADER_ID}`, 30000);
  let state = await wait_for_state(instance, body_reports("the header message", since, in_pane));
  await instance.press(["-k", "F6"]);
  await sleep(500);

  // The reading pane: header and body labels in one set, drawn in the dark scheme of this profile.
  await show_labels();
  await shot("header_hints_pane", "f in the message body: labels over the header buttons, the star, the addresses, the tag, the attachment bar and the body link");
  // j starts no label, so it ends them and is swallowed. Escape then has no labels to end and goes to Thunderbird.
  const scroll_before = body_state(await instance.ask("state")).scroll_y;
  await instance.press(["j"]);
  await instance.press(["-k", "Escape"]);
  await sleep(500);
  state = await instance.ask("state");
  check(app, kind, "header hints: j and Escape with the labels up scroll nothing and flag nothing", body_state(state).scroll_y === scroll_before && !flagged(state), `scrollY ${scroll_before} then ${body_state(state).scroll_y}, flagged ${flagged(state)}`);
  await shot("header_hints_ended", "after j and Escape: no labels left");
  // The whole gesture in one burst. The body drops plain keys from f until the parent answers, and the parent answers once its labels own the keys, so neither c opens a compose window.
  await instance.press(["fcc"]);
  await sleep(3000);
  state = await instance.ask("state");
  check(app, kind, "header hints: f c c in one burst opens no compose window", !state.windows.some((window) => window.type === "messageCompose"), JSON.stringify(state.windows.map((window) => window.type)));
  // Both c can land before the labels draw, and the body drops them, so the labels may still show. Escape ends them.
  await instance.press(["-k", "Escape"]);
  await sleep(500);

  // The star of the header flags the shown message.
  await pick(labels.star);
  state = await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", true));
  check(app, kind, "header hints: the star label flags the message", flagged(state), `flagged ${flagged(state)}`);
  await pick(labels.star);
  await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", false));

  // The day/night switch: the body turns light, and a second pick turns it back.
  const dark_body = await window_pixels("the dark body to hold still", holds_twice());
  await pick(labels.dark);
  await sleep(1000);
  const light_body = await window_pixels("the body after the switch", holds_twice());
  await shot("header_hints_dark_switch", "after the day/night switch label: the body shows its own light colors");
  check(app, kind, "header hints: the day/night switch label changes the body", light_body !== dark_body, "the window did not change");
  await pick(labels.dark);
  const back = await window_pixels("the body to turn dark again", back_to(dark_body));
  check(app, kind, "header hints: a second pick of the switch turns the body back", back === dark_body, "the window differs from the start");

  // More opens its menu. Escape closes it, and the keys go on in the body.
  await pick(labels.more);
  await sleep(1000);
  await shot("header_hints_more", "after the More label: the More menu is open");
  await instance.press(["-k", "Escape"]);
  await sleep(800);
  const top = body_state(await instance.ask("state")).scroll_y;
  state = await key_and_state(instance, ["j"], scroll_is("j to scroll the body after the menu", (body) => body.scroll_y > top));
  check(app, kind, "header hints: after More and Escape, j scrolls the body", body_state(state).scroll_y > top, `scrollY ${top} then ${body_state(state).scroll_y}`);
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], scroll_is("g g to the top", (body) => body.scroll_y === 0));

  // The sender's address opens its address menu.
  await pick(labels.from);
  await sleep(1000);
  await shot("header_hints_address", "after the sender label: the address menu is open");
  await instance.press(["-k", "Escape"]);
  await sleep(800);

  // ; y labels only the targets with text. On the tag it copies the tag's name.
  await instance.ask("clear_clipboard");
  await show_labels([";", "y"]);
  await shot("header_hints_yank", "after ; y: labels only on the addresses, the tag, the attachment bar and the body link");
  for (const letter of labels.tag_yank) await instance.press([letter]);
  await sleep(800);
  const clipboard = (await instance.ask("read_clipboard")).text;
  check(app, kind, "header hints: ; y on the tag copies its name", clipboard === "Important", `clipboard ${JSON.stringify(clipboard)}`);

  // Reply opens a compose window.
  await pick(labels.reply);
  state = await wait_for_state(instance, window_of_type("messageCompose", true));
  check(app, kind, "header hints: the reply label opens a compose window", state.windows.some((window) => window.type === "messageCompose"), JSON.stringify(state.windows.map((window) => window.type)));
  await instance.ask("close_compose");
  await wait_for_state(instance, window_of_type("messageCompose", false));
  await sleep(800);

  // The attachment toggle opens the list and Thunderbird puts the focus in it, with the first attachment selected. Back in the body, the label of the second attachment selects that one.
  await pick(labels.attachment_toggle);
  await sleep(1000);
  await instance.press(["-M", "shift", "-k", "F6", "-m", "shift"]);
  await sleep(300);
  await instance.press(["-k", "F6"]);
  await sleep(500);
  // Only the second item's own box: the pick also moves the focus into the list, which redraws the first item, so a whole-window change would pass with the wrong selection.
  const second_item = (name, until) => wait_pixels(instance, name, `${app}_header_hints_${name.replaceAll(" ", "_")}`, SECOND_ATTACHMENT_REGION[app], until, { timeout_ms: 5000 });
  const unselected = await second_item("the second attachment to hold still", holds_twice());
  await show_labels();
  await shot("header_hints_attachment_labels", "f with the attachment list open: a label on each attachment");
  for (const letter of labels.second_attachment) await instance.press([letter]);
  await sleep(800);
  const selected = await second_item("the second attachment to show as selected", drawn_since(unselected));
  await shot("header_hints_attachment", "after the label of the second attachment: it is selected and the list has the focus");
  check(app, kind, "header hints: the label of the second attachment selects it", selected !== unselected, "the second attachment's box did not change");

  // A message tab: the star flags the tab's message, and the body link opens in one step.
  await instance.ask(`select:${HEADER_ID}`, 30000);
  await wait_for_state(instance, selects(HEADER_ID));
  const tab_requested = Date.now();
  await instance.ask("open_message_tab");
  await wait_for_state(instance, body_reports("the message tab", tab_requested, in_tab));
  await sleep(500);
  await show_labels();
  await shot("header_hints_tab", "f in a message tab: the same labels over the header and the body link");
  await instance.press(["-k", "Escape"]);
  await sleep(500);
  await pick(labels.star);
  state = await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", true));
  check(app, kind, "header hints: in a message tab the star label flags the tab's message", flagged(state), `flagged ${flagged(state)}`);
  await pick(labels.link);
  state = await wait_for_state(instance, scroll_is("the link to scroll to the end of the mail", (body) => body.scroll_y > 2 * body.inner_height));
  check(app, kind, "header hints: in a message tab the body link label opens the link in one step", body_state(state).scroll_y > 2 * body_state(state).inner_height, `scrollY ${body_state(state).scroll_y}`);
  await pick(labels.star);
  await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", false));

  // The header of a message tab: F6 takes the focus out of the body, and the header keys of the pages bundle send hint.window, which labels the same set. The star pick clicks and moves no focus, so the body still has it. Only a report sent after F6 counts, so an older blur cannot pass the wait.
  state = await wait_for_state(instance, body_focus_is(true));
  check(app, kind, "header hints: the message tab's body holds the focus before F6", body_state(state).has_focus === true, `has_focus ${body_state(state).has_focus}`);
  const f6_at = Date.now();
  await instance.press(["-k", "F6"]);
  state = await wait_for_state(instance, body_focus_is(false, f6_at));
  check(app, kind, "header hints: F6 takes the focus out of the message tab's body", body_state(state).has_focus === false && body_state(state).reported_at >= f6_at, `has_focus ${body_state(state).has_focus}, reported ${body_state(state).reported_at - f6_at} ms after F6`);
  await shot("header_hints_tab_header_focus", "message tab after F6: the focus sits in the header, no labels");
  await show_labels();
  await shot("header_hints_tab_header", "f in a message tab with the focus in the header: the same labels over the header and the body");
  await instance.press(["-k", "Escape"]);
  await sleep(500);
  // The pages bundle holds plain keys from f until the labels take them, so neither c opens a compose window.
  await instance.press(["fcc"]);
  await sleep(3000);
  state = await instance.ask("state");
  check(app, kind, "header hints: f c c in one burst from the header opens no compose window", !state.windows.some((window) => window.type === "messageCompose"), JSON.stringify(state.windows.map((window) => window.type)));
  await instance.press(["-k", "Escape"]);
  await sleep(500);
  await pick(labels.star);
  state = await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", true));
  check(app, kind, "header hints: from the header of a message tab the star label flags the message", flagged(state), `flagged ${flagged(state)}`);
  // The pages bundle holds plain keys for 1.5 s after f, past the end of the labels, so the next f waits it out.
  await sleep(1600);
  await pick(labels.star);
  await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", false));
  await instance.ask("reset_tabs");
  await sleep(800);

  // A message window: f from the body labels the header and the body as one set.
  const window_requested = Date.now();
  await instance.ask("open_message_window");
  await wait_for_state(instance, body_reports("the message window", window_requested, in_window));
  await sleep(500);
  await show_labels();
  await shot("header_hints_window", "f in a message window: labels over the header buttons, the star, the addresses, the tag, the attachment bar and the body link");
  await instance.press(["-k", "Escape"]);
  await sleep(500);
  await pick(labels.star);
  state = await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", true));
  check(app, kind, "header hints: in a message window the star label flags the message", flagged(state), `flagged ${flagged(state)}`);
  await pick(labels.star);
  await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", false));
  await pick(labels.link);
  state = await wait_for_state(instance, scroll_is("the link to scroll the message window to the end", (body) => body.scroll_y > 2 * body.inner_height));
  check(app, kind, "header hints: in a message window the body link label opens the link in one step", body_state(state).scroll_y > 2 * body_state(state).inner_height, `scrollY ${body_state(state).scroll_y}`);
  await instance.press(["g"]);
  await key_and_state(instance, ["g"], scroll_is("g g to the top of the message window", (body) => body.scroll_y === 0));
  // The header of the window runs message mode from the pages bundle: f there sends hint.window and labels the same set.
  const window_f6_at = Date.now();
  await instance.press(["-k", "F6"]);
  state = await wait_for_state(instance, body_focus_is(false, window_f6_at));
  check(app, kind, "header hints: F6 takes the focus out of the message window's body", body_state(state).has_focus === false, `has_focus ${body_state(state).has_focus}`);
  await sleep(1600);
  const window_header = await show_labels();
  await shot("header_hints_window_header", "f in a message window with the focus in the header: the same labels over the header and the body");
  check(app, kind, "header hints: f in a message window header draws labels", window_header.labelled !== window_header.before, "the window did not change");
  await instance.press(["-k", "Escape"]);
  await sleep(1600);
  await pick(labels.star);
  state = await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", true));
  check(app, kind, "header hints: from the header of a message window the star label flags the message", flagged(state), `flagged ${flagged(state)}`);
  await sleep(1600);
  await pick(labels.star);
  await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", false));
  await sleep(1600);
  // The window closes with its header labels up. f in the main window then starts a new set there.
  await show_labels();
  await instance.ask("close_message_windows");
  await wait_for_state(instance, window_of_type("messageDisplay", false));
  await sleep(800);
  await shot("header_hints_after_window_close", "the main window after the message window closed with its labels up");
  const main_labels = await show_labels();
  await shot("header_hints_main_after_close", "f in the main window after the message window closed with its labels up: a new set");
  check(app, kind, "header hints: after a message window closed with its labels up, f in the main window draws labels", main_labels.labelled !== main_labels.before, "the main window did not change");
  for (const letter of labels.main_star) await instance.press([letter]);
  state = await wait_for_state(instance, flag_becomes(HEADER_ID, "flagged", true));
  check(app, kind, "header hints: after a message window closed with its labels up, the main window's star label flags the message", flagged(state), `flagged ${flagged(state)}`);
  note(app, kind, "header hints: labels used", JSON.stringify(labels));
  check(app, kind, "the app survived the header hint checks", instance.exited() === null);
}

// The labels sit in document order: the header buttons, More, the star, the address pills, the day/night switch, the tag, the attachment bar (the toggle and Save All), the attachments when the list is open, then the body link. Betterbird has one button more (Headers). A yank labels only the targets with text: More, the pills, the tag and the link. `main_star` is the star of the reading pane in the mail window's own set, with the thread list focused. Read from the shots of each app.
const MESSAGE_HINT_LABELS = {
  betterbird: { reply: "aa", more: "ak", star: "al", from: "sa", dark: "sg", tag_yank: "h", attachment_toggle: "sj", second_attachment: "da", link: "sl", main_star: "gh" },
  thunderbird: { reply: "aa", more: "aj", star: "ak", from: "al", dark: "sf", tag_yank: "h", attachment_toggle: "sh", second_attachment: "sl", link: "sk", main_star: "fg" },
};

const WINDOW_REGION = "0,0 1280x720";

// The box of the second attachment in the open list, inside its selection frame. Read from the shots of each app.
const SECOND_ATTACHMENT_REGION = { betterbird: "484,668 160x22", thunderbird: "786,668 158x22" };

export const piece = { kind: "message", section: "header_hints", profile_kind: "message_header", deadline_s: LONG_PIECE_DEADLINE_S, run: run_header_hints };
