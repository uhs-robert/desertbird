// Throwaway scenario runner. It asks the driver (run.mjs) for real key presses and screenshots over a local HTTP port
// and posts each result back. Fixed scenarios only: nothing here evaluates a string.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = async (path, body) => (await fetch(`http://127.0.0.1:${CONFIG.port}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const log = (...parts) => post("/log", parts.join(" "));
const results = {};

async function record(name, scenario) {
  if (CONFIG.only && !CONFIG.only.includes(name)) return;
  const started = performance.now();
  try {
    results[name] = await scenario();
  } catch (error) {
    results[name] = { error: String(error), stack: String(error.stack).split("\n").slice(0, 4), console: await messenger.probe.console_tail().catch(() => []) };
  }
  await post("/result", { name, data: results[name] });
  await log("scenario", name, `${Math.round(performance.now() - started)} ms`);
}

const key_events = [];
const content_events = [];
const overlay_events = [];
messenger.probe.onKey.addListener((info) => key_events.push(info));
messenger.probe.onPing.addListener((seq) => messenger.probe.pong(seq));
messenger.runtime.onMessage.addListener((message) => {
  if (message?.type === "content_key" || message?.type === "content_loaded") content_events.push(message);
  else if (message?.type === "overlay") overlay_events.push(message);
});

const key_args = (key) => (key === " " ? ["-k", "space"] : key.length === 1 ? [key] : ["-k", key]);

