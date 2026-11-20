// The parent half of the page actor, shipped as `experiment/page_actor_parent.sys.mjs`. The actor system loads it by URL for each page, and `parent_pages.ts` imports the same URL, so both share this one module instance and its state. It registers the actor, answers each child's hello with the keys to take and the insert flag, pushes both again when they change, and hands each key the child took to the page runtime.

import type { ChildKey, ChildPort } from "./page_runtime.ts";

/** What a child holds: whether it takes keys at all, the window's insert flag, and the key tokens it takes outside a text field (`page`) and inside one (`typing`). */
export interface ActorState {
    on: boolean;
    insert: boolean;
    page: string[];
    typing: string[];
}

export interface ActorHooks {
    /** A key the child of the front tab's page took, or null when the front tab shows a new page. */
    on_key(window: unknown, key: ChildKey | null): void;
    /** The add-on's own id: its pages keep their own key script. */
    own_id: string;
}

interface ActorWindow {
    location?: { href?: string };
    document: { getElementById(id: string): unknown; activeElement?: unknown };
}

interface ActorBrowser {
    ownerDocument?: { defaultView: ActorWindow | null } | null;
    closest?(selector: string): unknown;
    browsingContext?: ActorContext | null;
}

interface ActorContext {
    top: ActorContext;
    embedderElement: ActorBrowser | null;
    currentWindowGlobal?: { getExistingActor(name: string): unknown; getActor(name: string): unknown } | null;
}

interface KeyTree {
    root: unknown;
}

interface TabmailLike {
    currentTabInfo?: { browser?: ActorBrowser | null } | null;
    tabInfo?: { browser?: ActorBrowser | null }[];
}

declare const ChromeUtils: { registerWindowActor(name: string, options: object): void; unregisterWindowActor(name: string): void };
declare const Services: {
    focus: { focusedContentBrowsingContext: ActorContext | null };
    wm: { getEnumerator(type: string): Iterable<ActorWindow> };
    io: { getProtocolHandler(scheme: "resource"): { QueryInterface(iface: unknown): { setSubstitution(root: string, uri: null): void } } };
};
declare const Ci: { nsIResProtocolHandler: unknown };
declare class JSWindowActorParent {
    browsingContext: ActorContext;
    manager: { documentPrincipal?: { addonId?: string } | null };
    sendAsyncMessage(name: string, data?: unknown): void;
}

const ACTOR_NAME = "DesertBirdPage";
const MAIN_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";
// The digits that start a count. `0` only continues one, so it is taken only where a binding has it (`t 0`).
const COUNT_DIGITS = [..."123456789"];
// The key the matcher reads as any key after a prefix. A token set cannot hold it, so such a second key stays the page's.
const ANY_KEY = "";

let hooks: ActorHooks | null = null;
let page_tokens: string[] = [];
let typing_tokens: string[] = [];
// The windows in insert mode, as the page runtime last pushed them.
const insert_windows = new Set<unknown>();
// The actors whose child said hello or got a push. Each leaves on `didDestroy`, so a push never reaches a page that is gone.
const live = new Set<DesertBirdPageParent>();

function tokens_of(node: unknown): string[] {
    const children = (node as { children?: Record<string, unknown> } | null)?.children ?? {};
    return Object.entries(children).flatMap(([token, child]) => [...(token === ANY_KEY ? [] : [token]), ...tokens_of(child)]);
}

// The child's message is rebuilt field by field: a page process is not trusted with more than a key and two flags. The event cancels nothing, since the child already did.
function untrusted_key(data: Record<string, unknown>): ChildKey {
    return { key: String(data.key), code: String(data.code), ctrlKey: data.ctrlKey === true, altKey: data.altKey === true, metaKey: data.metaKey === true, shiftKey: data.shiftKey === true, field: data.field === true, defaultPrevented: data.prevented === true, target: null, preventDefault() {}, stopPropagation() {} };
}

const tabmail_of = (window: ActorWindow | null | undefined) => window?.document.getElementById("tabmail") as TabmailLike | null | undefined;

const front_browser_of = (window: unknown) => tabmail_of(window as ActorWindow)?.currentTabInfo?.browser ?? null;

export class DesertBirdPageParent extends JSWindowActorParent {
    on = false;

    get browser(): ActorBrowser | null {
        return this.browsingContext.embedderElement;
    }

    // `ownerGlobal` reads undefined on the embedder from this module on 153, so the window comes from the document.
    get window(): ActorWindow | null | undefined {
        return this.browser?.ownerDocument?.defaultView;
    }

    // A child takes keys only in a tab of a main window, and never on the add-on's own pages. A browser outside the tab panels (an add-on's popup) or in another window keeps every key.
    attach(): void {
        this.on = hooks !== null && this.window?.location?.href === MAIN_WINDOW_URL && !!this.browser?.closest?.("#tabpanelcontainer") && this.manager.documentPrincipal?.addonId !== hooks.own_id;
        live.add(this);
    }

