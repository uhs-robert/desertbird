// The hint labels of a web page or another add-on's page, shipped as `experiment/page_hints_child.sys.mjs`. The page actor's child loads it on the first hint pick in its process, so the key reader that runs in every page stays small. It labels the controls on screen in the page, takes the keys until a pick or an end, and acts in the page. Only the count of labels goes back to the parent. A yank copies through the clipboard service of the page's process, which hands the text to the parent's clipboard itself, so the text never goes through the actor.

import { end_pick, start_pick } from "./hint_pick.ts";
import type { PickAction, PickKeyEvent } from "./hint_pick.ts";
import { collect_window_targets } from "./hint_targets.ts";
import type { HintWindow } from "../shared/hint_view.ts";
import type { HintLabelScheme } from "../shared/protocol.ts";

declare const Cc: Record<string, { getService(iface: unknown): { copyString(text: string): void } }>;
declare const Ci: Record<string, unknown>;

interface ListenerWindow extends HintWindow {
    addEventListener(type: string, listener: (event: DisturbEvent) => void, capture: boolean): void;
    removeEventListener(type: string, listener: (event: DisturbEvent) => void, capture: boolean): void;
}

interface DisturbEvent {
    type: string;
    target: unknown;
}

/** The page actor's child as this module uses it. `pick` is set while the labels show: the child hands it every key before the page sees one. */
export interface HintsChild {
    contentWindow: unknown;
    pick: { key(event: PickKeyEvent): void; end(): void } | null;
}

/** What the parent sends with a pick: the colors of the scheme Thunderbird shows, and what a typed label does. */
export interface HintsRequest {
    scheme: HintLabelScheme;
    action: PickAction;
}

// A scroll or a click moves the labels off their targets, and `pagehide` comes with a navigation and with a page going into the back-forward cache. The page window's own `blur` means the focus left the page for the window's chrome (a menu, the search box), so the keys no longer reach the labels. A tab change and a window blur happen in the parent, whose state push ends the labels.
const DISTURBING_EVENTS = ["scroll", "pointerdown", "pagehide", "blur"];

/** Labels the controls on screen and returns how many. With none it starts nothing. A second start ends the first, in any page of this process. */
export function start(child: HintsChild, { scheme, action }: HintsRequest): number {
    const page = child.contentWindow as ListenerWindow;
    return start_pick(
        {
            on_key(listener) {
                // `end_pick` ends the one pick of the process, which is this one while `pick` is set: a new pick ends the old one first, and that end clears the old child's `pick`.
                child.pick = { key: listener, end: end_pick };
                return () => (child.pick = null);
            },
            on_disturb(listener) {
                // A blur of an element inside the page also reaches this capture listener, and the focus stays in the page then.
                const on_event = (event: DisturbEvent) => (event.type !== "blur" || event.target === page) && listener();
                for (const type of DISTURBING_EVENTS) page.addEventListener(type, on_event, true);
                return () => DISTURBING_EVENTS.forEach((type) => page.removeEventListener(type, on_event, true));
            },
            copy: (text) => Cc["@mozilla.org/widget/clipboardhelper;1"]!.getService(Ci["nsIClipboardHelper"]).copyString(text),
        },
        collect_window_targets(page),
        scheme,
        action,
    );
}
