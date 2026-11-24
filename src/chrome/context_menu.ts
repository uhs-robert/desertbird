// The verb behind `, m`: opens the native context menu of what the focus is on, in the window a key came from. Thread list and folder pane rows, the message header and the compose header fields take a `contextmenu` event from here. A message body, a compose body and a page tab need a trusted event from inside their process, so the actor of `context_actor_child.ts` sends it.

import { focus_chain } from "./focus.ts";
import type { FocusNode } from "./focus.ts";
import { open_overlay_windows } from "./platform.ts";
import type { ExtensionContext } from "./platform.ts";

interface ChromeNode extends FocusNode {
    ownerDocument: { defaultView: ChromeWindow };
    browsingContext?: ActorContext;
    contains(node: unknown): boolean;
    getBoundingClientRect(): { x: number; y: number; width: number; height: number };
    dispatchEvent(event: unknown): boolean;
}

interface ChromeWindow {
    mozInnerScreenX: number;
    mozInnerScreenY: number;
    browsingContext: ActorContext;
    threadTree?: { currentIndex: number; table?: { body: unknown }; getRowAtIndex(index: number): ChromeNode | null };
    folderTree?: ChromeNode & { selectedRow: ChromeNode | null };
    MouseEvent: new (type: string, init: object) => unknown;
}

interface ActorContext {
    currentWindowGlobal: { documentPrincipal: { isSystemPrincipal: boolean }; getActor(name: string): { sendAsyncMessage(name: string): void } };
}

declare const ChromeUtils: { registerWindowActor(name: string, options: object): void; unregisterWindowActor(name: string): void };
declare const Services: { io: { getProtocolHandler(scheme: "resource"): { QueryInterface(iface: unknown): { setSubstitution(root: string, uri: unknown): void } } } };
declare const Ci: { nsIResProtocolHandler: unknown };

const ACTOR_NAME = "DesertBirdContext";
let resource_root: string | null = null;

// The root takes a new name each load, as the page actor's does, so a reloaded add-on never meets the module cache of the old one. `stop_context_actor` drops it.
function register_actor(context: ExtensionContext): void {
    const root = `desertbird-context-${Date.now()}`;
    const resource = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    resource.setSubstitution(root, (context.extension as unknown as { rootURI: unknown }).rootURI);
    try {
        ChromeUtils.registerWindowActor(ACTOR_NAME, { child: { esModuleURI: `resource://${root}/experiment/context_actor_child.sys.mjs` }, allFrames: false });
    } catch (error) {
        // A failed registration leaves no root behind, so the next press starts clean.
        resource.setSubstitution(root, null);
        throw error;
    }
    resource_root = root;
}

/** Whether a menu was asked for. False when the window has no focus target, an empty list or a folder pane with no row. */
export function open_context_menu(context: ExtensionContext, window_id: number): boolean {
    const window = open_overlay_windows().find((candidate) => context.extension.windowManager.getWrapper(candidate)?.id === window_id);
    const target = window && (focus_chain(window.document).at(-1) as ChromeNode | undefined);
    if (!target) return false;
    const view = target.ownerDocument.defaultView;
    const global = (target.localName === "browser" ? target : view).browsingContext?.currentWindowGlobal;
    if (global && !global.documentPrincipal.isSystemPrincipal) {
        if (!resource_root) register_actor(context);
        global.getActor(ACTOR_NAME).sendAsyncMessage("DesertBird:ContextMenu");
        return true;
    }
    // A row acts as a right-click on it (button 2), which makes the thread list act on the cursor row and not on the selection. Any other element takes the plain event.
    const { threadTree, folderTree } = view;
    const element = threadTree?.table?.body === target ? threadTree.getRowAtIndex(threadTree.currentIndex) : folderTree?.contains(target) ? folderTree.selectedRow : target;
    if (!element) return false;
    const box = element.getBoundingClientRect();
    const clientX = box.x + Math.min(box.width, 40) / 2;
    const clientY = box.y + Math.min(box.height, 20) / 2;
    const button = element === target ? 0 : 2;
    element.dispatchEvent(new view.MouseEvent("contextmenu", { bubbles: true, cancelable: true, view, button, clientX, clientY, screenX: view.mozInnerScreenX + clientX, screenY: view.mozInnerScreenY + clientY }));
    return true;
}

/** Unregisters the actor and drops its `resource://` root. Does nothing when no menu was ever asked for in a page. */
export function stop_context_actor(): void {
    if (!resource_root) return;
    try {
        ChromeUtils.unregisterWindowActor(ACTOR_NAME);
    } catch {
        // Already gone.
    }
    Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution(resource_root, null);
    resource_root = null;
}
