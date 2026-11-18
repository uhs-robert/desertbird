// The confirm prompt mode of the command line page. The background picks it in its answer to `cmdline.hello`. The page then draws the prompt as plain text, shows no input line and sends one answer: `y` is yes, `n` and Escape are no, and every other key does nothing.

import { CONFIRM_KEY_GRACE_MS } from "../shared/protocol.ts";
import type { ConfirmAnswerResult, ConfirmPrompt } from "../shared/protocol.ts";

const ACTION_VERBS: Record<ConfirmPrompt["action"], string> = { archive: "Archive", trash: "Move to Trash", move: "Move" };

export interface ConfirmLines {
    source: string;
    headline: string;
    items: string[];
    more?: string;
    keys: string;
}

export function confirm_lines(prompt: ConfirmPrompt): ConfirmLines {
    const noun = prompt.count === 1 ? "message" : "messages";
    const target = prompt.target_folder_name === undefined ? "" : ` to ${prompt.target_folder_name}`;
    return {
        source: "Requested by a program outside Thunderbird",
        headline: `${ACTION_VERBS[prompt.action]} ${prompt.count} ${noun}${target}?`,
        items: prompt.items.map((item) => `${item.from}: ${item.subject}`),
        ...(prompt.more > 0 && { more: `and ${prompt.more} more` }),
        keys: "y yes, n or Escape no",
    };
}

export interface ConfirmKey {
    key: string;
    repeat: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

/** The answer a key gives, or undefined for a key that gives none. A held key repeats, so a repeat never answers. */
export function answer_of_key(event: ConfirmKey, ms_since_shown: number): "yes" | "no" | undefined {
    if (ms_since_shown < CONFIRM_KEY_GRACE_MS || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return undefined;
    if (event.key === "y") return "yes";
    return event.key === "n" || event.key === "Escape" ? "no" : undefined;
}

export interface PromptNode<Self> {
    className: string;
    textContent: string | null;
    append(...children: Self[]): void;
}

/** What the prompt needs from the page. `create` makes elements that only ever get text, never markup. */
export interface ConfirmPage<Node extends PromptNode<Node>> {
    create(tag: "div"): Node;
    /** Puts the prompt in the page in place of the command line. */
    show(prompt_element: Node): void;
    on_key(listener: (event: ConfirmKey & { preventDefault(): void }) => void): void;
    now_ms(): number;
    send_answer(answer: "yes" | "no"): Promise<ConfirmAnswerResult>;
    /** Asks the background to take the page down. */
    close(): void;
}

export function show_confirm<Node extends PromptNode<Node>>(prompt: ConfirmPrompt, page: ConfirmPage<Node>): void {
    const lines = confirm_lines(prompt);
    const line = (class_name: string, text: string): Node => {
        const node = page.create("div");
        node.className = class_name;
        node.textContent = text;
        return node;
    };
    const box = page.create("div");
    box.className = "confirm";
    box.append(line("source", lines.source), line("headline", lines.headline), ...lines.items.map((text) => line("item", text)), ...(lines.more === undefined ? [] : [line("more", lines.more)]), line("keys", lines.keys));
    page.show(box);
    const shown_at_ms = page.now_ms();
    let sent = false;
    page.on_key((event) => {
        // Every key stays in the page, so none reaches Thunderbird while the prompt shows.
        event.preventDefault();
        if (sent) return;
        const answer = answer_of_key(event, page.now_ms() - shown_at_ms);
        if (answer === undefined) return;
        sent = true;
        page.send_answer(answer).then(
            (result) => {
                if (result.outcome === "ignored") sent = false;
                else if (result.outcome === "stale") page.close();
            },
            () => (sent = false),
        );
    });
}