function summarize_chrome(events) {
  const counts = new Map();
  for (const event of events) {
    const label = `${event.level} | ${event.win_type} | target=${event.target} | doc=${event.origin_doc}${event.cancelled ? " | CANCELLED" : ""}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts, ([label, count]) => `${label} x${count}`);
}

// Presses keys for real, then reports what each layer saw.
async function press_and_collect(args, wait_ms = 500) {
  const chrome_mark = key_events.length;
  const content_mark = content_events.length;
  const overlay_mark = overlay_events.length;
  await post("/press", { args });
  await sleep(wait_ms);
  return {
    chrome: summarize_chrome(key_events.slice(chrome_mark)),
    content: content_events.slice(content_mark).filter((event) => event.type === "content_key").map((event) => `${event.where}:${event.key}${event.defaultPrevented ? " (prevented)" : ""}`),
    overlay: overlay_events.slice(overlay_mark).map((event) => `${event.kind}:${event.key ?? ""}:${event.target ?? ""}:${event.value ?? ""}`),
  };
}

async function collect(page) {
  const all = [...page.messages];
  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    all.push(...page.messages);
  }
  return all;
}

const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const stats = (values) => ({ n: values.length, median: percentile(values, 0.5), p95: percentile(values, 0.95), max: Math.max(...values), min: Math.min(...values) });
async function timed(work) {
  const start = performance.now();
  const value = await work();
  return { ms: performance.now() - start, value };
}

const by_header_id = async (header_id) => (await collect(await messenger.messages.query({ headerMessageId: header_id })))[0];

async function find_folders() {
  const folders = await messenger.folders.query({});
  return { all: folders, inbox: folders.find((folder) => folder.name === "Inbox" && folder.path.split("/").length <= 2), bulk: folders.filter((folder) => /^Bulk\d\d$/.test(folder.name)) };
}

async function main_tab_id() {
  const [tab] = await messenger.mailTabs.query({});
  return tab.id;
}

async function show_folder(folder) {
  const tab_id = await main_tab_id();
  // On a fresh profile the first update shows the folder but then throws while it converts the tab (its view has no sort yet), so the error is kept and the view is checked instead.
  try {
    await messenger.mailTabs.update(tab_id, { displayedFolder: folder.id });
  } catch (error) {
    await log("mailTabs.update threw", String(error));
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    await sleep(100);
    const snapshot = await messenger.probe.view_snapshot();
    if (snapshot.row_count > 0) return tab_id;
  }
  throw new Error(`folder ${folder.name} showed no rows`);
}

const API_PATHS = [
  "messages.update", "messages.query", "messages.get", "messages.getFull", "messages.getRaw", "messages.list", "messages.continueList", "messages.move", "messages.archive", "messages.delete",
  "messages.tags.list", "messages.listTags", "messages.onUpdated", "messages.onNewMailReceived",
  "folders.markAsRead", "folders.query", "folders.getFolderInfo", "accounts.list",
  "compose.beginReply", "compose.beginForward", "compose.beginNew", "compose.getComposeDetails", "compose.setComposeDetails",
  "messageDisplay.open", "messageDisplay.getDisplayedMessages",
  "mailTabs.update", "mailTabs.query", "mailTabs.setQuickFilter", "mailTabs.getListedMessages", "mailTabs.getSelectedMessages", "mailTabs.setSelectedMessages", "mailTabs.onDisplayedFolderChanged", "mailTabs.onSelectedMessagesChanged",
  "tabs.create", "tabs.remove", "tabs.update", "tabs.query", "tabs.onActivated", "tabs.onRemoved", "tabs.get", "windows.create", "windows.remove", "windows.getAll",
  "messageDisplayScripts.register", "composeScripts.register", "storage.local.get", "storage.local.set", "storage.onChanged", "commands.onCommand", "commands.update",
  "runtime.sendMessage", "runtime.getBrowserInfo", "menus.create", "messenger.clipboard", "spaces.create", "spaces.query", "addressBooks.openUI",
];

function api_presence() {
  const found = {};
  for (const path of API_PATHS) {
    let node = messenger;
    for (const part of path.split(".")) node = node?.[part];
    found[path] = node === undefined ? "absent" : typeof node;
  }
  found["keys of messenger.messages"] = Object.keys(messenger.messages).join(",");
  found["keys of messenger.messages.tags"] = messenger.messages.tags ? Object.keys(messenger.messages.tags).join(",") : "absent";
  found["navigator.clipboard.writeText"] = typeof navigator.clipboard?.writeText;
  found["navigator.clipboard.readText"] = typeof navigator.clipboard?.readText;
  return found;
}

async function scenario_env() {
  return { browser_info: await messenger.runtime.getBrowserInfo(), platform: await messenger.runtime.getPlatformInfo(), user_agent: navigator.userAgent, windows: await messenger.probe.windows() };
}

async function scenario_rtt() {
  const chrome_to_background = await messenger.probe.rtt(300);
  const background_to_chrome = [];
  for (let sample = 0; sample < 300; sample++) {
    const start = performance.now();
    await messenger.probe.noop();
    background_to_chrome.push(performance.now() - start);
  }
  // Same loop while the thread list is busy, to show whether a held key adds cost.
  return { chrome_to_background_to_chrome: stats(chrome_to_background.slice(10)), background_calls_verb: stats(background_to_chrome.slice(10)) };
}

async function scenario_query() {
  const { inbox, bulk } = await find_folders();
  const out = { folders_found: bulk.length };
  // Cold: each mbox has no summary file, so the first read of a folder parses it.
  // A folder without its summary file lists no messages until it is opened once. Opening it in the thread list makes Thunderbird parse it and write the summary.
  const cold = [];
  for (const folder of bulk) {
    const start = performance.now();
    await show_folder(folder);
    let count = 0;
    let retries = 0;
    for (; retries < 200 && count !== 100; retries++) {
      try {
        count = (await collect(await messenger.messages.list(folder.id))).length;
      } catch {
        count = -1;
      }
      if (count !== 100) {
        if (retries % 20 === 0) await log("cold list", folder.name, "count", count, "retry", retries);
        await sleep(50);
      }
    }
    cold.push({ folder: folder.name, ms: performance.now() - start, count, retries });
  }
  out.cold_list_each_folder = { total_ms: cold.reduce((sum, item) => sum + item.ms, 0), first: cold[0], stats_ms: stats(cold.map((item) => item.ms)), counts_ok: cold.every((item) => item.count === 100), folders_needing_retry: cold.filter((item) => item.retries > 1).length };
  // getFolderInfo throws NS_MSG_ERROR_FOLDER_SUMMARY_OUT_OF_DATE while a folder has no summary file, so wait for every folder to answer.
  const info_ready = performance.now();
  for (const folder of bulk) {
    for (let attempt = 0; attempt < 200; attempt++) {
      try { await messenger.folders.getFolderInfo(folder.id); break; } catch { await sleep(50); }
    }
  }
  out.getFolderInfo_ready_after_ms = performance.now() - info_ready;
  await collect(await messenger.messages.list(inbox.id));

  const runs = 15;
  const series = {};
  const add = (name, ms) => (series[name] ??= []).push(ms);
  let unread_total = 0;
  let unread_ids_distinct = 0;
  for (let run = 0; run < runs; run++) {
    const all = await timed(async () => collect(await messenger.messages.query({ unread: true })));
    add("query_unread_all_default_paging", all.ms);
    unread_total = all.value.length;
    unread_ids_distinct = new Set(all.value.map((message) => message.id)).size;
    const tuned = await timed(async () => collect(await messenger.messages.query({ unread: true, messagesPerPage: 6000, autoPaginationTimeout: 60000 })));
    add("query_unread_all_one_page", tuned.ms);
    const first = await timed(async () => (await messenger.messages.query({ unread: true, messagesPerPage: 1 })).messages.length);
    add("query_unread_first_hit_only", first.ms);
    const flagged = await timed(async () => collect(await messenger.messages.query({ flagged: true })));
    add("query_flagged_all", flagged.ms);
    const per_folder = await timed(async () => {
      let found = 0;
      for (const folder of bulk) found += (await collect(await messenger.messages.query({ folderId: folder.id, unread: true }))).length;
      return found;
    });
    add("query_unread_50_folder_calls", per_folder.ms);
    const info = await timed(async () => {
      let found = 0;
      for (const folder of bulk) found += (await messenger.folders.getFolderInfo(folder.id)).unreadMessageCount;
      return found;
    });
    add("folder_info_unread_50_calls", info.ms);
    const one = await timed(async () => collect(await messenger.messages.query({ folderId: bulk[25].id, unread: true })));
    add("query_unread_one_folder", one.ms);
    if (run === 0) out.counts = { per_folder_calls_total: per_folder.value, folder_info_total: info.value, one_folder: one.value.length, flagged: flagged.value.length };
  }
  out.unread_total = unread_total;
  out.unread_distinct_ids = unread_ids_distinct;
  out.series = Object.fromEntries(Object.entries(series).map(([name, values]) => [name, { first_run_ms: values[0], ...stats(values.slice(1)) }]));
  const tab_id = await show_folder(bulk[3]);
  out.getListedMessages_100 = stats(await (async () => {
    const samples = [];
    for (let run = 0; run < 10; run++) samples.push((await timed(async () => collect(await messenger.mailTabs.getListedMessages(tab_id)))).ms);
    return samples;
  })());
  return out;
}

async function scenario_threads() {
  const { inbox } = await find_folders();
  const tab_id = await show_folder(inbox);
  const out = {};
  out.set_threaded_view = await messenger.mailTabs.update(tab_id, { viewType: "groupedByThread", sortType: "date", sortOrder: "ascending" }).then((tab) => `ok viewType=${tab.viewType}`, (error) => `error ${error}`);
  await sleep(500);
  await messenger.probe.view_fold(true);
  const expanded = await messenger.probe.view_snapshot();
  out.rows_expanded = expanded.row_count;
  await messenger.probe.view_fold(false);
  await sleep(300);
  const collapsed = await messenger.probe.view_snapshot();
  out.rows_collapsed = collapsed.row_count;
  out.collapsed_open_flags = collapsed.rows.slice(0, 3).map((row) => `${row.message_id} lvl${row.level} open=${row.open}`);

  async function select_and_report(label, header_ids) {
    const messages = [];
    for (const header_id of header_ids) messages.push(await by_header_id(header_id));
    const ids = messages.map((message) => message.id);
    let error = null;
    let returned = null;
    try {
      returned = await messenger.mailTabs.setSelectedMessages(tab_id, ids);
    } catch (caught) {
      error = String(caught);
    }
    await sleep(600);
    const snapshot = await messenger.probe.view_snapshot();
    const selected = await collect(await messenger.mailTabs.getSelectedMessages(tab_id));
    return {
      label,
      error,
      returned: returned === undefined ? "undefined" : returned,
      row_count_after: snapshot.row_count,
      selected_rows: snapshot.selected.map((index) => `${index}:${snapshot.rows[index]?.message_id}:lvl${snapshot.rows[index]?.level}`),
      selected_per_api: selected.map((message) => message.headerMessageId),
      thread_root_open: snapshot.rows.filter((row) => row.container).slice(0, 4).map((row) => `${row.message_id}:${row.open}`),
    };
  }
  await messenger.probe.view_fold(false);
  out.child_in_collapsed_thread = await select_and_report("child t3-m2, thread collapsed", ["inbox-t3-m2@fixture.invalid"]);
  await messenger.probe.view_fold(false);
  await sleep(300);
  out.root_of_collapsed_thread = await select_and_report("root t5-m0, thread collapsed", ["inbox-t5-m0@fixture.invalid"]);
  await messenger.probe.view_fold(false);
  await sleep(300);
  out.two_children_in_two_collapsed_threads = await select_and_report("children t1-m3 and t2-m1", ["inbox-t1-m3@fixture.invalid", "inbox-t2-m1@fixture.invalid"]);
  await messenger.probe.view_fold(true);
  await sleep(300);
  return out;
}

const SINGLE_KEYS = ["m", "s", "j", "f", "b", "n", "p", "r", "R", "1", "0", "x", "/", "*", "#", "Return", " "];
// wtype names Enter "Return", and the DOM event calls it "Enter".
const event_key_of = (key) => (key === "Return" ? "Enter" : key);

async function message_state(header_id) {
  const message = await by_header_id(header_id);
  return { read: message.read, flagged: message.flagged, junk: message.junk, tags: message.tags.join(","), folder: message.folder.name };
}

async function reset_selection(tab_id, header_id) {
  const message = await by_header_id(header_id);
  await messenger.messages.update(message.id, { read: false, flagged: false, junk: false, tags: [] });
  await messenger.mailTabs.setSelectedMessages(tab_id, [message.id]);
  await sleep(300);
}

async function close_extra_windows() {
  for (const tab of await messenger.tabs.query({})) if (tab.type !== "mail") await messenger.tabs.remove(tab.id).catch(() => {});
  const [main] = await messenger.tabs.query({ type: "mail" });
  if (main) await messenger.tabs.update(main.id, { active: true }).catch(() => {});
  for (const window of await messenger.windows.getAll({ windowTypes: ["messageCompose", "messageDisplay"] })) await messenger.windows.remove(window.id).catch(() => {});
  await sleep(300);
}

async function scenario_keys(cancel) {
  const { inbox } = await find_folders();
  const tab_id = await show_folder(inbox);
  await messenger.probe.view_fold(true);
  await messenger.probe.set_cancel(cancel ? SINGLE_KEYS.map(event_key_of) : []);
  const out = {};
  for (const key of SINGLE_KEYS) {
    await close_extra_windows();
    await reset_selection(tab_id, "inbox-s1@fixture.invalid");
    await messenger.probe.focus("threads");
    await sleep(200);
    const before = { state: await message_state("inbox-s1@fixture.invalid"), selected: (await collect(await messenger.mailTabs.getSelectedMessages(tab_id))).map((message) => message.headerMessageId), windows: (await messenger.windows.getAll()).length, tabs: (await messenger.tabs.query({})).length, view: (await messenger.probe.view_snapshot()).active };
    const seen = await press_and_collect(key_args(key), key === "r" || key === "R" ? 1800 : 700);
    const after = { state: await message_state("inbox-s1@fixture.invalid"), selected: (await collect(await messenger.mailTabs.getSelectedMessages(tab_id))).map((message) => message.headerMessageId), windows: (await messenger.windows.getAll()).length, tabs: (await messenger.tabs.query({})).length, view: (await messenger.probe.view_snapshot()).active };
    const changes = [];
    for (const field of Object.keys(before.state)) if (before.state[field] !== after.state[field]) changes.push(`${field}: ${before.state[field]} -> ${after.state[field]}`);
    if (before.selected.join() !== after.selected.join()) changes.push(`selection: ${before.selected} -> ${after.selected}`);
    if (before.tabs !== after.tabs) changes.push(`tabs: ${before.tabs} -> ${after.tabs}`);
    if (before.windows !== after.windows) changes.push(`windows: ${before.windows} -> ${after.windows}`);
    if (before.view !== after.view) changes.push(`focus: ${before.view} -> ${after.view}`);
    out[key === " " ? "space" : key] = { thunderbird_action: changes, ...seen };
  }
  await close_extra_windows();
  await messenger.probe.set_cancel([]);
  return out;
}

async function scenario_focus_targets() {
  const { inbox } = await find_folders();
  const tab_id = await show_folder(inbox);
  await reset_selection(tab_id, "inbox-s1@fixture.invalid");
  const out = {};
  // The first target repeats at the end: a key pressed right after the first focus change can be lost, so the repeat shows which one it was.
  const targets = ["threads", "folders", "message", "message_body", "folders"];
  for (const [index, target] of targets.entries()) {
    const focus_chain = await messenger.probe.focus(target);
    await sleep(300);
    const seen = await press_and_collect(["x"], 500);
    out[`${index}_${target}`] = { focus_after_verb: focus_chain, windows_active: (await messenger.probe.windows()).find((window) => window.type === "mail:3pane")?.active, ...seen };
  }
  return out;
}

async function scenario_message_pane() {
  const { inbox } = await find_folders();
  const tab_id = await show_folder(inbox);
  await reset_selection(tab_id, "inbox-s2@fixture.invalid");
  await sleep(1000);
  const displayed = await messenger.messageDisplay.getDisplayedMessages(tab_id);
  const out = { displayed: displayed.map((message) => message.headerMessageId), content_loaded_events: content_events.filter((event) => event.type === "content_loaded").length };
  await messenger.probe.focus("message_body");
  await sleep(400);
  out.focus_chain = (await messenger.probe.windows()).find((window) => window.type === "mail:3pane")?.active;
  out.keys_x_then_j = { x: await press_and_collect(["x"]), j: await press_and_collect(["j"]) };
  await messenger.probe.set_cancel(["x"]);
  out.with_chrome_cancel_of_x = await press_and_collect(["x"]);
  await messenger.probe.set_cancel([]);
  return out;
}

async function scenario_window_types() {
  const { inbox } = await find_folders();
  await show_folder(inbox);
  const message = await by_header_id("inbox-s2@fixture.invalid");
  const out = {};

  const message_tab = await messenger.messageDisplay.open({ location: "tab", messageId: message.id, active: true });
  await sleep(1500);
  out.message_tab = { windows: (await messenger.probe.windows()).map((window) => window.active), ...(await press_and_collect(["x"])) };
  await messenger.tabs.remove(message_tab.id);
  await sleep(500);

  const message_window = await messenger.messageDisplay.open({ location: "window", messageId: message.id });
  await sleep(2000);
  out.message_window = { windows: (await messenger.probe.windows()).map((window) => `${window.type}:${window.focused}:${window.active}`), ...(await press_and_collect(["x"])) };
  await messenger.windows.remove((await messenger.windows.getAll({ windowTypes: ["messageDisplay"] }))[0].id).catch(() => {});
  await sleep(500);

  const content_tab = await messenger.tabs.create({ url: messenger.runtime.getURL("overlay.html") });
  await sleep(1500);
  out.extension_page_in_content_tab = { tab: `${content_tab.type}`, ...(await press_and_collect(["x"])) };
  await messenger.tabs.remove(content_tab.id);
  await sleep(500);

  try {
    const addons_tab = await messenger.tabs.create({ url: "about:addons" });
    await sleep(2000);
    out.about_addons_tab = { ...(await press_and_collect(["x"])), tabs: (await messenger.probe.windows()).find((window) => window.type === "mail:3pane")?.tabs };
    await messenger.tabs.remove(addons_tab.id);
  } catch (error) {
    out.about_addons_tab = { error: String(error) };
  }
  await sleep(500);

  await messenger.compose.beginNew();
  await sleep(2500);
  out.compose_window_new = { windows: (await messenger.probe.windows()).map((window) => `${window.type}:${window.focused}:${window.active}`), ...(await press_and_collect(["x"])) };
  await close_extra_windows();
  return out;
}

async function compose_body_text(compose_id) {
  const details = await messenger.compose.getComposeDetails(compose_id);
  return details.isPlainText ? details.plainTextBody : details.body;
}

async function scenario_compose() {
  const { inbox } = await find_folders();
  await show_folder(inbox);
  const message = await by_header_id("inbox-s2@fixture.invalid");
  await log("compose: beginReply");
  const compose_tab = await messenger.compose.beginReply(message.id, "replyToSender");
  await log("compose: opened");
  await sleep(3000);
  for (let attempt = 0; attempt < 50 && !(await messenger.probe.windows()).some((window) => window.type === "msgcompose" && window.focused); attempt++) await sleep(100);
  const compose_id = compose_tab.id;
  const out = { windows: (await messenger.probe.windows()).map((window) => `${window.type}:${window.focused}:${window.active}`), content_loaded: [...new Set(content_events.filter((event) => event.type === "content_loaded").map((event) => event.where))] };
  const before = await compose_body_text(compose_id);
  out.q_pressed_no_cancel = await press_and_collect(["q"], 600);
  const after_plain = await compose_body_text(compose_id);
  out.q_inserted_into_body = after_plain.length > before.length;
  out.body_length_delta = after_plain.length - before.length;
  await messenger.probe.set_cancel(["z"]);
  const before_cancel = await compose_body_text(compose_id);
  out.z_pressed_with_chrome_cancel = await press_and_collect(["z"], 600);
  const after_cancel = await compose_body_text(compose_id);
  out.z_inserted_into_body_despite_cancel = after_cancel.length > before_cancel.length;
  out.body_length_delta_cancel = after_cancel.length - before_cancel.length;
  await messenger.probe.set_cancel([]);
  await close_extra_windows();
  return out;
}

async function scenario_overlay() {
  const { inbox } = await find_folders();
  const tab_id = await show_folder(inbox);
  const out = {};
  for (const kind of ["iframe_3pane", "browser_top", "panel_top"]) {
    const entry = {};
    try {
      await messenger.probe.console_tail();
      const overlay_mark = overlay_events.length;
      const call_start = performance.now();
      const mounted = await messenger.probe.overlay_mount(kind);
      entry.mounted = mounted;
      while (!overlay_events.slice(overlay_mark).some((event) => event.kind === "loaded") && performance.now() - call_start < 8000) await sleep(5);
      entry.page_reported_loaded_after_ms = overlay_events.slice(overlay_mark).some((event) => event.kind === "loaded") ? performance.now() - call_start : null;
      await sleep(1000);
      entry.console_after_mount = (await messenger.probe.console_tail()).filter((line) => !/fullScreen|tbkeys|Blocklist/.test(line));
      entry.events_after_mount = overlay_events.slice(overlay_mark).map((event) => JSON.stringify(event));
      entry.focus_after_verb = await messenger.probe.overlay_focus();
      await sleep(300);
      entry.typed_abc = await press_and_collect(["abc"], 600);
      entry.escape = await press_and_collect(["-k", "Escape"], 400);
      await post("/shot", { name: `overlay_${kind}` });
      await messenger.probe.overlay_unmount();
      await sleep(300);
      await messenger.probe.focus("threads");
      entry.after_unmount_x = await press_and_collect(["x"], 400);
    } catch (error) {
      entry.error = String(error);
      await messenger.probe.overlay_unmount().catch(() => {});
    }
    out[kind] = entry;
  }
  return out;
}

async function scenario_tabs_remove() {
  const { inbox } = await find_folders();
  const main_id = await show_folder(inbox);
  const out = {};
  const extra = await messenger.tabs.create({ url: messenger.runtime.getURL("overlay.html") });
  await sleep(1000);
  out.tabs_before = (await messenger.tabs.query({ currentWindow: true })).map((tab) => `${tab.id}:${tab.type}`);
  out.main_tab_id = main_id;
  try {
    out.remove_result = String(await messenger.tabs.remove(main_id));
  } catch (error) {
    out.remove_error = String(error);
  }
  await sleep(1000);
  out.tabs_after = (await messenger.tabs.query({ currentWindow: true })).map((tab) => `${tab.id}:${tab.type}`);
  out.windows_after = (await messenger.windows.getAll()).length;
  out.mail_tab_still_there = (await messenger.mailTabs.query({})).length;
  await messenger.tabs.remove(extra.id).catch(() => {});
  return out;
}

// Last scenario: the app may close its only window here, so the result file is written first.
async function scenario_tabs_remove_only_tab() {
  const main_id = await main_tab_id();
  const before = (await messenger.tabs.query({})).map((tab) => `${tab.id}:${tab.type}`);
  await post("/result", { name: "tabs_remove_only_tab", data: { before, status: "tabs.remove called; if this stays, the app closed during the call" } });
  let error = null;
  try {
    await messenger.tabs.remove(main_id);
  } catch (caught) {
    error = String(caught);
  }
  await sleep(1500);
  return { before, error, after: (await messenger.tabs.query({})).map((tab) => `${tab.id}:${tab.type}`), windows_after: (await messenger.windows.getAll()).length };
}

async function start() {
  await log("background up");
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const { inbox, bulk } = await find_folders();
      if (inbox && bulk.length === 50 && (await messenger.mailTabs.query({})).length) break;
    } catch {}
    await sleep(500);
  }
  await messenger.probe.install_keys([]);
  await messenger.messageDisplayScripts.register({ js: [{ file: "msg_content.js" }] });
  await messenger.composeScripts.register({ js: [{ file: "compose_content.js" }] });
  await sleep(1000);
  await record("env", scenario_env);
  await record("api_presence", async () => api_presence());
  await record("rtt", scenario_rtt);
  await record("threads", scenario_threads);
  await record("query", scenario_query);
  await record("focus_targets", scenario_focus_targets);
  await record("keys_no_cancel", () => scenario_keys(false));
  await record("keys_cancelled_in_top_capture", () => scenario_keys(true));
  await record("message_pane", scenario_message_pane);
  await record("window_types", scenario_window_types);
  await record("compose", scenario_compose);
  await record("overlay", scenario_overlay);
  await record("tabs_remove", scenario_tabs_remove);
  await record("tabs_remove_only_tab", scenario_tabs_remove_only_tab);
  await post("/done", {});
}

start().catch((error) => log("fatal", String(error), String(error.stack)));
