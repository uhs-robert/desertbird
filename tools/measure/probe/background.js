// Throwaway scenario runner. It asks the driver (run.mjs) for real key presses and screenshots over a local HTTP port
// and posts each result back. Fixed scenarios only: nothing here evaluates a string.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = async (path, body) => (await fetch(`http://127.0.0.1:${CONFIG.port}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const log = (...parts) => post("/log", parts.join(" "));
const results = {};

async function record(name, scenario) {
  if (!CONFIG.only.includes(name)) return;
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
// recv is the background page's own clock at the moment the event arrives.
messenger.probe.onKey.addListener((info) => key_events.push({ ...info, recv: performance.now() }));
const ping_received = new Map();
messenger.probe.onPing.addListener((info) => {
  ping_received.set(info.seq, performance.now());
  messenger.probe.pong(info.seq);
});
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
    // Listener levels in the order the Experiment's clock saw them run.
    order: key_events.slice(chrome_mark).sort((a, b) => a.t - b.t).map((event) => event.level),
  };
}

// A key pressed right after a focus change can be lost. A bare Shift press is harmless and is repeated until some listener sees it.
let settle_misses = 0;
async function settle() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const mark = key_events.length;
    await post("/press", { args: ["-k", "Shift_L"] });
    await sleep(250);
    if (key_events.length > mark) return attempt;
    settle_misses++;
  }
  throw new Error("no key reached any window after 10 tries");
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

