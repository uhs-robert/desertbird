// The parent script of the `overlay` API. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `overlay`: `getAPI(context)` returns `get_overlay_api(context)` and `onShutdown` calls `shutdown()`.
// The overlay is a remote `browser` element in the window document, not an iframe: see "Overlay mount" in docs/thunderbird-behavior.md.

import { OVERLAY_BOX_ID, OVERLAY_BROWSER_ID } from "./overlay_id.ts";
import { create_overlay_host } from "./overlay.ts";
import type { OverlayHost } from "./overlay.ts";
import { guard, load_platform, open_main_windows, tabmail_of } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import { front_about_3pane } from "./view.ts";
import type { OverlayClosed, OverlayMountArgs, OverlaySurface, OverlayUnmountArgs } from "../shared/protocol.ts";

declare const ChromeUtils: { importESModule(url: string): Record<string, any> };

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

// The fixed table from a surface name to its page in the extension. A caller never supplies a path.
const SURFACE_PAGES: Record<OverlaySurface, string> = { cmdline: "overlay/cmdline.html" };

// Pinned to the bottom of the window. The page draws the completion list above its input line inside this box.
const BOX_STYLE = "position: fixed; left: 0; right: 0; bottom: 0; height: 280px; z-index: 100000; background: Canvas;";

const closed_listeners = new Set<(closed: OverlayClosed) => void>();
let host: OverlayHost | null = null;

interface OverlayElement {
    id: string;
    style: { cssText: string };
    appendChild(child: unknown): void;
    remove(): void;
    focus(): void;
    setAttribute(name: string, value: string): void;
    toggleAttribute(name: string, force: boolean): void;
    addEventListener(type: string, listener: () => void, options: { once: true }): void;
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

// An extension page needs the browser attributes of an extension view, then a load through the extension's own principal. The load waits for the frame loader, which a remote browser creates after it joins the document.
function create_overlay_element(window: MainWindow, extension: OverlayExtension, surface: OverlaySurface, window_id: number): () => void {
    const document = window.document as unknown as OverlayDocument;
    const box = document.createElementNS(XHTML_NAMESPACE, "div");
    box.id = OVERLAY_BOX_ID;
    box.style.cssText = BOX_STYLE;
    const browser = document.createXULElement("browser");
    browser.id = OVERLAY_BROWSER_ID;
    browser.setAttribute("type", "content");
    browser.setAttribute("disableglobalhistory", "true");
    browser.setAttribute("messagemanagergroup", "webext-browsers");
    browser.setAttribute("webextension-view-type", "popup");
    browser.setAttribute("maychangeremoteness", "true");
    browser.toggleAttribute("nodefaultsrc", true);
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
        browser.messageManager.sendAsyncMessage("Extension:InitBrowser", { allowScriptsToClose: true, blockParser: false, fixedWidth: false, maxWidth: 800, maxHeight: 280, stylesheets: [] });
        browser.fixupAndLoadURIString(extension.baseURI.resolve(`${SURFACE_PAGES[surface]}?window=${window_id}`), { triggeringPrincipal: extension.principal });
        browser.focus();
    });
    box.appendChild(browser);
    document.documentElement.appendChild(box);
    // The focus moves now, not after the page loads: a key typed while the page loads goes to the overlay and not to the thread list.
    browser.focus();
    return () => box.remove();
}

function ensure_host(context: ExtensionContext & { extension: OverlayExtension }): OverlayHost {
    host ??= create_overlay_host<MainWindow>({
        window_with_id: (window_id) => open_main_windows().find((window) => context.extension.windowManager.getWrapper(window)?.id === window_id) ?? null,
        create: (window, surface, window_id) => create_overlay_element(window, context.extension, surface, window_id),
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
        emit_closed: (window_id) => {
            for (const listener of closed_listeners) listener({ windowId: window_id });
        },
    });
    return host;
}

export function get_overlay_api(context: ExtensionContext & { extension: OverlayExtension }) {
    return {
        overlay: {
            mount: guard("overlay.mount", (args: OverlayMountArgs): void => ensure_host(context).mount(args)),
            unmount: guard("overlay.unmount", (args: OverlayUnmountArgs): void => ensure_host(context).unmount(args)),
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
    closed_listeners.clear();
}
