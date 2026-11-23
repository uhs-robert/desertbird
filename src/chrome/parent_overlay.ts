// The parent script of the `overlay` API. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `overlay`: `getAPI(context)` returns `get_overlay_api(context)` and `onShutdown` calls `shutdown()`.
// The overlay is a remote `browser` element in the window document, not an iframe: see "Overlay mount" in docs/thunderbird-behavior.md.

import { HUD_BOX_ID, HUD_BROWSER_ID, MODE_LABEL_ID, OVERLAY_BOX_ID, OVERLAY_BROWSER_ID, OVERLAY_LOADING_ID } from "./overlay_id.ts";
import { capture_focus, in_text_field } from "./focus.ts";
import { hook_page_focus } from "./page_focus.ts";
import { create_mode_label } from "./mode_label.ts";
import type { LabelElement, ModeLabel, StatusBarDocument } from "./mode_label.ts";
import { claim_id_when_page_ready, create_overlay_host, on_escape_key } from "./overlay.ts";
import type { OverlayHost } from "./overlay.ts";
import { guard, load_platform, open_main_windows, open_overlay_windows, tabmail_of } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import type { KeydownEvent } from "./runtime.ts";
import { front_about_3pane } from "./view.ts";
import { OVERLAY_READY_TITLE } from "../shared/protocol.ts";
import type { OverlayClosed, OverlayMountArgs, OverlaySetModeLabelArgs, OverlaySurface, OverlayUnmountArgs } from "../shared/protocol.ts";

declare const ChromeUtils: { importESModule(url: string): Record<string, any> };

const DARK_SCHEME = "(prefers-color-scheme: dark)";
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

interface SurfaceSpec {
    page: string;
    box_id: string;
    browser_id: string;
    /** The style of the box that holds the browser, pinned to the bottom of the window. */
    box_style: string;
    /** The most the browser is told to grow to, fitting its content. Zero tells it nothing, and the browser keeps the size of its box. */
    max_width: number;
    max_height: number;
    /** Whether the browser takes the keyboard on mount. */
    takes_keyboard: boolean;
}

const PINNED = "position: fixed; left: 0; right: 0; bottom: 0;";

// The fixed table from a surface name to its page in the extension. A caller never supplies a path.
// The command line draws the completion list above its input line inside its box. The hud sits one z-index step above it, transparent and deaf to the mouse, so a toast draws over the panel and a click on the list under it still lands.
const SURFACES: Record<OverlaySurface, SurfaceSpec> = {
    cmdline: { page: "overlay/cmdline.html", box_id: OVERLAY_BOX_ID, browser_id: OVERLAY_BROWSER_ID, box_style: `${PINNED} height: 280px; z-index: 100000;`, max_width: 0, max_height: 0, takes_keyboard: true },
    hud: { page: "overlay/hud.html", box_id: HUD_BOX_ID, browser_id: HUD_BROWSER_ID, box_style: `${PINNED} height: 520px; z-index: 100001; pointer-events: none;`, max_width: 0, max_height: 0, takes_keyboard: false },
};

const closed_listeners = new Set<(closed: OverlayClosed) => void>();
let host: OverlayHost | null = null;
let mode_label: ModeLabel | null = null;
let stop_page_focus: (() => void) | null = null;

interface OverlayElement {
    id: string;
    style: { cssText: string };
    appendChild(child: unknown): void;
    removeEventListener(type: string, listener: () => void): void;
    contentTitle?: string;
    remove(): void;
    focus(): void;
    setAttribute(name: string, value: string): void;
    toggleAttribute(name: string, force: boolean): void;
    addEventListener(type: string, listener: () => void, options?: { once: true }): void;
    messageManager: { loadFrameScript(url: string, delay: boolean, run_in_global: boolean): void; sendAsyncMessage(name: string, data: object): void };
    fixupAndLoadURIString(page: string, options: { triggeringPrincipal: unknown }): void;
}

interface OverlayDocument {
    createElementNS(namespace: string, name: string): OverlayElement;
    createXULElement(name: string): OverlayElement;
    documentElement: { appendChild(child: unknown): void };
}

interface OverlayExtension {
    baseURI: { resolve(path: string): string };
    principal: unknown;
    policy: { browsingContextGroupId: number };
    remote: boolean;
    remoteType: string;
}

