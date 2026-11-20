// The child half of the page actor, shipped as `experiment/page_actor_child.sys.mjs`. Thunderbird runs it in the process of each web page and other add-on's page a tab shows. It reads the key and whether the focus sits in a text field, and nothing else of the page. The matcher, the modes and the commands stay in the parent: the child holds a pushed copy of the keys to take and of the insert flag, and takes a key only when that copy names it.

import { event_to_token, is_chord } from "../../vendor/desertfox/keys/token.ts";
import type { KeyEventLike } from "../../vendor/desertfox/keys/token.ts";
import { run_scroll, scroll_axis_of, scroll_target } from "./page_actions.ts";
import type { ScrollDocument } from "./page_actions.ts";
import type { ActorState, Skeleton } from "./page_actor_parent.ts";
import type * as PageHints from "./page_hints_child.ts";

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

declare const ChromeUtils: { importESModule(url: string): typeof PageHints };

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


// The matcher's key for "any printable key" after a prefix.
const ANY_KEY = "";

/** What the walk of the page keys makes of a key: `take` it (cancel and send), `end` a half-typed sequence (send it uncancelled, so the parent ends the sequence and its key list), or `pass` it to the page untouched. */
type Verdict = "take" | "end" | "pass";

export class DesertBirdPageChild extends JSWindowActorChild {
    on = false;
    insert = false;
    page: Skeleton = {};
    typing: Skeleton = {};
    typed: string[] = [];
    counted = 0;
    // Set by the hint module while its labels show in this page.
    pick: PageHints.HintsChild["pick"] = null;

    actorCreated(): void {
        // Until the parent answers, the child takes no key: a key pressed that early goes to the page.
        this.hello();
    }

    hello(): void {
        this.sendQuery("DesertBird:Hello").then(
            (state) => this.apply(state as ActorState),
            () => (this.on = false),
        );
    }

    apply(state: ActorState): void {
        this.on = state.on === true;
        this.insert = state.insert === true;
        this.page = state.page;
        this.typing = state.typing;
        // The parent pushes the state on a tab change, a window blur and a shutdown, and each ends the hint labels.
        this.pick?.end();
        this.restart();
    }

    restart(): void {
        // The page keys typed so far, as the parent's matcher walks them: a count, then the tokens of a prefix. `counted` says how many lead as count digits.
        this.typed = [];
        this.counted = 0;
    }

    follow_leaf(leaf: Skeleton[string] | undefined): void {
        // A leaf that enters or leaves insert mode takes effect here at once, so a key typed before the parent's push arrives already meets the new mode. The push confirms it.
        if (leaf === "insert" || leaf === "normal") this.insert = leaf === "insert";
    }

    walk_page(token: string): Verdict {
        // As the parent's matcher walks: a count at the start, a key of the branch the prefix reached, any printable key where that branch captures one, and Backspace to drop the last typed key. A key off the branch ends the sequence and gets one more try as a first key.
        const { typed } = this;
        if (token === "<Backspace>" && typed.length) return (typed.pop(), (this.counted = Math.min(this.counted, typed.length)), "take");
        let branch = this.page;
        for (const key of typed.slice(this.counted)) branch = branch[key] as Skeleton;
        // A count stands only before the prefix and stops at six digits, the matcher's `MAX_COUNT_DIGITS`. A lone 0 starts none.
        if (typed.length === this.counted && this.counted < 6 && /^[0-9]$/.test(token) && (this.counted || (token !== "0" && !(token in branch)))) return (typed.push(token), this.counted++, "take");
        const next = branch[token] ?? (token === "<Space>" || [...token].length === 1 ? branch[ANY_KEY] : undefined);
        if (next === undefined) {
            this.restart();
            return typed.length ? (this.walk_page(token) === "take" ? "take" : "end") : "pass";
        }
        if (typeof next === "object") typed.push(token);
        else (this.restart(), this.follow_leaf(next));
        return "take";
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
        if (event.type !== "keydown") return;
        // The labels take every key, so neither the page nor a page key sees a hint letter.
        if (this.pick) return this.pick.key(event);
        if (!this.on || event.isComposing) return;
        const token = event_to_token(event);
        if (token === null) return;
        // In insert mode a plain key is the page's at once.
        if (this.insert && !is_chord(token) && token !== "<Escape>") return;
        const field = this.document.designMode === "on" || takes_typing(deepest_focus(this.document));
        if (token === "<Escape>") {
            // Escape stays the page's. Once the page's handlers ran, the parent learns whether one of them used it (a dialog closing), and only then leaves insert mode or the field.
            if (token in this.typing || token in this.page) {
                this.contentWindow.setTimeout(() => {
                    const prevented = !!event.defaultPrevented;
                    if (!prevented) this.follow_leaf(this.typing[token]);
                    this.send(event, field, prevented);
                });
            }
            return this.restart();
        }
        let verdict: Verdict = "pass";
        // Insert mode and a text field both take the typing keys. `field` alone goes to the parent, so Escape in insert mode leaves a focused link alone.
        if (this.insert || field) {
            // The parent's page matcher starts over on a key typed in a field, so the walk does too.
            // A key typed in a field ends a half-typed sequence. A fresh hello makes the parent end its own (as for a new page) without the key, which is text.
            if (this.typed.length) (this.restart(), this.hello());
            if (token in this.typing) (this.follow_leaf(this.typing[token]), (verdict = "take"));
        } else verdict = this.walk_page(token);
        if (verdict === "pass") return;
        if (verdict === "take") (event.preventDefault(), event.stopPropagation());
        this.send(event, field, false);
    }

    receiveMessage({ name, data }: { name: string; data?: { id?: unknown; count?: unknown } & Partial<ActorState> }): number | void {
        if (name === "DesertBird:State" && data) this.apply(data as ActorState);
        // The hint code loads on the first pick only, so a page that never sees one never loads it.
        else if (name === "DesertBird:Hints") return ChromeUtils.importESModule(new URL("page_hints_child.sys.mjs", import.meta.url).href).start(this, data as never);
        else if (name === "DesertBird:Blur") deepest_focus(this.document)?.blur?.();
        else if (name === "DesertBird:Scroll" && typeof data?.id === "string") {
            // The count comes from the parent's matcher, a number or none.
            run_scroll(data.id, scroll_target(deepest_focus(this.document) as never, this.document, undefined, scroll_axis_of(data.id)), data.count as number | undefined);
        }
    }
}
