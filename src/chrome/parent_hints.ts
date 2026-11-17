// The parent script of the `hints` API. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `hints`: `getAPI(context)` returns `get_hints_api(context)` and `onShutdown` calls `shutdown()`.

import { focus_chain } from "./focus.ts";
import type { FocusDocument } from "./focus.ts";
import { guard } from "./platform.ts";
import type { ExtensionContext } from "./platform.ts";
import type { HintsSendEnterArgs } from "../shared/protocol.ts";

declare const Services: { wm: { getEnumerator(type: string | null): Iterable<EnterWindow> } };
declare const Cc: Record<string, { createInstance(iface: unknown): TextInputProcessor }>;
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

// What the Enter may land on, the same as the body script's pick. The focus can move between the pick and this call (a pane chord, a tab switch), and an Enter then would act on the mail window's own interface.
const OPENABLE = "a[href], button";

/** Whether the focus sits on a link or a button inside the message document, the one the pick focused. */
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

export function get_hints_api(context: ExtensionContext) {
    return {
        hints: {
            sendEnter: guard("hints.sendEnter", ({ windowId }: HintsSendEnterArgs): void => {
                const window = window_with_id(context, windowId);
                if (window === null) throw new Error(`no window ${windowId}`);
                if (!focus_is_picked_target(window)) throw new Error("the focus is not on a link or button of the message");
                press_enter(window);
            }),
        },
    };
}

export function shutdown(): void {}