// The mount blurs the window, twice (measured), inside its `focus()` call. The key runtimes read a blur as the window losing focus and end their hold, so the hold after `:` would end before the page is ready. The blurs of that one call stop at the window root, above the runtimes' listeners. Every other blur, Thunderbird's own listeners included, passes.
function focus_without_blur_reaching_runtimes(window: MainWindow, focus: () => void): void {
    const root = (window as MainWindow & { windowRoot?: MainWindow }).windowRoot ?? window;
    const swallow = (event: { stopPropagation(): void }) => event.stopPropagation();
    root.addEventListener("blur", swallow as never, true);
    try {
        focus();
    } finally {
        root.removeEventListener("blur", swallow as never, true);
    }
}

// An extension page needs the browser attributes of an extension view, then a load through the extension's own principal. The load waits for the frame loader, which a remote browser creates after it joins the document.
function create_overlay_element(window: MainWindow, extension: OverlayExtension, surface: OverlaySurface, window_id: number, click_through: boolean, on_not_ready: () => void): () => void {
    const spec = SURFACES[surface];
    const document = window.document as unknown as OverlayDocument;
    const box = document.createElementNS(XHTML_NAMESPACE, "div");
    box.id = spec.box_id;
    box.style.cssText = click_through ? `${spec.box_style} pointer-events: none;` : spec.box_style;
    const browser = document.createXULElement("browser");
    // A browser that takes the keyboard answers to its keys only once its page is ready: see `OVERLAY_LOADING_ID`.
    browser.id = spec.takes_keyboard ? OVERLAY_LOADING_ID : spec.browser_id;
    const wait = (run: () => void, ms: number) => void (window as unknown as { setTimeout(run: () => void, ms: number): number }).setTimeout(run, ms);
    if (spec.takes_keyboard) claim_id_when_page_ready(browser, spec.browser_id, OVERLAY_READY_TITLE, wait, on_not_ready);
    browser.setAttribute("type", "content");
    browser.setAttribute("disableglobalhistory", "true");
    browser.setAttribute("messagemanagergroup", "webext-browsers");
    browser.setAttribute("webextension-view-type", "popup");
    browser.setAttribute("maychangeremoteness", "true");
    browser.toggleAttribute("nodefaultsrc", true);
    browser.setAttribute("transparent", "true");
    browser.setAttribute("initialBrowsingContextGroupId", String(extension.policy.browsingContextGroupId));
    if (extension.remote) {
        browser.toggleAttribute("remote", true);
        browser.setAttribute("remoteType", extension.remoteType);
    }
    browser.style.cssText = "width: 100%; height: 100%; border: 0;";
    // The listener goes on before the browser joins the document: the event can fire before one that is added after. The load runs a microtask later, because the message manager does not exist yet while the event is being dispatched.
    const created = new Promise<void>((resolve) => browser.addEventListener("XULFrameLoaderCreated", () => resolve(), { once: true }));
    void created.then(() => {
        const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
        ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
        browser.messageManager.loadFrameScript("chrome://extensions/content/ext-browser-content.js", false, true);
        browser.messageManager.sendAsyncMessage("Extension:InitBrowser", { allowScriptsToClose: true, blockParser: false, fixedWidth: false, maxWidth: spec.max_width, maxHeight: spec.max_height, stylesheets: [] });
        browser.fixupAndLoadURIString(extension.baseURI.resolve(`${spec.page}?window=${window_id}`), { triggeringPrincipal: extension.principal });
        if (spec.takes_keyboard) browser.focus();
    });
    box.appendChild(browser);
    document.documentElement.appendChild(box);
    // The focus moves now, not after the page loads: a key typed while the page loads goes to the overlay and not to the thread list.
    if (spec.takes_keyboard) focus_without_blur_reaching_runtimes(window, () => browser.focus());
    return () => box.remove();
}

interface StatusBarElement extends LabelElement {
    insertBefore(child: unknown, before: unknown): void;
    firstChild: unknown;
}

interface StatusBarWindowDocument extends OverlayDocument {
    getElementById(id: string): StatusBarElement | null;
    querySelectorAll(selectors: string): Iterable<LabelElement>;
}

function status_bar_of(window: MainWindow): StatusBarDocument {
    const document = window.document as unknown as StatusBarWindowDocument;
    return {
        labels: () => [...document.querySelectorAll(`#${MODE_LABEL_ID}`)],
        create_label() {
            const label = document.createXULElement("label") as unknown as LabelElement & { id: string };
            label.id = MODE_LABEL_ID;
            return label;
        },
        insert_first(label) {
            const host = document.getElementById("statusTextBox") ?? document.getElementById("status-bar");
            host?.insertBefore(label, host.firstChild);
            return host !== null;
        },
    };
}

