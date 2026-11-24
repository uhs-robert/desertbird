// The child half of the context menu actor, shipped as `experiment/context_actor_child.sys.mjs`. It has no parent half and no `matches`: the Experiment registers it once and asks a window global for it only when `, m` meets a message body, a compose body or a page tab. It dispatches one `contextmenu` event there. Chrome code cannot do that, and a content script cannot either, since only an event built in this process counts as trusted (docs/thunderbird-behavior.md, "Opening context menus by key").

interface ContextNode {
    localName: string;
    getBoundingClientRect(): { left: number; top: number; right: number; bottom: number };
    dispatchEvent(event: unknown): boolean;
}

interface ContextWindow {
    innerWidth: number;
    innerHeight: number;
    mozInnerScreenX: number;
    mozInnerScreenY: number;
    getSelection(): { anchorNode: { nodeType: number; parentElement: ContextNode | null } & ContextNode } | null;
    MouseEvent: new (type: string, init: object) => unknown;
}

interface ContextDocument {
    activeElement: ContextNode | null;
    body: ContextNode | null;
}

declare class JSWindowActorChild {
    document: ContextDocument;
    contentWindow: ContextWindow;
}

const MESSAGE_NAME = "DesertBird:ContextMenu";
// The point sits this far into the visible part of the element, as in the measured events: half of at most 40 by 20 pixels.
const POINT_WIDTH = 40;
const POINT_HEIGHT = 20;

// The element a key would act on: the focused one (a link), else the caret's, else the body. The document itself opens nothing.
function target_of(window: ContextWindow, document: ContextDocument): ContextNode | null {
    const focused = document.activeElement;
    if (focused && focused !== document.body) return focused;
    const anchor = window.getSelection()?.anchorNode;
    return (anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement)) || document.body;
}

export class DesertBirdContextChild extends JSWindowActorChild {
    receiveMessage({ name }: { name: string }): boolean {
        if (name !== MESSAGE_NAME) return false;
        const window = this.contentWindow;
        const target = target_of(window, this.document);
        if (!target) return false;
        const box = target.getBoundingClientRect();
        const left = Math.max(box.left, 0);
        const top = Math.max(box.top, 0);
        const clientX = Math.round(left + Math.min(Math.min(box.right, window.innerWidth) - left, POINT_WIDTH) / 2);
        const clientY = Math.round(top + Math.min(Math.min(box.bottom, window.innerHeight) - top, POINT_HEIGHT) / 2);
        const screenX = Math.round(window.mozInnerScreenX + clientX);
        const screenY = Math.round(window.mozInnerScreenY + clientY);
        target.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 0, clientX, clientY, screenX, screenY }));
        return true;
    }
}
