// The parent script of the `pages` API. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `pages`: `getAPI(context)` returns `get_pages_api(context)` and `onShutdown` calls `shutdown()`.

import { blur_text_field, focus_chain, overlay_is_loading } from "./focus.ts";
import { run_scroll, scroll_axis_of, scroll_focus, scroll_target } from "./page_actions.ts";
import type { ScrollDocument, ScrollNode } from "./page_actions.ts";
import { create_page_runtime } from "./page_runtime.ts";
import type { PageRuntime } from "./page_runtime.ts";
import { guard, load_platform, open_main_windows, tabmail_of } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import { MESSAGE_TAB_MODE, situation_of } from "./readable_focus.ts";
import type { KeyTarget, WindowListener } from "./runtime.ts";
import { HINTS_LIVE_ATTRIBUTE } from "../shared/protocol.ts";
import type { KeysEvent, PagesInstallArgs } from "../shared/protocol.ts";
import type * as PageActor from "./page_actor_parent.ts";

declare const ChromeUtils: { importESModule(url: string): typeof PageActor };
declare const Services: { io: { getProtocolHandler(scheme: "resource"): { QueryInterface(iface: unknown): { setSubstitution(root: string, uri: unknown): void } } } };
declare const Ci: { nsIResProtocolHandler: unknown };

const MAIN_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";
const WINDOW_LISTENER_ID = "desertbird@uhs-robert/pages";
const NO_WINDOW_ID = -1;

interface PagesWindow extends MainWindow {
    /** The parent of the window in the event path. A capture listener there sees a key before every listener of the window, the key runtime's among them. */
    windowRoot?: KeyTarget;
}

interface FrontTabInfo {
    mode: { name: string };
    browser?: { isRemoteBrowser?: boolean; contentDocument?: { scrollingElement?: ScrollNode | null } | null } | null;
    chromeBrowser?: { contentDocument?: { scrollingElement?: ScrollNode | null } | null; contentWindow?: { gMessage?: unknown; document?: { getElementById(id: string): { contentDocument?: { scrollingElement?: ScrollNode | null } | null } | null } } | null } | null;
    /** The element that holds the tab's own part of the window document. */
    panel?: Pick<ScrollDocument, "querySelectorAll"> | null;
    /** The header of the message a message tab shows. */
    message?: unknown;
}

const invocation_listeners = new Set<(invocation: KeysEvent) => void>();
let runtime: PageRuntime | null = null;
let actor: typeof PageActor | null = null;

// The page actor gives web pages and other add-ons' pages their keys. It starts after the runtime installs, so a failed start leaves the other tabs their keys and fails the install with its reason. The `resource://` root takes a new name each load: the module cache keys on the URL, so a reloaded add-on under the old name would keep running the old child. The module's `stop` drops the name.
function start_actor(context: ExtensionContext): typeof PageActor {
    const { rootURI, id } = context.extension as unknown as { rootURI: unknown; id: string };
    const root = `desertbird-actor-${Date.now()}`;
    Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution(root, rootURI);
    const module = ChromeUtils.importESModule(`resource://${root}/experiment/page_actor_parent.sys.mjs`);
    // The hooks die with this scope: the module's `stop` drops them.
    module.start({ own_id: id, on_key: (runtime as PageRuntime).on_child_key });
    return module;
}

const front_tab_of = (window: MainWindow) => (tabmail_of(window)?.currentTabInfo as FrontTabInfo | null | undefined) ?? null;

