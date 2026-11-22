// The parent script of the `hints` API. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `hints`: `getAPI(context)` returns `get_hints_api(context)` and `onShutdown` calls `shutdown()`.

import { focus_chain } from "./focus.ts";
import type { FocusDocument } from "./focus.ts";
import { guard } from "./platform.ts";
import type { ExtensionContext } from "./platform.ts";
import { HINTS_LIVE_ATTRIBUTE } from "../shared/protocol.ts";
import type { HintAction, HintLabelScheme, HintsPickArgs, HintsSendEnterArgs } from "../shared/protocol.ts";
import { collect_message_targets, collect_page_targets, collect_targets } from "./hint_targets.ts";
import type { HintMailPane } from "./hint_targets.ts";
import { end_pick, start_pick } from "./hint_pick.ts";
import type { PickHost, PickKeyEvent } from "./hint_pick.ts";
import { OPENABLE } from "../shared/hint_view.ts";
import type { HintWindow } from "../shared/hint_view.ts";
import { front_about_3pane } from "./view.ts";
import type { TabmailLike } from "./view.ts";

declare const Services: { wm: { getEnumerator(type: string | null): Iterable<EnterWindow> } };
declare const Cc: Record<string, { createInstance(iface: unknown): TextInputProcessor; getService(iface: unknown): { copyString(text: string): void } }>;
declare const Ci: Record<string, unknown>;

interface TextInputProcessor {
    beginInputTransactionForTests(window: EnterWindow): boolean;
    keydown(event: unknown): void;
    keyup(event: unknown): void;
}

export interface EnterWindow {
    document: FocusDocument;
    KeyboardEvent: new (type: string, init: { key: string; code: string; keyCode: number }) => unknown;
}

const WINDOW_TYPES = ["mail:3pane", "mail:messageWindow"];

/** Whether the focus sits on a link or a button inside the message document, the one the pick focused. The focus can move between the pick and the Enter (a pane chord, a tab switch), and an Enter then would act on the mail window's own interface. */
function focus_is_picked_target(window: EnterWindow): boolean {
    const chain = focus_chain(window.document);
    return chain.some((node) => node.id === "messagepane") && chain.at(-1)?.matches?.(OPENABLE) === true;
}

/** Presses Enter through the text input processor, so the key is trusted and reaches the focused element, in this process or another. */
function press_enter(window: EnterWindow): void {
    const processor = Cc["@mozilla.org/text-input-processor;1"]!.createInstance(Ci["nsITextInputProcessor"]);
    if (!processor.beginInputTransactionForTests(window)) throw new Error("the window takes no key press");
    const enter = new window.KeyboardEvent("", { key: "Enter", code: "Enter", keyCode: 13 });
    processor.keydown(enter);
    processor.keyup(enter);
}

function window_with_id(context: ExtensionContext, window_id: number): EnterWindow | null {
    for (const type of WINDOW_TYPES) {
        for (const window of Services.wm.getEnumerator(type)) if (context.extension.windowManager.getWrapper(window as never)?.id === window_id) return window;
    }
    return null;
}

interface ListenerTarget {
    addEventListener(type: string, listener: (event: never) => void, capture: boolean): void;
    removeEventListener(type: string, listener: (event: never) => void, capture: boolean): void;
}

interface PickMainWindow extends ListenerTarget, HintWindow {
    /** The parent of the window in the event path. A capture listener there sees a key before every listener of the window, the key runtime's among them. */
    windowRoot?: ListenerTarget;
    document: HintWindow["document"] & {
        hasFocus(): boolean;
        getElementById(id: string): unknown;
        documentElement: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void };
    };
    matchMedia(query: string): { matches: boolean };
    setTimeout(callback: () => void, ms: number): unknown;
}

/** The `#messagepane` browser of the message that holds the focus. Its document is `about:message`, in the reading pane and in a message tab alike. */
interface MessagePane {
    id: "messagepane";
    isRemoteBrowser?: boolean;
    contentDocument?: unknown;
    contentWindow: HintWindow & ListenerTarget;
    ownerDocument: { defaultView: HintWindow & ListenerTarget };
}

/** The browser of a tab that is not the mail tab. A remote page has no `contentDocument` the parent can read. */
interface PageBrowser {
    contentDocument?: unknown;
    contentWindow?: HintWindow & ListenerTarget;
    isRemoteBrowser?: boolean;
    browsingContext?: { currentWindowGlobal?: { getExistingActor(name: string): PageActor | undefined } | null } | null;
    focus(): void;
}

/** The parent half of the page actor of `page_actor_parent.ts`, as this bundle reaches it through the browser. `on` is false on a page the actor leaves alone. */
interface PageActor {
    on: boolean;
    sendQuery(name: string, data: unknown): Promise<unknown>;
}

type FrontTab = NonNullable<TabmailLike["currentTabInfo"]> & { browser?: PageBrowser | null; chromeBrowser?: PageBrowser | null };

function listen(target: ListenerTarget, type: string, listener: (event: never) => void): () => void {
    target.addEventListener(type, listener, true);
    return () => target.removeEventListener(type, listener, true);
}

// The clipboard service of the parent. The label is typed later, inside this Experiment, and the background cannot wait for that key. So the pick writes the text here when the label completes.
const copy_to_clipboard = (text: string): void => Cc["@mozilla.org/widget/clipboardhelper;1"]!.getService(Ci["nsIClipboardHelper"]).copyString(text);