    state(): ActorState {
        return { on: this.on, insert: insert_windows.has(this.window), page: page_tokens, typing: typing_tokens };
    }

    push(): void {
        try {
            this.sendAsyncMessage("DesertBird:State", this.state());
        } catch {
            live.delete(this);
        }
    }

    // Only the front tab's page runs keys, and only a new page there ends insert mode.
    receiveMessage({ name, data }: { name: string; data: unknown }): ActorState | undefined {
        if (name === "DesertBird:Hello") this.attach();
        const window = this.window;
        if (this.on && front_browser_of(window) === this.browser) {
            if (name === "DesertBird:Hello") hooks?.on_key(window, null);
            else if (name === "DesertBird:Key" && data) hooks?.on_key(window, untrusted_key(data as Record<string, unknown>));
        }
        return name === "DesertBird:Hello" ? this.state() : undefined;
    }

    didDestroy(): void {
        live.delete(this);
    }
}

function actor_of(browser: ActorBrowser | null | undefined): DesertBirdPageParent | null {
    const actor = browser?.browsingContext?.currentWindowGlobal?.getExistingActor(ACTOR_NAME) as DesertBirdPageParent | undefined;
    return actor && live.has(actor) && actor.on ? actor : null;
}

function push_all(window?: unknown): void {
    for (const actor of live) if (window === undefined || actor.window === window) actor.push();
}

/** Registers the actor and reaches the pages already open, whose children would otherwise wait for a first key to say hello. */
export function start(new_hooks: ActorHooks): void {
    hooks = new_hooks;
    ChromeUtils.registerWindowActor(ACTOR_NAME, {
        parent: { esModuleURI: import.meta.url },
        child: { esModuleURI: new URL("page_actor_child.sys.mjs", import.meta.url).href, events: { keydown: { capture: true }, DOMContentLoaded: {}, pageshow: {} } },
        matches: ["http://*/*", "https://*/*", "file:///*", "moz-extension://*/*"],
        remoteTypes: ["web", "webIsolated", "webCOOP+COEP", "file", "extension"],
        allFrames: false,
    });
    for (const window of Services.wm.getEnumerator("mail:3pane")) {
        for (const tab of tabmail_of(window)?.tabInfo ?? []) {
            try {
                const actor = tab.browser?.browsingContext?.currentWindowGlobal?.getActor(ACTOR_NAME) as DesertBirdPageParent | undefined;
                actor?.attach();
                actor?.push();
            } catch {
                // A page the actor does not match (about:, chrome:) has no actor to get.
            }
        }
    }
}

/** Turns every child off, unregisters the actor and drops the hooks and the `resource://` root this module loaded from. The hooks belong to the add-on scope that shuts down, so a late call would hit a dead object. */
export function stop(): void {
    hooks = null;
    for (const actor of live) actor.on = false;
    push_all();
    live.clear();
    insert_windows.clear();
    page_tokens = [];
    typing_tokens = [];
    try {
        ChromeUtils.unregisterWindowActor(ACTOR_NAME);
    } catch {
        // Not registered: the start failed.
    }
    Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution(new URL(import.meta.url).host, null);
}

/** Takes the key tokens of the page tree and the typing tree, with the count digits, and pushes them to every child. */
export function set_keys(page: KeyTree, typing: KeyTree): void {
    page_tokens = [...new Set([...tokens_of(page.root), ...COUNT_DIGITS])];
    typing_tokens = [...new Set(tokens_of(typing.root))];
    push_all();
}

export const set_insert: ChildPort["set_insert"] = (window, on) => {
    insert_windows[on ? "add" : "delete"](window);
    push_all(window);
};

// The focus must sit in the top-level page itself: a key in a frame never reaches the child, which runs in the top page only.
export const takes_keys: ChildPort["takes_keys"] = (window) => {
    const focused = Services.focus.focusedContentBrowsingContext;
    const browser = front_browser_of(window);
    return !!focused && focused.top === focused && focused.embedderElement === browser && actor_of(browser) !== null;
};

export const scroll: ChildPort["scroll"] = (window, id, count) => {
    const actor = actor_of(front_browser_of(window));
    actor?.sendAsyncMessage("DesertBird:Scroll", { id, count });
    return actor !== null;
};

// Only when the page has the focus: an Escape in a field of the window itself is the chrome's to blur.
export const blur: ChildPort["blur"] = (window) => {
    const browser = front_browser_of(window);
    const actor = (window as ActorWindow).document.activeElement === browser ? actor_of(browser) : null;
    actor?.sendAsyncMessage("DesertBird:Blur");
    return actor !== null;
};
