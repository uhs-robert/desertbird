// The `web` kind: the page actor's keys in a web page of a local server (`web_fixture.mjs`) and in another add-on's page, each opened with no click. The page reports every key its own listener saw, its scroll and its focus, so each check reads what the page got. Takes the helpers of `run.mjs` as arguments, as `pages_checks.mjs` does.
// Run alone with `E2E_KINDS=web`. Each run starts its own fixture server and closes it in a `finally`.

import { start_web_fixture } from "./web_fixture.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ALT = (key) => ["-M", "alt", "-k", key, "-m", "alt"];
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export async function run_web(instance, { check, note, shot, open_inbox, restart }) {
  const fixture = await start_web_fixture();
  try {
    await run_web_rows(instance, { check, note, shot, open_inbox, restart, fixture });
  } finally {
    await fixture.close();
  }
}

async function run_web_rows(instance, { check, note, shot, open_inbox, restart, fixture }) {
  const app = instance.app;
  const kind = "web";
  await open_inbox(instance);
  const only_hints = process.env.E2E_ONLY === "web_hints";
  const tabs_of = async () => (await instance.ask("state")).windows.find((window) => window.type === "normal")?.tabs ?? [];
  const active_index = async () => (await tabs_of()).find((tab) => tab.active)?.index;
  const before = (await tabs_of()).length;
  const latest = () => fixture.latest() ?? {};

  // Waits for a report that `wanted` accepts, from index `from` on.
  async function report_after(from, wanted, ms = 8000) {
    for (let waited = 0; waited < ms; waited += 200) {
      const found = fixture.log.slice(from).find(wanted);
      if (found) return found;
      await sleep(200);
    }
    return null;
  }
  // Opens a web page in a new tab and waits until the page reported its pageshow. The child says hello at DOMContentLoaded, so a short wait after the report lets its answer arrive.
  async function open_web(query = "") {
    const from = fixture.log.length;
    await instance.ask("open_web_tab", 20000, { url: fixture.url(query) });
    const shown = await report_after(from, (entry) => entry.kind === "pageshow");
    await sleep(1500);
    return shown !== null;
  }
  // Presses keys and returns the scroll the page reported after them and the keys its own listener saw.
  async function press_and_read(keys, wait_ms = 1200) {
    const from = fixture.log.length;
    for (const key of keys) await instance.press(key);
    await sleep(wait_ms);
    return { from, scroll_y: latest().scroll_y ?? 0, seen: fixture.keys_since(from), latest: latest() };
  }
  async function close_extra_tabs() {
    await instance.ask("reset_tabs", 20000);
    await sleep(800);
  }

  if (only_hints) return run_web_hint_rows(instance, { check, note, shot, fixture, open_web, press_and_read, close_extra_tabs, report_after, tabs_of });
  // Normal mode, no click: the actor's child takes the bound keys before the page.
  check(app, kind, "a web page of the local server opens in a tab", await open_web());
  const start_y = latest().scroll_y ?? 0;
  const after_j = await press_and_read([["j"]]);
  check(app, kind, "j scrolls the web page down with no click first", after_j.scroll_y > start_y, `scroll ${start_y} then ${after_j.scroll_y}`);
  check(app, kind, "the page never saw the j", !after_j.seen.includes("j"), `page saw ${JSON.stringify(after_j.seen)}`);
  await shot("web_after_j", "web page after j: scrolled down a line, no click");
  const counted = await press_and_read([["3"], ["j"]]);
  check(app, kind, "3 j scrolls three lines, and the page saw neither key", counted.scroll_y - after_j.scroll_y >= 100 && counted.seen.length === 0, `scroll ${after_j.scroll_y} then ${counted.scroll_y}, page saw ${JSON.stringify(counted.seen)}`);
  const half = await press_and_read([CTRL("d")]);
  check(app, kind, "Ctrl+D scrolls half a page, and the page did not see it", half.scroll_y - counted.scroll_y > 150 && !half.seen.includes("d"), `scroll ${counted.scroll_y} then ${half.scroll_y}, page saw ${JSON.stringify(half.seen)}`);
  const bottom = await press_and_read([["G"]]);
  check(app, kind, "G scrolls to the bottom", bottom.scroll_y > 3000, `scroll ${bottom.scroll_y}`);
  const top = await press_and_read([["g"], ["g"]]);
  check(app, kind, "g g scrolls back to the top across two child keys", top.scroll_y === 0 && top.seen.length === 0, `scroll ${top.scroll_y}, page saw ${JSON.stringify(top.seen)}`);
  const unbound = await press_and_read([["x"]]);
  check(app, kind, "x, which the page tree does not bind, reaches the page", unbound.seen.includes("x"), `page saw ${JSON.stringify(unbound.seen)}`);
  // `m` and `0` follow a prefix in the page tree (`t m`, `t 0`) and bind nothing as first keys, so a site's own `m` (mute) and `0` keep working.
  const second_keys = await press_and_read([["m"], ["0"]]);
  check(app, kind, "m and 0, which bind only after a prefix, reach the page", second_keys.seen.includes("m") && second_keys.seen.includes("0"), `page saw ${JSON.stringify(second_keys.seen)}`);
  const broken = await press_and_read([["g"], ["x"], ["j"]]);
  check(app, kind, "g then an unbound x ends the sequence: the page gets x, and j then scrolls", broken.seen.includes("x") && !broken.seen.includes("g") && broken.scroll_y > top.scroll_y, `scroll ${top.scroll_y} then ${broken.scroll_y}, page saw ${JSON.stringify(broken.seen)}`);
  const web_index = await active_index();
  await instance.press(["K"]);
  await sleep(1000);
  check(app, kind, "K switches to the tab before the web page", (await active_index()) === web_index - 1, `active ${await active_index()}, web tab ${web_index}`);
  await instance.ask("select_tab", 20000, { index: web_index });
  await sleep(1500);
  const back = await press_and_read([["j"]]);
  check(app, kind, "back on the web tab, j scrolls again with no click", back.scroll_y > 0, `scroll ${back.scroll_y}`);
  await close_extra_tabs();

  // A text field of the web page: plain keys are text, the typing chords still run, Escape leaves it.
  check(app, kind, "the web page opens with its text field focused", await open_web("&focus=field"));
  const typed = await press_and_read([["q"]]);
  check(app, kind, "q in the web page's field is text and closes no tab", typed.latest.value === "q" && (await tabs_of()).length === before + 1, `value ${JSON.stringify(typed.latest.value)}, tabs ${(await tabs_of()).length}`);
  const field_index = await active_index();
  await instance.press(ALT("k"));
  await sleep(1000);
  check(app, kind, "Alt+k in the web page's field switches tab", (await active_index()) === field_index - 1, `active ${await active_index()}`);
  await instance.ask("select_tab", 20000, { index: field_index });
  await sleep(1500);
  await instance.press(["-k", "Escape"]);
  await sleep(1000);
  check(app, kind, "Escape leaves the web page's field", latest().active !== "field", `active ${latest().active}`);
  await shot("web_after_escape", "web page after Escape in its field: the field has lost the focus");
  await instance.press(["q"]);
  await sleep(1500);
  check(app, kind, "after Escape, q closes the web tab", (await tabs_of()).length === before, `tabs ${(await tabs_of()).length}`);
  await close_extra_tabs();

  // A page that uses Escape keeps it: the page clears its field and the focus stays there.
  check(app, kind, "the web page opens with a field that clears on Escape", (await open_web("&escape_clears=1&focus=field")) && latest().active === "field", `active ${latest().active}`);
  await instance.press(["abc"]);
  await sleep(500);
  const cleared = await press_and_read([["-k", "Escape"]]);
  check(app, kind, "the page's own Escape clears its field", cleared.latest.value === "" && cleared.seen.includes("Escape"), `value ${JSON.stringify(cleared.latest.value)}, page saw ${JSON.stringify(cleared.seen)}`);
  const kept = await press_and_read([["q"]], 1500);
  check(app, kind, "an Escape the page used does not blur its field, so q types and closes nothing", (await tabs_of()).length === before + 1 && kept.latest.value === "q", `tabs ${(await tabs_of()).length}, value ${JSON.stringify(kept.latest.value)}`);
  await close_extra_tabs();

  // Insert mode: the child drops every plain key at once, and Escape, a tab change or a new page ends it.
  check(app, kind, "the web page opens for insert mode", await open_web());
  await instance.press(["i"]);
  await sleep(700);
  const inserted = await press_and_read([["j"]]);
  check(app, kind, "after i, j reaches the page and does not scroll", inserted.seen.includes("j") && inserted.scroll_y === 0, `scroll ${inserted.scroll_y}, page saw ${JSON.stringify(inserted.seen)}`);
  await shot("web_insert", "web page in insert mode: the mode label shows insert");
  await instance.press(["-k", "Escape"]);
  await sleep(700);
  const left = await press_and_read([["j"]]);
  check(app, kind, "Escape ends insert mode, so j scrolls again", left.scroll_y > 0 && !left.seen.includes("j"), `scroll ${left.scroll_y}, page saw ${JSON.stringify(left.seen)}`);
  await instance.press(["i"]);
  await sleep(500);
  const insert_index = await active_index();
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(800);
  await instance.ask("select_tab", 20000, { index: insert_index });
  await sleep(1500);
  const changed = await press_and_read([["j"]]);
  check(app, kind, "a tab change ends insert mode, so j scrolls", changed.scroll_y > left.scroll_y && !changed.seen.includes("j"), `scroll ${left.scroll_y} then ${changed.scroll_y}, page saw ${JSON.stringify(changed.seen)}`);
  await instance.press(["i"]);
  await sleep(500);
  // In insert mode `n` is the page's, and the page loads its second page on it.
  const from_navigation = fixture.log.length;
  await instance.press(["n"]);
  const second = await report_after(from_navigation, (entry) => entry.kind === "pageshow" && entry.page.includes("second=1"));
  await sleep(1500);
  check(app, kind, "in insert mode n reaches the page, which loads its second page", second !== null);
  const navigated = await press_and_read([["j"]]);
  check(app, kind, "a new page ends insert mode, so j scrolls it", navigated.scroll_y > 0 && !navigated.seen.includes("j"), `scroll ${navigated.scroll_y}, page saw ${JSON.stringify(navigated.seen)}`);
  // `b` goes back. The first page may come back from the back-forward cache with its old child, which asks again.
  const from_back = fixture.log.length;
  await instance.press(["b"]);
  const restored = await report_after(from_back, (entry) => entry.kind === "pageshow" && !entry.page.includes("second=1"));
  await sleep(1500);
  note(app, kind, "the first page comes back from the back-forward cache", restored === null ? "no pageshow seen" : `persisted ${restored.persisted}`);
  const before_back_j = latest().scroll_y ?? 0;
  const after_back = await press_and_read([["j"]]);
  check(app, kind, "after going back, j scrolls the first page", restored !== null && after_back.scroll_y > before_back_j && !after_back.seen.includes("j"), `scroll ${before_back_j} then ${after_back.scroll_y}, page saw ${JSON.stringify(after_back.seen)}`);
  await close_extra_tabs();

  // A same-origin frame runs in the page's process, but the child runs in the top page only (allFrames false).
  check(app, kind, "the web page opens for the frame probe", await open_web("&focus=frame"));
  const framed = await press_and_read([["j"]]);
  note(app, kind, "j with the focus in a same-origin frame", `page scroll ${framed.scroll_y}, the top page saw ${JSON.stringify(framed.seen)}`);
  await close_extra_tabs();

  // Another add-on's page (the helper's own) is a moz-extension page in the extension process.
  const from_helper = fixture.log.length;
  await instance.ask("open_helper_page", 20000, { log: fixture.port });
  const helper_shown = await report_after(from_helper, (entry) => entry.kind === "pageshow");
  await sleep(1500);
  check(app, kind, "another add-on's page opens in a tab", helper_shown !== null);
  const helper_j = await press_and_read([["j"]]);
  check(app, kind, "j scrolls another add-on's page, and the page never saw it", helper_j.scroll_y > 0 && !helper_j.seen.includes("j"), `scroll ${helper_j.scroll_y}, page saw ${JSON.stringify(helper_j.seen)}`);
  await close_extra_tabs();

  // The command line still opens over a web tab, and its keys stay its own.
  check(app, kind, "the web page opens for the command line check", await open_web());
  const from_cmdline = fixture.log.length;
  await instance.press([":"]);
  await sleep(1500);
  await shot("web_cmdline", "command line open over the web page");
  await instance.press(["tab.close"]);
  await instance.press(["-k", "Return"]);
  await sleep(2000);
  check(app, kind, ": opens the command line over a web tab, and tab.close typed there closes it", (await tabs_of()).length === before && fixture.keys_since(from_cmdline).length === 0, `tabs ${(await tabs_of()).length}, page saw ${JSON.stringify(fixture.keys_since(from_cmdline))}`);
  await close_extra_tabs();

  await run_web_hint_rows(instance, { check, note, shot, fixture, open_web, press_and_read, close_extra_tabs, report_after, tabs_of });

  // The mail tab keeps its keys with the actor running.
  await instance.ask("select_tab", 20000, { index: 0 });
  await sleep(800);
  const selected = async () => (await instance.ask("state")).selected[0]?.header_id ?? null;
  const first = await selected();
  await instance.press(["j"]);
  await sleep(1000);
  check(app, kind, "the mail tab's j still moves the thread list", (await selected()) !== first, `selected ${first} then ${await selected()}`);

  // A page open before the add-on starts: the app restores the tab at startup, so its child may load before the actor is registered. The start reaches it, so j scrolls with no click.
  check(app, kind, "the web page opens before the restart", await open_web());
  await restart(instance, app, kind, "pages open at startup check");
  const restored_tabs = await tabs_of();
  const restored_web = restored_tabs.find((tab) => String(tab.raw?.url ?? "").startsWith(`http://127.0.0.1:${fixture.port}/`));
  if (!restored_web) note(app, kind, "the web tab after a restart", `not restored: ${JSON.stringify(restored_tabs.map((tab) => tab.raw?.url ?? tab.type))}`);
  else {
    await instance.ask("select_tab", 20000, { index: restored_web.index });
    await sleep(2000);
    const before_restart_j = latest().scroll_y ?? 0;
    const restarted = await press_and_read([["j"]], 1500);
    check(app, kind, "after a restart, j scrolls the restored web page with no click", restarted.scroll_y > before_restart_j && !restarted.seen.includes("j"), `scroll ${before_restart_j} then ${restarted.scroll_y}, page saw ${JSON.stringify(restarted.seen)}`);
  }
  check(app, kind, "the app survived", instance.exited() === null);
}

