// Test-only add-on. It polls the e2e sink for a command and answers with state read through standard MailExtension APIs.
// config.js (written by the harness) defines SINK_URL. The command "reload_desertbird" switches DesertBird off and on, which is the
// outside way to restart an add-on: runtime.reload() itself only works from inside the add-on, and src/ takes no test hook.
const DESERTBIRD_ID = "desertbird@uhs-robert";

async function all_messages(first_page) {
  const found = [];
  let page = first_page;
  for (;;) {
    found.push(...page.messages);
    if (!page.id) return found;
    page = await browser.messages.continueList(page.id);
  }
}

const describe_message = (message) => ({
  header_id: message.headerMessageId,
  subject: message.subject,
  junk: message.junk,
  read: message.read,
  folder: message.folder?.path,
});

// into maps a folder path to its Message-IDs. flags maps a Message-ID to what the keys m, s, a and 1 would change, plus junk.
async function folder_contents(folders, into, flags) {
  for (const folder of folders) {
    const messages = await all_messages(await browser.messages.list(folder.id));
    into[folder.path] = messages.map((message) => message.headerMessageId);
    for (const message of messages) flags[message.headerMessageId] = { read: message.read, flagged: message.flagged, junk: message.junk, tags: message.tags };
    await folder_contents(folder.subFolders ?? [], into, flags);
  }
}

async function collect() {
  const state = { time: Date.now() };
  const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true }).catch(() => []);
  state.mail_tab = mail_tab ? { id: mail_tab.id, folder: mail_tab.displayedFolder?.path ?? null, message_pane_visible: mail_tab.messagePaneVisible, folder_pane_visible: mail_tab.folderPaneVisible, sort_type: mail_tab.sortType, sort_order: mail_tab.sortOrder } : null;
  state.selected = mail_tab ? (await all_messages(await browser.mailTabs.getSelectedMessages(mail_tab.id))).map(describe_message) : [];
  state.displayed = mail_tab ? (await browser.messageDisplay.getDisplayedMessages(mail_tab.id)).map((message) => ({ header_id: message.headerMessageId, subject: message.subject, date: new Date(message.date).getTime() })) : [];
  state.listed = mail_tab ? (await all_messages(await browser.mailTabs.getListedMessages(mail_tab.id))).map((message) => message.headerMessageId) : [];
  state.folders = {};
  state.flags = {};
  await folder_contents((await browser.accounts.list(true)).flatMap((account) => account.folders ?? []), state.folders, state.flags);
  const windows = await browser.windows.getAll({ populate: true });
  state.windows = [];
  for (const window of windows) {
    const entry = { id: window.id, type: window.type, tabs: [] };
    for (const tab of window.tabs ?? []) {
      const detail = window.type === "messageCompose" ? await browser.compose.getComposeDetails(tab.id).catch(() => null) : null;
      entry.tabs.push({ raw: tab, id: tab.id, index: tab.index, active: tab.active, type: tab.type, title: tab.title, identity_id: detail?.identityId ?? null, subject: detail?.subject ?? null, body: detail?.plainTextBody ?? detail?.body ?? null });
    }
    state.windows.push(entry);
  }
  const desertbird = await browser.management.get(DESERTBIRD_ID).catch(() => null);
  state.body = latest_body;
  state.desertbird_enabled = desertbird?.enabled ?? null;
  return state;
}

// With a folder path, the helper shows that folder while DesertBird is off, so DesertBird starts on a folder its stored history never saw.
async function reload_desertbird(show_path) {
  await browser.management.setEnabled(DESERTBIRD_ID, false);
  if (show_path) await show_folder(show_path);
  await browser.management.setEnabled(DESERTBIRD_ID, true);
}

async function close_compose_windows() {
  for (const window of await browser.windows.getAll({ windowTypes: ["messageCompose"] })) await browser.windows.remove(window.id);
}

// Archive or delete what the mail tab has selected, through the API. It measures what Thunderbird leaves selected afterwards, independent of the keys.
async function act_on_selected(name) {
  const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true });
  const ids = (await all_messages(await browser.mailTabs.getSelectedMessages(mail_tab.id))).map((message) => message.id);
  if (name === "api_archive") await browser.messages.archive(ids);
  else await browser.messages.delete(ids);
}

// Shows the Views folder, tags two of its messages and returns the tab the view commands act on.
async function prepare_views() {
  const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true });
  const folders = (await browser.accounts.list(true)).flatMap((account) => account.folders ?? []);
  const views = folders.find((folder) => folder.path === "/Views");
  // The first display of a folder reports an error although the folder shows.
  await browser.mailTabs.update(mail_tab.id, { displayedFolder: views }).catch(() => {});
  // A folder shown for the first time lists no messages until Thunderbird has read its mbox.
  let messages = [];
  for (let attempt = 0; attempt < 20 && messages.length < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    messages = await all_messages(await browser.messages.list(views.id));
  }
  const seen = [];
  for (const message of messages) {
    seen.push(message.headerMessageId);
    if (["views-4@fixture.invalid", "views-5@fixture.invalid"].includes(message.headerMessageId)) await browser.messages.update(message.id, { tags: ["$label1"] });
  }
  return seen;
}