const mode_label_window_deps = {
    open_windows: open_main_windows,
    status_bar_of,
    in_text_field: (window: MainWindow) => in_text_field(window.document),
    on_loaded(window: MainWindow, listener: () => void) {
        if (window.document.readyState !== "complete") window.addEventListener("load", listener, { once: true });
    },
    on_focus_change(window: MainWindow, listener: () => void) {
        window.addEventListener("focusin", listener, true);
        window.addEventListener("focusout", listener, true);
        return () => (window.removeEventListener("focusin", listener, true), window.removeEventListener("focusout", listener, true));
    },
    // Measured: a window's own scheme query follows the Thunderbird theme, while the background page's follows the OS.
    is_dark: (window: MainWindow) => window.matchMedia(DARK_SCHEME).matches,
    on_scheme_change(window: MainWindow, listener: () => void) {
        const query = window.matchMedia(DARK_SCHEME);
        query.addEventListener("change", listener);
        return () => query.removeEventListener("change", listener);
    },
};

function ensure_mode_label(context: ExtensionContext & { extension: OverlayExtension }): ModeLabel {
    mode_label ??= create_mode_label<MainWindow>({
        window_with_id: (window_id) => open_main_windows().find((window) => context.extension.windowManager.getWrapper(window)?.id === window_id) ?? null,
        ...mode_label_window_deps,
    });
    return mode_label;
}

function ensure_host(context: ExtensionContext & { extension: OverlayExtension }): OverlayHost {
    host ??= create_overlay_host<MainWindow>({
        window_with_id: (window_id) => open_overlay_windows().find((window) => context.extension.windowManager.getWrapper(window)?.id === window_id) ?? null,
        create: (window, surface, window_id, click_through, on_not_ready) => create_overlay_element(window, context.extension, surface, window_id, click_through, on_not_ready),
        capture_focus: (window) => capture_focus(window.document),
        focus_thread_list(window) {
            const tree = front_about_3pane(tabmail_of(window))?.threadTree;
            // The tree has focus in its table body. The tree element itself is the fallback.
            (tree?.table?.body ?? tree)?.focus?.();
        },
        on_tab_select(window, listener) {
            window.addEventListener("TabSelect", listener, true);
            return () => window.removeEventListener("TabSelect", listener, true);
        },
        on_window_unload(window, listener) {
            window.addEventListener("unload", listener, { once: true });
            return () => window.removeEventListener("unload", listener);
        },
        on_escape(window, listener) {
            const handler = (event: KeydownEvent) => {
                if (event.key !== "Escape") return;
                const browser = (window.document as unknown as { getElementById(id: string): { contentTitle?: string } | null }).getElementById(OVERLAY_BROWSER_ID);
                on_escape_key(() => browser?.contentTitle ?? "", (run, ms) => void (window as unknown as { setTimeout(run: () => void, ms: number): number }).setTimeout(run, ms), listener);
            };
            window.addEventListener("keydown", handler, true);
            return () => window.removeEventListener("keydown", handler, true);
        },
        emit_closed: (window_id, surface, reason) => {
            for (const listener of closed_listeners) listener(reason ? { windowId: window_id, surface, reason } : { windowId: window_id, surface });
        },
    });
    return host;
}

export function get_overlay_api(context: ExtensionContext & { extension: OverlayExtension }) {
    // getAPI is lazy: this hook starts only because the background touches `messenger.overlay` at load.
    stop_page_focus ??= hook_page_focus();
    return {
        overlay: {
            mount: guard("overlay.mount", (args: OverlayMountArgs): void => ensure_host(context).mount(args)),
            unmount: guard("overlay.unmount", (args: OverlayUnmountArgs): void => ensure_host(context).unmount(args)),
            setModeLabel: guard("overlay.setModeLabel", (args: OverlaySetModeLabelArgs): void => ensure_mode_label(context).set(args)),
            onClosed: new (load_platform().ExtensionCommon.EventManager)({
                context,
                name: "overlay.onClosed",
                register: (fire) => {
                    const listener = (closed: OverlayClosed) => fire.async(closed);
                    closed_listeners.add(listener);
                    return () => closed_listeners.delete(listener);
                },
            }).api(),
        },
    };
}

/** Removes every overlay and every listener, and forgets the event subscribers. */
export function shutdown(): void {
    host?.shutdown();
    host = null;
    // A label sits in the window and not in the host's table, so the sweep runs even when no label call ever came.
    (mode_label ?? create_mode_label<MainWindow>({ window_with_id: () => null, ...mode_label_window_deps })).shutdown();
    mode_label = null;
    stop_page_focus?.();
    stop_page_focus = null;
    closed_listeners.clear();
}
