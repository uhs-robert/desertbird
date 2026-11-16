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
  state.mail_tab = mail_tab ? { id: mail_tab.id, folder: mail_tab.displayedFolder?.path ?? null, message_pane_visible: mail_tab.messagePaneVisible } : null;
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
      entry.tabs.push({ id: tab.id, type: tab.type, title: tab.title, subject: detail?.subject ?? null, body: detail?.plainTextBody ?? detail?.body ?? null });
    }
    state.windows.push(entry);
  }
  const desertbird = await browser.management.get(DESERTBIRD_ID).catch(() => null);
  state.desertbird_enabled = desertbird?.enabled ?? null;
  return state;
}

async function reload_desertbird() {
  await browser.management.setEnabled(DESERTBIRD_ID, false);
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
      } else if (command.name === "close_compose") {
        await close_compose_windows();
        await post({ seq: command.seq, closed: true });
      } else if (command.name === "reload_desertbird") {
        await reload_desertbird();
        await post({ seq: command.seq, reloaded: true });
      }
    } catch (error) {
      await post({ seq: command.seq, error: String(error) }).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

poll_forever();
