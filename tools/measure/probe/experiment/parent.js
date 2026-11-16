// Throwaway Experiment for the phase 0 measurements. Typed verbs only: no eval, no free-string command, no free URL.
var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionUtils } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");
var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

var probe = class extends ExtensionAPI {
  getAPI(context) {
    const extension = context.extension;
    const key_listeners = new Set();
    const ping_listeners = new Set();
    const pending_pongs = new Map();
    const hooked = new WeakMap();
    const keep_timers = new Set();
    const state = { cancel: new Set(), listening: false, overlay: null };
    const TOP_WINDOW_URLS = [
      "chrome://messenger/content/messenger.xhtml",
      "chrome://messenger/content/messageWindow.xhtml",
      "chrome://messenger/content/messengercompose/messengercompose.xhtml",
    ];

    // The browser console, so a failed API call can show its real cause instead of "An unexpected error occurred".
    const console_lines = [];
    const console_listener = { observe: (message) => { if (message.flags === undefined || message.flags < 2 || message.message) console_lines.push(String(message.message).slice(0, 400)); if (console_lines.length > 60) console_lines.shift(); } };
    Services.console.registerListener(console_listener);

    const emit_key = (info) => { for (const listener of key_listeners) listener(info); };

    function describe(node) {
      if (!node) return "";
      const name = node.localName || node.nodeName || "";
      return `${name}${node.id ? "#" + node.id : ""}`;
    }

    function window_type(win) {
      return win.document.documentElement.getAttribute("windowtype") || win.document.documentURI;
    }

    function focus_chain(doc) {
      const chain = [];
      let current = doc;
      for (let depth = 0; current && depth < 6; depth++) {
        const active = current.activeElement;
        chain.push(`${describe(active)}`);
        if (active && active.contentDocument) current = active.contentDocument;
        else if (active && active.localName === "browser" && active.contentDocument) current = active.contentDocument;
        else break;
      }
      return chain.join(" > ");
    }

    function key_handler(level, win_type) {
      return (event) => {
        if (!state.listening) return;
        const cancelled = level === "top_capture" && state.cancel.has(event.key);
        emit_key({
          level,
          win_type,
          key: event.key,
          code: event.code,
          shift: event.shiftKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          phase: event.eventPhase,
          target: describe(event.target),
          origin_doc: event.originalTarget?.ownerDocument?.documentURI ?? "",
          trusted: event.isTrusted,
          cancelled,
          t: ChromeUtils.now(),
        });
        if (cancelled) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
    }

    function hook(target, level, win_type, capture) {
      if (!target || hooked.get(target)?.has(level)) return;
      hooked.set(target, (hooked.get(target) ?? new Set()).add(level));
      target.addEventListener("keydown", key_handler(level, win_type), capture);
    }

    function main_windows() {
      return Array.from(Services.wm.getEnumerator("mail:3pane"));
    }

    function about3pane(win) {
      const tabmail = win.document.getElementById("tabmail");
      const first = tabmail?.tabInfo?.[0];
      return first?.chromeBrowser?.contentWindow ?? null;
    }

    function hook_inner() {
      for (const win of main_windows()) {
        const three = about3pane(win);
        if (!three) continue;
        hook(three, "about3pane_capture", "mail:3pane", true);
        const message = three.messageBrowser?.contentWindow;
        hook(message, "aboutmessage_capture", "mail:3pane", true);
        const tabmail = win.document.getElementById("tabmail");
        for (const tab of tabmail.tabInfo) {
          const inner = tab.chromeBrowser?.contentWindow;
          if (inner && inner !== three) hook(inner, `tab_${tab.mode.name}_capture`, "mail:3pane", true);
        }
      }
    }

    function hook_top(win) {
      const win_type = window_type(win);
      hook(win, "top_capture", win_type, true);
      hook(win, "top_bubble", win_type, false);
    }

    ExtensionSupport.registerWindowListener("probe@desertbird.invalid", {
      chromeURLs: TOP_WINDOW_URLS,
      onLoadWindow: (win) => hook_top(win),
    });

    function make_browser(doc) {
      const browser = doc.createXULElement("browser");
      browser.setAttribute("type", "content");
      browser.setAttribute("disableglobalhistory", "true");
      browser.setAttribute("messagemanagergroup", "webext-browsers");
      browser.setAttribute("webextension-view-type", "popup");
      browser.setAttribute("maychangeremoteness", "true");
      browser.toggleAttribute("nodefaultsrc", true);
      browser.setAttribute("initialBrowsingContextGroupId", extension.policy.browsingContextGroupId);
      if (extension.remote) {
        browser.toggleAttribute("remote", true);
        browser.setAttribute("remoteType", extension.remoteType);
      }
      browser.style.cssText = "width: 100%; height: 100%; border: 0;";
      return browser;
    }

    // The frame loader of a remote browser exists only after the browser is in the document, and its event can fire before a listener added later, so the caller passes in the promise.
    async function load_in_browser(browser, created) {
      await created;
      ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
      browser.messageManager.loadFrameScript("chrome://extensions/content/ext-browser-content.js", false, true);
      browser.messageManager.sendAsyncMessage("Extension:InitBrowser", { allowScriptsToClose: true, blockParser: false, fixedWidth: false, maxWidth: 800, maxHeight: 600, stylesheets: [] });
      browser.fixupAndLoadURIString(extension.baseURI.resolve("overlay.html"), { triggeringPrincipal: extension.principal });
    }

    const BOX_CSS = "position: fixed; left: 360px; width: 700px; bottom: 100px; height: 90px; z-index: 100000; border: 3px solid red; background: white;";

    const api = {
      probe: {
        async install_keys(cancel_keys) {
          state.cancel = new Set(cancel_keys);
          state.listening = true;
          for (const win of Services.wm.getEnumerator(null)) {
            if (TOP_WINDOW_URLS.includes(win.document.documentURI)) hook_top(win);
          }
          hook_inner();
          return true;
        },
        async set_cancel(cancel_keys) {
          state.cancel = new Set(cancel_keys);
          hook_inner();
        },
        async windows() {
          hook_inner();
          const result = [];
          for (const win of Services.wm.getEnumerator(null)) {
            const entry = { type: window_type(win), url: win.document.documentURI, active: focus_chain(win.document), focused: win === Services.focus.activeWindow, tabs: [] };
            const tabmail = win.document.getElementById?.("tabmail");
            if (tabmail?.tabInfo) {
              for (const tab of tabmail.tabInfo) entry.tabs.push({ mode: tab.mode.name, url: tab.chromeBrowser?.currentURI?.spec ?? tab.browser?.currentURI?.spec ?? "", remote: !!(tab.browser?.isRemoteBrowser) });
            }
            result.push(entry);
          }
          return result;
        },
        async focus(target) {
          const three = about3pane(main_windows()[0]);
          if (target === "folders") three.folderTree.focus();
          else if (target === "threads") three.threadTree.table.body.focus();
          else if (target === "message") three.messageBrowser.focus();
          else three.messageBrowser.contentWindow.document.getElementById("messagepane").focus();
          return focus_chain(main_windows()[0].document);
        },
        async view_snapshot() {
          const three = about3pane(main_windows()[0]);
          const view = three.gDBView;
          if (!view) return { rows: 0 };
          const rows = [];
          for (let index = 0; index < Math.min(view.rowCount, 300); index++) {
            rows.push({ message_id: view.getMsgHdrAt(index).messageId, level: view.getLevel(index), container: view.isContainer(index), open: view.isContainer(index) ? view.isContainerOpen(index) : null });
          }
          return {
            row_count: view.rowCount,
            selected: Array.from(three.threadTree.selectedIndices ?? []),
            current: three.threadTree.currentIndex,
            rows,
            active: focus_chain(main_windows()[0].document),
          };
        },
        async view_fold(open) {
          const three = about3pane(main_windows()[0]);
          three.gDBView.doCommand(open ? Ci.nsMsgViewCommandType.expandAll : Ci.nsMsgViewCommandType.collapseAll);
          return three.gDBView.rowCount;
        },
        async view_select_row(row) {
          const three = about3pane(main_windows()[0]);
          three.threadTree.selectedIndex = row;
          return three.threadTree.selectedIndex;
        },
        async overlay_mount(kind) {
          const win = main_windows()[0];
          const three = about3pane(win);
          const start = ChromeUtils.now();
          if (state.overlay) state.overlay.remove();
          let node;
          let details = {};
          const setTimeout_ = (callback, ms, value) => { const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer); timer.initWithCallback({ notify: () => callback(value) }, ms, Ci.nsITimer.TYPE_ONE_SHOT); keep_timers.add(timer); };
          if (kind === "iframe_3pane") {
            const doc = three.document;
            node = doc.createElementNS("http://www.w3.org/1999/xhtml", "iframe");
            node.id = "probe-overlay";
            node.style.cssText = BOX_CSS;
            doc.documentElement.appendChild(node);
            const url = extension.baseURI.resolve("overlay.html");
            const loaded_once = new Promise((resolve) => node.addEventListener("load", () => resolve(node.contentWindow.location.href), { once: true }));
            node.setAttribute("src", url);
            let loaded = await Promise.race([loaded_once, new Promise((resolve) => setTimeout_(resolve, 3000, false))]);
            let via = "src attribute";
            if (!loaded || loaded === "about:blank") {
              via = "location.href after the src attribute failed";
              node.contentWindow.location.href = url;
              loaded = await Promise.race([new Promise((resolve) => node.addEventListener("load", () => resolve(node.contentWindow.location.href), { once: true })), new Promise((resolve) => setTimeout_(resolve, 3000, false))]);
            }
            details = { via, load_fired: loaded, href: node.contentWindow?.location?.href, ready_state: node.contentDocument?.readyState, box: JSON.stringify(node.getBoundingClientRect()) };
          } else if (kind === "browser_3pane") {
            const doc = three.document;
            node = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
            node.id = "probe-overlay";
            node.style.cssText = BOX_CSS;
            const browser = make_browser(doc);
            const created = new Promise((resolve) => browser.addEventListener("XULFrameLoaderCreated", resolve, { once: true }));
            node.appendChild(browser);
            doc.documentElement.appendChild(node);
            details = { load_started: await Promise.race([load_in_browser(browser, created).then(() => true), new Promise((resolve) => setTimeout_(resolve, 4000, "timeout"))]), box: JSON.stringify(node.getBoundingClientRect()) };
          } else if (kind === "browser_top") {
            const doc = win.document;
            node = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
            node.id = "probe-overlay";
            node.style.cssText = BOX_CSS;
            const browser = make_browser(doc);
            const created = new Promise((resolve) => browser.addEventListener("XULFrameLoaderCreated", resolve, { once: true }));
            node.appendChild(browser);
            doc.documentElement.appendChild(node);
            details = { load_started: await Promise.race([load_in_browser(browser, created).then(() => true), new Promise((resolve) => setTimeout_(resolve, 4000, "timeout"))]), box: JSON.stringify(node.getBoundingClientRect()) };
          } else {
            const doc = win.document;
            node = doc.createXULElement("panel");
            node.id = "probe-overlay";
            node.setAttribute("noautohide", "true");
            node.setAttribute("type", "arrow");
            node.style.cssText = "width: 600px; height: 90px;";
            const browser = make_browser(doc);
            const created = new Promise((resolve) => browser.addEventListener("XULFrameLoaderCreated", resolve, { once: true }));
            node.appendChild(browser);
            doc.documentElement.appendChild(node);
            node.openPopupAtScreen(360, 300, false);
            details = { load_started: await Promise.race([load_in_browser(browser, created).then(() => true), new Promise((resolve) => setTimeout_(resolve, 4000, "timeout"))]), state: node.state };
          }
          state.overlay = node;
          return { ms: ChromeUtils.now() - start, kind, ...details };
        },
        async overlay_focus() {
          const node = state.overlay;
          if (!node) return "no overlay";
          const inner = node.localName === "iframe" ? node : node.querySelector("browser");
          inner.focus();
          if (node.localName === "iframe") node.contentWindow.focus();
          return focus_chain(main_windows()[0].document);
        },
        async overlay_unmount() {
          state.overlay?.remove();
          state.overlay = null;
        },
        async rtt(count) {
          const samples = [];
          for (let seq = 0; seq < count; seq++) {
            const start = ChromeUtils.now();
            await new Promise((resolve) => {
              pending_pongs.set(seq, resolve);
              for (const listener of ping_listeners) listener({ seq, sent: start });
            });
            samples.push({ rtt: ChromeUtils.now() - start, sent: start });
          }
          return samples;
        },
        pong(seq) {
          pending_pongs.get(seq)?.();
          pending_pongs.delete(seq);
        },
        async process_info() {
          const three = about3pane(main_windows()[0]);
          const describe_browser = (browser) => (browser ? { remote: !!browser.isRemoteBrowser, remote_type: browser.remoteType ?? null, parent_can_read_document: !!browser.contentDocument, uri: browser.currentURI?.spec ?? "" } : null);
          return {
            about3pane_tab_browser: describe_browser(main_windows()[0].document.getElementById("tabmail").tabInfo[0].chromeBrowser),
            message_browser_about_message: describe_browser(three.messageBrowser),
            messagepane: describe_browser(three.messageBrowser.contentWindow?.document.getElementById("messagepane")),
            overlay_browser: state.overlay ? describe_browser(state.overlay.querySelector?.("browser")) : null,
          };
        },
        async noop() {},
        async console_tail() { return console_lines.splice(0); },
        onKey: new ExtensionCommon.EventManager({
          context,
          name: "probe.onKey",
          register: (fire) => {
            const listener = (info) => fire.async(info);
            key_listeners.add(listener);
            return () => key_listeners.delete(listener);
          },
        }).api(),
        onPing: new ExtensionCommon.EventManager({
          context,
          name: "probe.onPing",
          register: (fire) => {
            const listener = (info) => fire.async(info);
            ping_listeners.add(listener);
            return () => ping_listeners.delete(listener);
          },
        }).api(),
      },
    };
    // The default error from an Experiment hides the cause. Pass the message through so a failed scenario says why.
    for (const [name, fn] of Object.entries(api.probe)) {
      if (typeof fn !== "function" || name.startsWith("on") || name === "pong") continue;
      api.probe[name] = async (...args) => {
        try { return await fn(...args); } catch (error) { throw new ExtensionUtils.ExtensionError(`${name}: ${error.message} ${String(error.stack).split("\n")[0]}`); }
      };
    }
    return api;
  }

  // The probe never shuts down during a run, so it removes nothing here. A real runtime must remove its key listeners, its overlay and its console or window listeners.
  onShutdown() {
    ExtensionSupport.unregisterWindowListener("probe@desertbird.invalid");
  }
};