function ensure_runtime(context: ExtensionContext): PageRuntime {
    runtime ??= create_page_runtime<PagesWindow>({
        register_window_listener(listener: WindowListener<PagesWindow>) {
            load_platform().ExtensionSupport.registerWindowListener(WINDOW_LISTENER_ID, {
                chromeURLs: [MAIN_WINDOW_URL],
                onLoadWindow: listener.on_load_window,
                onUnloadWindow: listener.on_unload_window,
            });
        },
        unregister_window_listener: () => load_platform().ExtensionSupport.unregisterWindowListener(WINDOW_LISTENER_ID),
        open_windows: open_main_windows,
        key_target_of: (window) => window.windowRoot ?? window,
        situation_of(window, event) {
            if (window.document.documentElement?.hasAttribute(HINTS_LIVE_ATTRIBUTE)) return "pass";
            const tab = front_tab_of(window);
            return situation_of(window.document, tab && { mode: tab.mode.name, browser_is_remote: tab.browser?.isRemoteBrowser === true }, event);
        },
        overlay_is_loading: (window) => overlay_is_loading(window.document),
        blur_focused: (window) => actor?.blur(window) || blur_text_field(window.document),
        child: () => actor,
        message_ids_of(window) {
            const tab = front_tab_of(window);
            const header = tab?.message ?? tab?.chromeBrowser?.contentWindow?.gMessage;
            const id = header ? context.extension.messageManager.convert(header, { skipFolder: true })?.id : undefined;
            return id === undefined ? [] : [id];
        },
        scroll(window, id, count) {
            if (actor?.scroll(window, id, count)) return true;
            const tab = front_tab_of(window);
            // The focus sits in the header of the message tab, so the body is scrolled, whatever the header holds.
            if (tab?.mode.name === MESSAGE_TAB_MODE) return run_scroll(id, scroll_target(undefined, (tab.chromeBrowser?.contentWindow?.document?.getElementById("messagepane")?.contentDocument ?? {}) as ScrollDocument, undefined, scroll_axis_of(id)), count);
            const { focused, document } = scroll_focus(focus_chain(window.document), (tab?.browser ?? tab?.chromeBrowser)?.contentDocument as ScrollDocument | null | undefined, window.document as unknown as ScrollDocument);
            // The window document holds every tab, so a search for the largest scrollable element stays in the panel of the front tab.
            const target_document = (focused as ScrollNode | undefined)?.ownerDocument ?? document;
            return run_scroll(id, scroll_target(focused, document, target_document === (window.document as unknown) ? (tab?.panel ?? undefined) : undefined, scroll_axis_of(id)), count);
        },
        on_tab_select(window, listener) {
            // On the window and not on the tab strip, as the key runtime does: the strip does not exist yet when the window is hooked at startup.
            window.addEventListener("TabSelect", listener, true);
            return () => window.removeEventListener("TabSelect", listener, true);
        },
        on_window_blur(window, listener) {
            // The blur lands on the focused element when the whole window deactivates, so only the focus tells a window blur from a focus move inside it.
            const on_blur = () => {
                if (!window.document.hasFocus()) listener();
            };
            window.addEventListener("blur", on_blur, true);
            return () => window.removeEventListener("blur", on_blur, true);
        },
        now: () => Date.now(),
        window_id_of: (window) => context.extension.windowManager.getWrapper(window)?.id ?? NO_WINDOW_ID,
        emit: (invocation) => {
            for (const listener of invocation_listeners) listener(invocation);
        },
    });
    return runtime;
}

export function get_pages_api(context: ExtensionContext) {
    return {
        pages: {
            install: guard("pages.install", ({ pageTree, messageTree, typingTree, holdCommands }: PagesInstallArgs): void => (ensure_runtime(context).install({ page: pageTree, message: messageTree, typing: typingTree }, holdCommands), (actor ??= start_actor(context)).set_keys(pageTree, typingTree))),
            onInvocation: new (load_platform().ExtensionCommon.EventManager)({
                context,
                name: "pages.onInvocation",
                register: (fire) => {
                    const listener = (invocation: KeysEvent) => fire.async(invocation);
                    invocation_listeners.add(listener);
                    return () => invocation_listeners.delete(listener);
                },
            }).api(),
        },
    };
}

/** Removes every key listener and the window listener, drops the tree and the half-typed sequence, and forgets the event subscribers. */
export function shutdown(): void {
    runtime?.shutdown();
    runtime = null;
    actor?.stop();
    actor = null;
    invocation_listeners.clear();
}