async function show_folder(folder, timeout_ms = 10000) {
  const tab_id = await main_tab_id();
  // On a fresh profile the first update shows the folder but then throws while it converts the tab (its view has no sort yet), so the error is kept and the view is checked instead.
  try {
    await messenger.mailTabs.update(tab_id, { displayedFolder: folder.id });
  } catch (error) {
    await log("mailTabs.update threw", String(error));
  }
  for (let attempt = 0; attempt < timeout_ms / 100; attempt++) {
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

// Maps the Experiment's clock onto the background page's clock with the ping loop. Each sample puts the send time plus half the loop time against the background's receive time.
async function clock_offset() {
  const samples = await messenger.probe.rtt(300);
  const offsets = samples.map((sample, seq) => ping_received.get(seq) - (sample.sent + sample.rtt / 2)).slice(10);
  return { offset_ms: percentile(offsets, 0.5), offset_spread_ms: percentile(offsets, 0.95) - percentile(offsets, 0.05), rtt: stats(samples.map((sample) => sample.rtt).slice(10)) };
}

// This loop never involves a key. It is the cost of the event path alone, a lower bound for the time from a key to a handler.
async function scenario_rtt() {
  const { rtt } = await clock_offset();
  const background_to_chrome = [];
  for (let sample = 0; sample < 300; sample++) {
    const start = performance.now();
    await messenger.probe.noop();
    background_to_chrome.push(performance.now() - start);
  }
  return { label: "event path only, no key, app idle: a lower bound", chrome_to_background_to_chrome: rtt, background_calls_verb: stats(background_to_chrome.slice(10)) };
}

// Time from the Experiment's key listener to the moment the background page holds the event, for real key presses.
async function scenario_key_latency() {
  const { inbox } = await find_folders();
  await show_folder(inbox);
  await messenger.probe.focus("threads");
  const out = { settle_attempts_missed: await settle() };
  const clock = await clock_offset();
  out.clock = clock;
  const latencies = (events) => events.filter((event) => event.level === "top_capture" && event.key === "x").map((event) => event.recv - (event.t + clock.offset_ms));
  const idle_mark = key_events.length;
  for (let press = 0; press < 40; press++) {
    await post("/press", { args: ["x"] });
    await sleep(120);
  }
  out.idle = stats(latencies(key_events.slice(idle_mark)));
  // Real work in the parent process while keys arrive: an all-folder query is in flight during each burst.
  const busy_mark = key_events.length;
  for (let round = 0; round < 8; round++) {
    const query = (async () => collect(await messenger.messages.query({ unread: true })))();
    await sleep(30);
    await post("/press", { args: ["xxxxx"] });
    await query;
    await sleep(100);
  }
  out.during_unread_query = stats(latencies(key_events.slice(busy_mark)));
  out.note = "Resolution of the clock mapping is the loop time (about 0.1 ms). The time from wtype's send to the listener is not included.";
  return out;
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
  // Open the Inbox too, so the expected unread total can come from its live count.
  await show_folder(inbox);
  await collect(await messenger.messages.list(inbox.id));
  const inbox_unread = (await messenger.folders.getFolderInfo(inbox.id)).unreadMessageCount;

  const runs = 31;
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
  out.unread_expected = 1500 + inbox_unread;
  out.inbox_unread_live = inbox_unread;
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

// wtype names Enter "Return", and the DOM event calls it "Enter".
const event_key_of = (key) => (key === "Return" ? "Enter" : key);

async function message_state(header_id) {
  const message = await by_header_id(header_id);
  return { read: message.read, flagged: message.flagged, junk: message.junk, tags: message.tags.join(","), folder: message.folder.name };
}

async function close_extra_windows() {
  for (const tab of await messenger.tabs.query({})) if (tab.type !== "mail") await messenger.tabs.remove(tab.id).catch(() => {});
  for (const window of await messenger.windows.getAll({ windowTypes: ["messageCompose", "messageDisplay"] })) await messenger.windows.remove(window.id).catch(() => {});
  const [main] = await messenger.tabs.query({ type: "mail" });
  if (main) await messenger.tabs.update(main.id, { active: true }).catch(() => {});
  await sleep(300);
}

async function reset_selection(tab_id, header_id) {
  const message = await by_header_id(header_id);
  await messenger.messages.update(message.id, { read: false, flagged: false, junk: false, tags: [] });
  await messenger.mailTabs.setSelectedMessages(tab_id, [message.id]);
  await sleep(300);
}

const THREAD_KEYS = ["m", "s", "j", "f", "b", "n", "p", "a", "r", "R", "1", "0", "x", "/", "*", "#", "Return", " "];
const OTHER_KEYS = ["m", "s", "j", "a", "r", "R"];
const PRESSES_PER_CELL = 5;

// One focus context of the shortcut test: the thread list, the message pane of the three pane, a message tab or a standalone message window.
async function open_context(context, message, folder) {
  const own = { tab_id: await show_folder(folder) };
  if (context === "thread" || context === "pane") {
    await messenger.mailTabs.setSelectedMessages(own.tab_id, [message.id]);
    await sleep(600);
    await messenger.probe.focus(context === "thread" ? "threads" : "message_body");
    await sleep(300);
  } else {
    const opened = await messenger.messageDisplay.open({ location: context, messageId: message.id, active: true });
    own.opened_id = opened.id;
    own.window_id = opened.windowId;
    await sleep(2000);
  }
  own.settle_misses = await settle();
  return own;
}

async function close_context(context, own) {
  if (context === "tab") await messenger.tabs.remove(own.opened_id).catch(() => {});
  if (context === "window") await messenger.windows.remove(own.window_id).catch(() => {});
  await close_extra_windows();
}

async function scenario_keys_context(context) {
  const folders = (await find_folders()).bulk;
  const folder = folders.find((candidate) => candidate.name === "Bulk00");
  // A new profile has no summary file for the folder, so it lists nothing until the folder is open.
  await show_folder(folder);
  for (let attempt = 0; attempt < 100 && (await collect(await messenger.messages.list(folder.id))).length !== 100; attempt++) await sleep(100);
  const keys = context === "thread" ? THREAD_KEYS : OTHER_KEYS;
  const out = { context, presses_per_cell: PRESSES_PER_CELL };
  let archive_index = 30;
  const snapshot = async (header_id, own) => ({
    state: await message_state(header_id),
    windows: (await messenger.windows.getAll()).length,
    tabs: (await messenger.tabs.query({})).length,
    selected: context === "thread" ? (await collect(await messenger.mailTabs.getSelectedMessages(own.tab_id))).map((message) => message.headerMessageId).join() : "",
  });
  for (const key of keys) {
    for (const mode of ["no_cancel", "cancel"]) {
      await messenger.probe.set_cancel(mode === "cancel" ? [event_key_of(key)] : []);
      const cell = { acted: 0, chrome_top_capture_seen: 0, cancelled_flag: 0, top_bubble_seen: 0, about3pane_seen: 0, content_script_seen: 0, changes: new Set(), order_first_press: null, settle_misses: 0 };
      let own = null;
      let message = null;
      for (let press = 0; press < PRESSES_PER_CELL; press++) {
        // A key that moves the message away gets a new message and a new context for each press. Other keys reuse the context.
        if (!own || key === "a") {
          if (own) await close_context(context, own);
          message = await by_header_id(`bulk-0-${key === "a" ? archive_index++ : 50}@fixture.invalid`);
          await messenger.messages.update(message.id, { read: true, flagged: false, junk: false, tags: [] });
          own = await open_context(context, message, folder);
          cell.settle_misses += own.settle_misses;
        } else {
          await messenger.messages.update(message.id, { read: true, flagged: false, junk: false, tags: [] });
          if (context === "thread" || context === "pane") {
            await messenger.mailTabs.setSelectedMessages(own.tab_id, [message.id]);
            await sleep(400);
          }
        }
        const before = await snapshot(message.headerMessageId, own);
        const seen = await press_and_collect(key_args(key), key === "r" || key === "R" ? 1800 : 1000);
        const after = await snapshot(message.headerMessageId, own);
        const changes = [];
        for (const field of Object.keys(before.state)) if (before.state[field] !== after.state[field]) changes.push(`${field}: ${before.state[field]} -> ${after.state[field]}`);
        if (before.selected !== after.selected) changes.push("selection moved");
        if (before.tabs !== after.tabs) changes.push(`tabs: ${before.tabs} -> ${after.tabs}`);
        if (before.windows !== after.windows) changes.push(`windows: ${before.windows} -> ${after.windows}`);
        if (changes.length) cell.acted++;
        for (const change of changes) cell.changes.add(change);
        if (seen.chrome.some((label) => label.startsWith("top_capture"))) cell.chrome_top_capture_seen++;
        if (seen.chrome.some((label) => label.includes("CANCELLED"))) cell.cancelled_flag++;
        if (seen.order.includes("top_bubble")) cell.top_bubble_seen++;
        if (seen.order.includes("about3pane_capture")) cell.about3pane_seen++;
        if (seen.content.length) cell.content_script_seen++;
        cell.order_first_press ??= seen.order;
        // Extra tabs and windows that the key opened (Enter, r, R) go away. The context's own tab or window stays.
        for (const tab of await messenger.tabs.query({})) if (tab.type !== "mail" && tab.id !== own.opened_id) await messenger.tabs.remove(tab.id).catch(() => {});
        for (const window of await messenger.windows.getAll({ windowTypes: ["messageCompose"] })) await messenger.windows.remove(window.id).catch(() => {});
        await sleep(300);
      }
      if (own) await close_context(context, own);
      cell.changes = [...cell.changes];
      out[`${key === " " ? "space" : key} ${mode}`] = cell;
    }
  }
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
    const settled = await settle();
    const seen = await press_and_collect(["x"], 500);
    out[`${index}_${target}`] = { settle_attempts_missed: settled, focus_after_verb: focus_chain, windows_active: (await messenger.probe.windows()).find((window) => window.type === "mail:3pane")?.active, ...seen };
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
  out.settle_attempts_missed = await settle();
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
  await settle().catch(() => {});
  out.message_tab = { windows: (await messenger.probe.windows()).map((window) => window.active), ...(await press_and_collect(["x"])) };
  await messenger.tabs.remove(message_tab.id);
  await sleep(500);

  const message_window = await messenger.messageDisplay.open({ location: "window", messageId: message.id });
  await sleep(2000);
  await settle().catch(() => {});
  out.message_window = { windows: (await messenger.probe.windows()).map((window) => `${window.type}:${window.focused}:${window.active}`), ...(await press_and_collect(["x"])) };
  await messenger.windows.remove((await messenger.windows.getAll({ windowTypes: ["messageDisplay"] }))[0].id).catch(() => {});
  await sleep(500);

  const content_tab = await messenger.tabs.create({ url: messenger.runtime.getURL("overlay.html") });
  await sleep(1500);
  await settle().catch(() => {});
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
  await settle().catch(() => {});
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
  await settle();
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
  // help.open needs a tab. Open one while the compose window is the active window and see where it goes.
  const created = await messenger.tabs.create({ url: messenger.runtime.getURL("overlay.html") });
  await sleep(800);
  const windows = await messenger.windows.getAll({ windowTypes: ["normal", "messageCompose", "messageDisplay"] });
  out.tabs_create_from_compose = { tab_type: created.type, tab_window_id: created.windowId, windows: windows.map((window) => `${window.id}:${window.type}:focused=${window.focused}`), tab_window_type: windows.find((window) => window.id === created.windowId)?.type ?? "unknown" };
  await messenger.tabs.remove(created.id).catch(() => {});
  await close_extra_windows();
  return out;
}

async function scenario_overlay() {
  const { inbox } = await find_folders();
  const tab_id = await show_folder(inbox);
  const out = {};
  for (const kind of ["iframe_3pane", "browser_3pane", "browser_top", "panel_top"]) {
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
      entry.process_info = await messenger.probe.process_info();
      entry.focus_after_verb = await messenger.probe.overlay_focus();
      await sleep(300);
      entry.settle_attempts_missed = await settle().catch(() => "none");
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

async function scenario_query_large() {
  const folders = await messenger.folders.query({});
  const big = folders.find((folder) => folder.name === "Big");
  const out = {};
  const start = performance.now();
  const tab_id = await show_folder(big, 240000);
  let count = 0;
  for (let attempt = 0; attempt < 600 && count !== 10000; attempt++) {
    try { count = (await collect(await messenger.messages.list(big.id))).length; } catch { count = -1; }
    if (count !== 10000) await sleep(500);
  }
  out.first_open_and_parse_ms = performance.now() - start;
  out.messages = count;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { await messenger.folders.getFolderInfo(big.id); break; } catch { await sleep(100); }
  }
  const series = {};
  const add = (name, ms) => (series[name] ??= []).push(ms);
  const counts = {};
  for (let run = 0; run < 31; run++) {
    const unread = await timed(async () => collect(await messenger.messages.query({ folderId: big.id, unread: true })));
    add("query_unread_one_folder_default_paging", unread.ms);
    counts.unread = unread.value.length;
    const unread_page = await timed(async () => collect(await messenger.messages.query({ folderId: big.id, unread: true, messagesPerPage: 12000, autoPaginationTimeout: 60000 })));
    add("query_unread_one_folder_one_page", unread_page.ms);
    const first = await timed(async () => (await messenger.messages.query({ folderId: big.id, unread: true, messagesPerPage: 1 })).messages.length);
    add("query_unread_first_hit_only", first.ms);
    const info = await timed(async () => (await messenger.folders.getFolderInfo(big.id)).unreadMessageCount);
    add("getFolderInfo", info.ms);
    counts.info_unread = info.value;
    const listed = await timed(async () => collect(await messenger.mailTabs.getListedMessages(tab_id)));
    add("getListedMessages", listed.ms);
    counts.listed = listed.value.length;
    const listed_all = await timed(async () => collect(await messenger.messages.list(big.id)));
    add("messages_list", listed_all.ms);
    counts.list = listed_all.value.length;
  }
  out.counts = counts;
  out.series = Object.fromEntries(Object.entries(series).map(([name, values]) => [name, { first_run_ms: values[0], ...stats(values.slice(1)) }]));
  return out;
}

async function scenario_message_process() {
  const folders = await messenger.folders.query({});
  const out = {};
  for (const [label, folder_name, header_id] of [["plain_text_message", "Inbox", "inbox-s2@fixture.invalid"], ["html_message", "Html", "html-0@fixture.invalid"]]) {
    const folder = folders.find((candidate) => candidate.name === folder_name);
    const tab_id = await show_folder(folder);
    const message = await by_header_id(header_id);
    await messenger.mailTabs.setSelectedMessages(tab_id, [message.id]);
    await sleep(1500);
    out[label] = await messenger.probe.process_info();
  }
  out.content_script_loads = content_events.filter((event) => event.type === "content_loaded").length;
  return out;
}

async function scenario_filter() {
  const { inbox } = await find_folders();
  const tab_id = await show_folder(inbox);
  await messenger.mailTabs.update(tab_id, { viewType: "ungrouped" }).catch(() => {});
  await sleep(600);
  for (const header_id of ["inbox-s5", "inbox-s6", "inbox-s7"]) {
    const message = await by_header_id(`${header_id}@fixture.invalid`);
    await messenger.messages.update(message.id, { tags: ["$label1"] });
  }
  const rows = async () => (await messenger.probe.view_snapshot()).row_count;
  const out = { rows_unfiltered: await rows() };
  const expected = async (query) => (await collect(await messenger.messages.query({ folderId: inbox.id, ...query }))).length;
  const cases = [
    ["filter.set unread", { unread: true }, await expected({ unread: true })],
    ["filter.set starred", { flagged: true }, await expected({ flagged: true })],
    ["filter.set tag", { tags: { mode: "any", tags: { $label1: true } } }, 3],
    ["filter.set attachment", { attachment: true }, 0],
    ["search.threads text in subject", { text: { text: "Single 1", subject: true } }, await expected({ subject: "Single 1" })],
  ];
  for (const [name, filter, expected_rows] of cases) {
    let error = null;
    try { await messenger.mailTabs.setQuickFilter(tab_id, filter); } catch (caught) { error = String(caught); }
    await sleep(1200);
    out[name] = { filter: JSON.stringify(filter), rows: await rows(), expected_rows, error };
    await messenger.mailTabs.setQuickFilter(tab_id, {}).catch(() => {});
    await sleep(800);
    out[name].rows_after_clear = await rows();
  }
  return out;
}

async function scenario_native_host() {
  const names = ["probe_mozilla", "probe_thunderbird", "probe_betterbird", "probe_config_mozilla", "probe_config_thunderbird", "probe_config_betterbird"];
  const out = {};
  for (const name of names) {
    out[name] = await new Promise((resolve) => {
      let port;
      try {
        port = messenger.runtime.connectNative(name);
      } catch (error) {
        resolve({ thrown: String(error) });
        return;
      }
      port.onDisconnect.addListener(() => resolve({ disconnected: true, error: port.error?.message ?? null }));
      setTimeout(() => resolve({ still_connected_after_3s: true }), 3000);
    });
  }
  return out;
}

// Runs in a profile whose account has no identity. The result file is written first because the app may crash in the call.
async function scenario_reply_no_identity() {
  const { inbox } = await find_folders();
  const tab_id = await show_folder(inbox);
  const message = await by_header_id("inbox-s2@fixture.invalid");
  await messenger.mailTabs.setSelectedMessages(tab_id, [message.id]);
  await post("/result", { name: "reply_no_identity", data: { status: "compose.beginReply called with no identity; if this stays, the app died in the call" } });
  const compose_tab = await messenger.compose.beginReply(message.id, "replyToSender");
  await sleep(3000);
  return { status: "beginReply returned and the app stayed up", compose_tab_id: compose_tab.id };
}

// Zoom per tab kind: what getBrowser() names, whether ZoomManager can set it, and whether the level stays across a message switch, a tab switch, a reopen and a navigation.
async function scenario_zoom() {
  const steps = [];
  const step = async (label, where, work) => {
    let value = null;
    try {
      if (work) await work();
      await sleep(1500);
      value = await messenger.probe.zoom_read(where);
    } catch (error) {
      value = { error: String(error) };
    }
    steps.push({ label, ...value });
  };
  const set = (label, where, level) => step(label, where, () => messenger.probe.zoom_set(where, level));
  const presence = { tabs_getZoom: typeof messenger.tabs.getZoom, tabs_setZoom: typeof messenger.tabs.setZoom };
  const { inbox, all } = await find_folders();
  const tab_id = await show_folder(inbox);
  const first = await by_header_id("inbox-s2@fixture.invalid");
  const second = await by_header_id("inbox-s3@fixture.invalid");
  await step("mail tab, no message", "main");
  await step("mail tab, message s2", "main", () => messenger.mailTabs.setSelectedMessages(tab_id, [first.id]));
  await set("mail tab, set 1.5", "main", 1.5);
  await step("mail tab, other message s3", "main", () => messenger.mailTabs.setSelectedMessages(tab_id, [second.id]));
  await step("mail tab, other folder html-0", "main", async () => {
    await show_folder(all.find((folder) => folder.name === "Html"));
    await messenger.mailTabs.setSelectedMessages(tab_id, [(await by_header_id("html-0@fixture.invalid")).id]);
  });
  const message_tab = await messenger.messageDisplay.open({ location: "tab", messageId: first.id, active: true });
  await step("message tab s2, fresh", "main");
  await set("message tab, set 1.3", "main", 1.3);
  await step("message tab, after mail tab and back", "main", async () => { await messenger.tabs.update(tab_id, { active: true }); await sleep(800); await messenger.tabs.update(message_tab.id, { active: true }); });
  await messenger.tabs.remove(message_tab.id);
  const second_tab = await messenger.messageDisplay.open({ location: "tab", messageId: second.id, active: true });
  await step("message tab s3, new tab", "main");
  await messenger.tabs.remove(second_tab.id);
  await step("mail tab after message tabs", "main", () => messenger.tabs.update(tab_id, { active: true }));
  await step("mail tab, back in Inbox on s2", "main", async () => { await show_folder(inbox); await messenger.mailTabs.setSelectedMessages(tab_id, [first.id]); });
  const window_one = await messenger.messageDisplay.open({ location: "window", messageId: first.id });
  await step("message window s2, fresh", "message_window");
  await set("message window, set 1.2", "message_window", 1.2);
  await messenger.windows.remove(window_one.windowId);
  const window_two = await messenger.messageDisplay.open({ location: "window", messageId: second.id });
  await step("message window s3, new window", "message_window");
  await messenger.windows.remove(window_two.windowId);
  for (const kind of ["calendar", "tasks", "addressbook", "settings"]) {
    await step(`${kind}, opened`, "main", () => messenger.probe.zoom_open(kind));
    const [front] = await messenger.tabs.query({ active: true, currentWindow: true });
    await set(`${kind}, set 1.4`, "main", 1.4);
    await step(`${kind}, after mail tab and back`, "main", async () => { await messenger.tabs.update(tab_id, { active: true }); await sleep(800); await messenger.tabs.update(front.id, { active: true }); });
    await messenger.tabs.remove(front.id).catch(() => {});
  }
  const own = await messenger.tabs.create({ url: "overlay.html" });
  await step("own page, opened", "main");
  await set("own page, set 1.4", "main", 1.4);
  await step("own page, reloaded", "main", () => messenger.tabs.reload(own.id));
  await messenger.tabs.remove(own.id);
  const own_again = await messenger.tabs.create({ url: "overlay.html" });
  await step("own page, new tab", "main");
  await messenger.tabs.remove(own_again.id);
  const web = await messenger.tabs.create({ url: `http://127.0.0.1:${CONFIG.port}/zoom_page_one` });
  await step("web page, opened", "main");
  await set("web page, set 1.4", "main", 1.4);
  await step("web page, same host other path", "main", () => messenger.tabs.update(web.id, { url: `http://127.0.0.1:${CONFIG.port}/zoom_page_two` }));
  await messenger.tabs.remove(web.id);
  await step("mail tab at the end", "main", () => messenger.tabs.update(tab_id, { active: true }));
  return { presence, steps };
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
  const scenarios = {
    env: scenario_env,
    api_presence: async () => api_presence(),
    rtt: scenario_rtt,
    key_latency: scenario_key_latency,
    threads: scenario_threads,
    query: scenario_query,
    query_large: scenario_query_large,
    focus_targets: scenario_focus_targets,
    keys_thread: () => scenario_keys_context("thread"),
    keys_pane: () => scenario_keys_context("pane"),
    keys_tab: () => scenario_keys_context("tab"),
    keys_window: () => scenario_keys_context("window"),
    message_pane: scenario_message_pane,
    message_process: scenario_message_process,
    window_types: scenario_window_types,
    compose: scenario_compose,
    overlay: scenario_overlay,
    filter: scenario_filter,
    native_host: scenario_native_host,
    reply_no_identity: scenario_reply_no_identity,
    tabs_remove: scenario_tabs_remove,
    tabs_remove_only_tab: scenario_tabs_remove_only_tab,
    zoom: scenario_zoom,
  };
  for (const [name, scenario] of Object.entries(scenarios)) await record(name, scenario);
  await post("/done", {});
}

start().catch((error) => log("fatal", String(error), String(error.stack)));