function pick_host(main: PickMainWindow, documents: ListenerTarget[], message?: ListenerTarget): PickHost {
    return {
        copy: copy_to_clipboard,
        on_key(listener) {
            // The page keys listen on the same window root and were there first, so the marker tells them to leave the keys to the labels.
            const root = main.document.documentElement;
            root.setAttribute(HINTS_LIVE_ATTRIBUTE, "");
            const stop = listen(main.windowRoot ?? main, "keydown", listener as (event: PickKeyEvent) => void);
            return () => (stop(), root.removeAttribute(HINTS_LIVE_ATTRIBUTE));
        },
        on_disturb(listener) {
            // The blur lands on the focused element when focus moves inside the window too, so only a window that lost the focus counts.
            const on_blur = () => main.document.hasFocus() || listener();
            const stops = [...documents.map((each) => listen(each, "scroll", listener)), ...documents.map((each) => listen(each, "pointerdown", listener)), listen(main, "blur", on_blur), listen(main, "TabSelect", listener), ...(message ? [listen(message, "MsgLoading", listener)] : [])];
            return () => stops.forEach((stop) => stop());
        },
    };
}

/** Labels the header and body of the message whose body holds the focus. */
function pick_in_message(main: PickMainWindow, scheme: HintLabelScheme, action: HintAction | undefined): number {
    const pane = focus_chain(main.document as unknown as FocusDocument).find((node) => node.id === "messagepane") as MessagePane | undefined;
    // The focus left the body during the trip from the body script, so the key no longer belongs to a message.
    if (!pane) return 0;
    // A remote body (a feed shown as a web page): the body script labels it alone.
    if (pane.isRemoteBrowser || !pane.contentDocument) return -1;
    const message = pane.ownerDocument.defaultView;
    // The Enter waits for the end of the key that picked, and goes only to the picked element while it holds the focus.
    const open = (picked: unknown) => void main.setTimeout(() => focus_chain(main.document as unknown as FocusDocument).at(-1) === picked && focus_is_picked_target(main as unknown as EnterWindow) && press_enter(main as unknown as EnterWindow), 0);
    return start_pick(pick_host(main, [main, message, pane.contentWindow], message), collect_message_targets(message, pane.contentWindow, open), scheme, action);
}

/** The tab manager maps a tab of `tabmail` to its MailExtension tab id. */
type HintsContext = ExtensionContext & { extension: { tabManager: { getWrapper(tab: unknown): { id: number } | null } } };

export function get_hints_api(context: HintsContext) {
    return {
        hints: {
            sendEnter: guard("hints.sendEnter", ({ windowId }: HintsSendEnterArgs): void => {
                const window = window_with_id(context, windowId);
                if (window === null) throw new Error(`no window ${windowId}`);
                if (!focus_is_picked_target(window)) throw new Error("the focus is not on a link or button of the message");
                press_enter(window);
            }),
            pick: guard("hints.pick", async ({ windowId, tabId, colors, action, place }: HintsPickArgs): Promise<number> => {
                const main = window_with_id(context, windowId) as unknown as PickMainWindow | null;
                const tabmail = (main?.document.getElementById("tabmail") ?? null) as TabmailLike | null;
                const tab = tabmail?.currentTabInfo as FrontTab | null | undefined;
                // A message window has no tabs, and its body script keeps its own labels.
                if (place && main && !tab) return -1;
                if (!main || !tab) throw new Error(`no tab in window ${windowId}`);
                const scheme = main.matchMedia("(prefers-color-scheme: light)").matches ? colors.light : colors.dark;
                // The body that asked lost the front to another tab on the way, so the key is stale.
                if (place) return context.extension.tabManager.getWrapper(tab)?.id === tabId ? pick_in_message(main, scheme, action) : 0;
                const pane = front_about_3pane(tabmail) as (HintMailPane & ListenerTarget) | null;
                if (pane) {
                    const message = pane.messageBrowser.contentWindow as ListenerTarget | null | undefined;
                    return start_pick(pick_host(main, [main, pane, ...(message ? [message] : [])]), collect_targets(main, pane), scheme, action);
                }
                const browser = tab.browser ?? tab.chromeBrowser;
                const actor = browser?.isRemoteBrowser ? browser.browsingContext?.currentWindowGlobal?.getExistingActor("DesertBirdPage") : undefined;
                if (actor?.on) {
                    // The page's own child labels a remote page and answers with the count alone. The child ends the labels on a pick, a key, a scroll, a click and a page change, and on the state push that a tab change, a window blur or a shutdown sends it.
                    end_pick();
                    // The child reads the keys of its page only while the page has the focus. After the command line, say, the focus is in the window.
                    browser!.focus();
                    try {
                        return (await actor.sendQuery("DesertBird:Hints", { scheme, action })) as number;
                    } catch {
                        // The tab closed or its page went before the child answered.
                        return 0;
                    }
                }
                const page = (browser?.contentDocument ? browser.contentWindow : null) ?? null;
                return start_pick(pick_host(main, [main, ...(page ? [page] : [])]), collect_page_targets(main, page), scheme, action);
            }),
        },
    };
}

export function shutdown(): void {
    end_pick();
}
