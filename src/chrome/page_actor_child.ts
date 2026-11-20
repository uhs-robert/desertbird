// The child half of the page actor, shipped as `experiment/page_actor_child.sys.mjs`. Thunderbird runs it in the process of each web page and other add-on's page a tab shows. It reads the key and whether the focus sits in a text field, and nothing else of the page. The matcher, the modes and the commands stay in the parent: the child holds a pushed copy of the keys to take and of the insert flag, and takes a key only when that copy names it.

import { event_to_token, is_chord } from "../../vendor/desertfox/keys/token.ts";
import type { KeyEventLike } from "../../vendor/desertfox/keys/token.ts";
import { run_scroll, scroll_axis_of, scroll_target } from "./page_actions.ts";
import type { ScrollDocument } from "./page_actions.ts";
import type { ActorState } from "./page_actor_parent.ts";

interface FieldNode {
    localName?: string;
    type?: string;
    isContentEditable?: boolean;
    shadowRoot?: { activeElement: FieldNode | null } | null;
    contentDocument?: { activeElement: FieldNode | null } | null;
    blur?(): void;
}

interface ChildDocument extends ScrollDocument {
    activeElement: FieldNode | null;
    designMode?: string;
}

interface ChildEvent extends KeyEventLike {
    type: string;
    persisted?: boolean;
    isComposing?: boolean;
    defaultPrevented?: boolean;
    preventDefault(): void;
    stopPropagation(): void;
}

declare class JSWindowActorChild {
    document: ChildDocument;
    contentWindow: { setTimeout(callback: () => void): void };
    sendAsyncMessage(name: string, data?: unknown): void;
    sendQuery(name: string, data?: unknown): Promise<unknown>;
}

// DesertFox's `takes_typing`: an input of these types takes no text.
const NOT_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "radio", "submit", "reset", "image", "file", "color", "range", "hidden"]);

// DesertFox's `takes_typing`, plus `select`, whose letter keys pick an option.
const takes_typing = (node: FieldNode | null): boolean => !!node && (node.isContentEditable === true || node.localName === "textarea" || node.localName === "select" || (node.localName === "input" && !NOT_TEXT_INPUT_TYPES.has(node.type ?? "")));

/** The focused element, followed into shadow roots and same-process frames, as DesertFox's deepest focus walk does. */
export function deepest_focus(document: { activeElement: FieldNode | null }): FieldNode | null {
    let node = document.activeElement;
    for (let inner; (inner = node?.shadowRoot?.activeElement ?? node?.contentDocument?.activeElement); ) node = inner;
    return node;
}

const OFF: ActorState = { on: false, insert: false, page: [], typing: [] };

export class DesertBirdPageChild extends JSWindowActorChild {
    on = false;
    insert = false;
    page = new Set<string>();
    typing = new Set<string>();

    // Until the parent answers, the child takes no key: a key pressed that early goes to the page.
    actorCreated(): void {
        this.hello();
    }

    hello(): void {
        this.sendQuery("DesertBird:Hello").then(
            (state) => this.apply(state as ActorState),
            () => this.apply(OFF),
        );
    }

    apply(state: ActorState): void {
        this.on = state.on === true;
        this.insert = state.insert === true;
        this.page = new Set(state.page);
        this.typing = new Set(state.typing);
    }

    in_field(): boolean {
        return this.document.designMode === "on" || takes_typing(deepest_focus(this.document));
    }

    send(event: ChildEvent, field: boolean, prevented: boolean): void {
        try {
            this.sendAsyncMessage("DesertBird:Key", { key: event.key, code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey, field, prevented });
        } catch {
            // The parent is gone (the add-on shut down), so this child stays out of the way until its page goes.
            this.on = false;
        }
    }

    handleEvent(event: ChildEvent): void {
        // A page back from the back-forward cache keeps its child and its old copy, so it asks again.
        if (event.type === "pageshow" && event.persisted) return this.hello();
        if (event.type !== "keydown" || !this.on || event.isComposing) return;
        const token = event_to_token(event);
        if (token === null) return;
        const chord = is_chord(token);
        // In insert mode a plain key is the page's at once.
        if (this.insert && !chord && token !== "<Escape>") return;
        const field = this.insert || this.in_field();
        if (token === "<Escape>") {
            // Escape stays the page's. Once the page's handlers ran, the parent learns whether one of them used it (a dialog closing), and only then leaves insert mode or the field.
            if (this.typing.has(token) || this.page.has(token)) this.contentWindow.setTimeout(() => this.send(event, field, event.defaultPrevented === true));
            return;
        }
        if (!(field ? this.typing : this.page).has(token)) return;
        event.preventDefault();
        event.stopPropagation();
        this.send(event, field, false);
    }

    receiveMessage({ name, data }: { name: string; data?: { id?: unknown; count?: unknown } & Partial<ActorState> }): void {
        if (name === "DesertBird:State" && data) this.apply(data as ActorState);
        else if (name === "DesertBird:Blur") deepest_focus(this.document)?.blur?.();
        else if (name === "DesertBird:Scroll" && typeof data?.id === "string") {
            const count = typeof data.count === "number" ? data.count : undefined;
            run_scroll(data.id, scroll_target(deepest_focus(this.document) as never, this.document, undefined, scroll_axis_of(data.id)), count);
        }
    }
}