// Applies a quick filter or a tab update straight through the API, for the commands that have no default key.
async function api_view(args) {
  const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true });
  if (args.filter) await browser.mailTabs.setQuickFilter(mail_tab.id, args.filter);
  if (args.update) await browser.mailTabs.update(mail_tab.id, args.update);
}

// Test-only read of the clipboard text. A write that failed in DesertBird leaves the earlier text, so the runner clears it first.
async function clipboard_text(set_to) {
  if (set_to !== undefined) await navigator.clipboard.writeText(set_to);
  return set_to === undefined ? await navigator.clipboard.readText() : null;
}

// messages.query by Message-ID found nothing on a fresh profile, and messages.list of a folder that was never shown is empty, because Thunderbird parses a folder when it first opens it.
// So the lookup shows each folder in the mail tab first, then walks the folders like state does.
async function find_message(header_id, folders, mail_tab_id) {
  for (const folder of folders) {
    await browser.mailTabs.update(mail_tab_id, { displayedFolder: folder }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const found = (await all_messages(await browser.messages.list(folder.id))).find((message) => message.headerMessageId === header_id);
    if (found) return found;
    const nested = await find_message(header_id, folder.subFolders ?? [], mail_tab_id);
    if (nested) return nested;
  }
  return null;
}
async function find_in_accounts(header_id) {
  const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true });
  return find_message(header_id, (await browser.accounts.list(true)).flatMap((account) => account.folders ?? []), mail_tab.id);
}

// Shows the folder of the message with this Message-ID in the mail tab and selects the message, so a key acts on it without folder-pane navigation.
async function select_message(header_id) {
  const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true });
  const message = await find_in_accounts(header_id);
  if (!message) throw new Error(`no message ${header_id}`);
  await browser.mailTabs.update(mail_tab.id, { displayedFolder: message.folder }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await browser.mailTabs.setSelectedMessages(mail_tab.id, [message.id]);
}

// Tab commands for the tab checks. They drive tabs the way a mouse click does, with no key.
async function tab_command(command) {
  const [window] = await browser.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const tabs = window.tabs;
  if (command.name === "open_content_tab") return { opened: (await browser.tabs.create({ url: "about:blank" })).id };
  if (command.name === "open_popup_window") return { opened: (await browser.windows.create({ type: "popup", url: "about:blank" })).id };
  if (command.name === "close_popup_window") return { closed: await browser.windows.remove(command.args.id).then(() => true) };
  if (command.name === "open_mail_tab") return { opened: (await browser.mailTabs.create({})).id };
  if (command.name === "move_first_tab") return { moved: await browser.tabs.move(tabs[0].id, { index: 1 }).then((moved) => moved.map((tab) => tab.index)) };
  if (command.name === "open_message_tab") {
    const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true });
    const [message] = (await browser.mailTabs.getSelectedMessages(mail_tab.id)).messages;
    return { opened: (await browser.messageDisplay.open({ location: "tab", messageId: message.id, active: true }))?.id ?? null };
  }
  if (command.name === "select_tab") return { updated: (await browser.tabs.update(tabs[command.args.index].id, { active: true })).id };
  if (command.name === "reset_tabs") {
    for (const tab of tabs.slice(1)) await browser.tabs.remove(tab.id);
    return { reset: true };
  }
  if (command.name === "remove_tab") return { removed: await browser.tabs.remove(tabs[command.args.index].id).then(() => true) };
  throw new Error(`unknown tab command ${command.name}`);
}

// What the body report script last sent: the scroll state of the message document that reported last, and whether DesertBird's body script had marked it.
let latest_body = null;
browser.runtime.onMessage.addListener((message) => {
  if (message?.kind === "body_report") latest_body = { ...message, received: Date.now() };
});

// Opens the selected message in its own window, as a key-less double click would.
async function open_message_window() {
  const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true });
  const [message] = (await browser.mailTabs.getSelectedMessages(mail_tab.id)).messages;
  return (await browser.messageDisplay.open({ location: "window", messageId: message.id }))?.windowId ?? null;

// Folder history probe. folder_events_start records every onDisplayedFolderChanged event with a clock stamp, folder_events_read returns them.
const folder_events = [];
let folder_events_listening = false;
function folder_events_start() {
  folder_events.length = 0;
  if (folder_events_listening) return;
  folder_events_listening = true;
  browser.mailTabs.onDisplayedFolderChanged.addListener((tab, folder) => folder_events.push({ at: Math.round(performance.now()), tab_id: tab?.id ?? null, account_id: folder?.accountId ?? null, path: folder?.path ?? null }));
}