// The hint keys in a web page and in another add-on's page. The page's child draws the labels in the page, in one container on the root element, so the page's report of its root children tells whether labels show. Labels follow document order: a the field, s the button, d the link, f the contenteditable. A yank skips the field, which has no text, so there s is the link.
// The page keys hold plain keys for 1.5 s after f (`HOLD_MS`), so each pick waits that out before the next f.
async function run_web_hint_rows(instance, { check, note, shot, fixture, open_web, press_and_read, close_extra_tabs, report_after, tabs_of }) {
  const app = instance.app;
  const kind = "web";
  const BASE_CHILDREN = 2;
  // The root children the page reported last, so a page that never changed them reads as the head and body alone.
  const children = (from = 0) => fixture.log.slice(from).filter((entry) => entry.kind === "children").at(-1)?.children ?? BASE_CHILDREN;
  async function labels_shown_by(keys) {
    const from = fixture.log.length;
    for (const key of keys) await instance.press(key);
    return (await report_after(from, (entry) => entry.kind === "children" && entry.children > BASE_CHILDREN, 6000)) !== null;
  }
  const pick = (keys) => press_and_read(keys, 1800);
  const clicks_since = (from) => fixture.log.slice(from).filter((entry) => entry.kind === "click").map((entry) => entry.target);

  check(app, kind, "the web page opens for the hint keys", await open_web());
  check(app, kind, "f shows hint labels in the web page", await labels_shown_by([["f"]]), `root children ${children()}`);
  await shot("web_hints", "web page with hint labels on the field, the button, the link and the editable text");
  const button = await pick([["s"]]);
  check(app, kind, "the button's label clicks it and ends the labels, and the page saw neither key", clicks_since(button.from).includes("button") && children() === BASE_CHILDREN && button.seen.length === 0, `clicks ${JSON.stringify(clicks_since(button.from))}, root children ${children()}, page saw ${JSON.stringify(button.seen)}`);

  await labels_shown_by([["f"]]);
  const link = await pick([["d"]]);
  check(app, kind, "the link's label clicks the link", clicks_since(link.from).includes("link"), `clicks ${JSON.stringify(clicks_since(link.from))}`);

  check(app, kind, "; f shows labels", await labels_shown_by([[";"], ["f"]]));
  const focused = await pick([["a"]]);
  check(app, kind, "; f then the field's label focuses the field and types nothing in it", focused.latest.active === "field" && focused.latest.value === "" && focused.seen.length === 0, `active ${focused.latest.active}, value ${JSON.stringify(focused.latest.value)}, page saw ${JSON.stringify(focused.seen)}`);
  await instance.press(["-k", "Escape"]);
  await press_and_read([], 1800);

  check(app, kind, "; c shows labels", await labels_shown_by([[";"], ["c"]]));
  const clicked = await pick([["s"]]);
  check(app, kind, "; c then the button's label clicks the button", clicks_since(clicked.from).includes("button"), `clicks ${JSON.stringify(clicks_since(clicked.from))}`);

  await instance.ask("clear_clipboard");
  check(app, kind, "; y shows labels", await labels_shown_by([[";"], ["y"]]));
  await pick([["s"]]);
  const clipboard = (await instance.ask("read_clipboard")).text ?? "";
  check(app, kind, "; y then the link's label copies the link address", clipboard.startsWith(`http://127.0.0.1:${fixture.port}/page`) && clipboard.endsWith("#hinted"), `clipboard ${JSON.stringify(clipboard)}`);

  await labels_shown_by([["f"]]);
  const escaped = await pick([["-k", "Escape"]]);
  check(app, kind, "Escape ends the labels, and the page never saw it", children() === BASE_CHILDREN && escaped.seen.length === 0, `root children ${children()}, page saw ${JSON.stringify(escaped.seen)}`);
  await labels_shown_by([["f"]]);
  const other = await pick([["x"]]);
  check(app, kind, "a key no label starts ends the labels, and the page never saw it", children() === BASE_CHILDREN && other.seen.length === 0, `root children ${children()}, page saw ${JSON.stringify(other.seen)}`);
  // f is a label letter too: a second f narrows to the contenteditable and does not start a second pick.
  await labels_shown_by([["f"]]);
  const second = await pick([["f"]]);
  check(app, kind, "a second f while labels show picks its label, the contenteditable", second.latest.active === "editor" && children() === BASE_CHILDREN && second.seen.length === 0, `active ${second.latest.active}, root children ${children()}, page saw ${JSON.stringify(second.seen)}`);
  await instance.press(["-k", "Escape"]);
  await press_and_read([], 1800);

  // A tab change and a window blur end the labels: the parent's state push reaches the child.
  const web_index = (await tabs_of()).find((tab) => tab.active)?.index;
  await labels_shown_by([["f"]]);
  await instance.ask("select_tab", 20000, { index: 0 });
  await press_and_read([], 1000);
  check(app, kind, "a tab change ends the labels", children() === BASE_CHILDREN, `root children ${children()}`);
  await instance.ask("select_tab", 20000, { index: web_index });
  await press_and_read([], 1500);
  check(app, kind, "f shows labels again after the tab change", await labels_shown_by([["f"]]));
  const popup = await instance.ask("open_popup_window", 20000);
  await press_and_read([], 1500);
  await instance.ask("close_popup_window", 20000, { id: popup.opened });
  await press_and_read([], 1500);
  check(app, kind, "a window blur ends the labels", children() === BASE_CHILDREN, `root children ${children()}`);
  await close_extra_tabs();

  // The command line hands the focus back to the window, and the pick gives it to the page, whose child reads the label keys.
  check(app, kind, "the web page opens for the command line pick", await open_web());
  await instance.press([":"]);
  await press_and_read([], 1500);
  await instance.press(["hint"]);
  check(app, kind, "hint typed on the command line shows labels in the web page", await labels_shown_by([["-k", "Return"]]));
  const after_cmdline = await pick([["s"]]);
  check(app, kind, "a label typed after the command line pick clicks the button", clicks_since(after_cmdline.from).includes("button") && after_cmdline.seen.length === 0, `clicks ${JSON.stringify(clicks_since(after_cmdline.from))}, page saw ${JSON.stringify(after_cmdline.seen)}`);
  await close_extra_tabs();

  // The page moves the focus into its field while the labels show. The keys typed then still go to the labels and never to the field.
  check(app, kind, "the web page opens to focus its field once labels show", await open_web("&focus_after=field"));
  const from_f = fixture.log.length;
  check(app, kind, "f shows labels before the page focuses its field", await labels_shown_by([["f"]]));
  const field_focused = await report_after(from_f, (entry) => entry.kind === "focusin" && entry.active === "field" && entry.page.includes("focus_after"), 6000);
  const in_field = await pick([["x"]]);
  const seen_since_f = fixture.keys_since(from_f);
  check(app, kind, "neither f nor a key typed while labels show reaches the page or its focused field", field_focused !== null && in_field.latest.value === "" && seen_since_f.length === 0 && children() === BASE_CHILDREN, `field focused ${field_focused !== null}, value ${JSON.stringify(in_field.latest.value)}, page saw ${JSON.stringify(seen_since_f)}, root children ${children()}`);
  await close_extra_tabs();

  // Another add-on's page: its one field gets the label a.
  const from_helper = fixture.log.length;
  await instance.ask("open_helper_page", 20000, { log: fixture.port });
  const helper_shown = await report_after(from_helper, (entry) => entry.kind === "pageshow");
  await press_and_read([], 1500);
  check(app, kind, "f shows labels in another add-on's page", helper_shown !== null && (await labels_shown_by([["f"]])));
  const helper_pick = await pick([["a"]]);
  check(app, kind, "the label in another add-on's page focuses its field", helper_pick.latest.active === "field" && helper_pick.seen.length === 0, `active ${helper_pick.latest.active}, page saw ${JSON.stringify(helper_pick.seen)}`);
  await close_extra_tabs();
}