const flat_folders = (folders) => folders.flatMap((folder) => [folder, ...flat_folders(folder.subFolders ?? [])]);

// Shows a folder by path through mailTabs.update and reports what the call did: whether it threw, how long it took, and what a query right after shows.
async function show_folder(path) {
  const [mail_tab] = await browser.mailTabs.query({ active: true, currentWindow: true });
  const folder = flat_folders((await browser.accounts.list(true)).flatMap((account) => account.folders ?? [])).find((candidate) => candidate.path === path);
  if (!folder) throw new Error(`no folder ${path}`);
  const started = Math.round(performance.now());
  let update_error = null;
  await browser.mailTabs.update(mail_tab.id, { displayedFolder: folder }).catch((error) => { update_error = String(error); });
  const returned = Math.round(performance.now());
  let query_error = null;
  let shown = null;
  await browser.mailTabs.query({ active: true, currentWindow: true }).then(([tab]) => { shown = tab?.displayedFolder?.path ?? null; }).catch((error) => { query_error = String(error); });
  return { started, returned, update_error, query_error, shown_right_after: shown };
}

// Looks a folder up by account id and path, as folder.open and the jump commands do.
async function query_folder(args) {
  const found = await browser.folders.query(args.query);
  return { found: found.map((folder) => ({ id: folder.id, path: folder.path, account_id: folder.accountId, special_use: folder.specialUse ?? [] })) };
}

async function post(body) {
  await fetch(`${SINK_URL}/state`, { method: "POST", body: JSON.stringify(body) });
}

async function poll_forever() {
  for (;;) {
    let command = { name: null, seq: -1 };
    try {
      command = await (await fetch(`${SINK_URL}/poll`)).json();
      if (command.name === "state") await post({ seq: command.seq, ...(await collect()) });
      else if (command.name === "api_archive" || command.name === "api_delete") {
        await act_on_selected(command.name);
        await post({ seq: command.seq, acted: command.name });
      } else if (command.name?.startsWith("select:")) {
        await select_message(command.name.slice(7));
        await post({ seq: command.seq, selected: true });
      } else if (command.name === "open_message_window") {
        await post({ seq: command.seq, opened: await open_message_window() });
      } else if (command.name === "close_message_windows") {
        for (const window of await browser.windows.getAll({ windowTypes: ["messageDisplay"] })) await browser.windows.remove(window.id);
        await post({ seq: command.seq, closed: true });
      } else if (command.name === "close_compose") {
        await close_compose_windows();
        await post({ seq: command.seq, closed: true });
      } else if (command.name === "prepare_views") {
        const seen = await prepare_views();
        await post({ seq: command.seq, prepared: true, seen });
      } else if (command.name === "api_view") {
        await api_view(command.args);
        await post({ seq: command.seq, applied: true });
      } else if (command.name === "probe_plain_text") {
        const utils = browser.messengerUtilities;
        const converted = utils?.convertToPlainText ? await utils.convertToPlainText("<html><head><title>T</title></head><body><p>It&#39;s &eacute;</p><table><tr><td>A</td><td>B</td></tr></table></body></html>") : null;
        await post({ seq: command.seq, has_utils: Boolean(utils), has_convert: Boolean(utils?.convertToPlainText), converted });
      } else if (command.name === "read_clipboard") {
        await post({ seq: command.seq, text: await clipboard_text() });
      } else if (command.name === "clear_clipboard") {
        await clipboard_text("");
        await post({ seq: command.seq, cleared: true });
      } else if (["open_content_tab", "open_popup_window", "close_popup_window", "open_message_tab", "open_mail_tab", "move_first_tab", "select_tab", "remove_tab", "reset_tabs"].includes(command.name)) {
        await post({ seq: command.seq, ...(await tab_command(command)) });
      } else if (command.name === "folder_events_start") {
        folder_events_start();
        await post({ seq: command.seq, started: true });
      } else if (command.name === "folder_events_read") {
        await post({ seq: command.seq, events: folder_events, now: Math.round(performance.now()) });
      } else if (command.name === "show_folder") {
        await post({ seq: command.seq, ...(await show_folder(command.args.path)) });
      } else if (command.name === "query_folder") {
        await post({ seq: command.seq, ...(await query_folder(command.args)) });
      } else if (command.name === "reload_desertbird") {
        await reload_desertbird(command.args?.path);
        await post({ seq: command.seq, reloaded: true });
      }
    } catch (error) {
      await post({ seq: command.seq, error: String(error) }).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

poll_forever();
