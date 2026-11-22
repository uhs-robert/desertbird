// The requests of the body script, which runs in a message document. A key of that document whose command lives in the background (`/` opens the command line) arrives here.

import type { Registry } from "../../vendor/desertfox/registry/define.ts";
import { check_args } from "../../vendor/desertfox/registry/check_args.ts";
import type { BodyHintsRequest, BodyInvokeRequest, BodyOpenLinkRequest, BodyPendingRequest, BodyYankRequest, HintAction, JsonValue, KeysInvocation } from "../shared/protocol.ts";
import type { ThemedHints } from "./handlers/hint_window.ts";
import { notify_refusal } from "./notify.ts";
import type { NotificationsApi } from "./notify.ts";

export interface BodyRequestApi extends NotificationsApi {
    messageDisplay: { getDisplayedMessages(tab_id: number): Promise<{ id: number }[]> };
    windows: { get(window_id: number): Promise<{ type?: string }> };
}

export interface BodyRequestDeps {
    registry: Registry;
    api: BodyRequestApi;
    /** The ids of the commands a message key binds. A request for any other command is dropped. */
    allowed: ReadonlySet<string>;
    /** The Experiment that labels a message and sends the Enter of a hint pick. Absent when it failed to load: the body script then labels the body itself and leaves the Enter to the user. */
    hints?: Partial<ThemedHints> | undefined;
    /** Writes the text of a yank to the clipboard. Absent in a setup with no clipboard. */
    write_text?: ((text: string) => Promise<void>) | undefined;
    /** The hud, told which keys a message document has typed of a sequence. Absent in a setup with no hud. */
    which_key?: { on_body_pending(window_id: number, keys: string[], source: "message" | "own"): Promise<void> } | undefined;
    /** Runs one invocation through the router and its validator. It reports its own failures. */
    run(invocation: KeysInvocation): Promise<void>;
}

const MAIN_WINDOW_TYPE = "normal";

function read_invoke(message: unknown): BodyInvokeRequest | undefined {
    const request = message as Partial<Record<string, unknown>> | null;
    if (typeof request !== "object" || request === null || request["type"] !== "body.invoke") return undefined;
    const { command, args, count } = request;
    if (typeof command !== "string" || typeof args !== "object" || args === null || Array.isArray(args) || typeof count !== "number" || !Number.isInteger(count) || count < 1) return undefined;
    return { type: "body.invoke", command, args: args as Record<string, JsonValue>, count };
}

function read_pending(message: unknown): BodyPendingRequest | undefined {
    const request = message as Partial<Record<string, unknown>> | null;
    if (typeof request !== "object" || request === null || request["type"] !== "body.pending") return undefined;
    const { keys, tree } = request;
    return Array.isArray(keys) && keys.every((key) => typeof key === "string") ? { type: "body.pending", keys: keys as string[], ...(tree === "own" ? { tree } : {}) } : undefined;
}

type Sender = { tab?: { id?: number; windowId?: number } };

/** Answers a runtime message of the body script, or returns undefined for a message that is not one. The window and the messages come from the sender, which a mail cannot write. */
export function create_body_requests(deps: BodyRequestDeps): (message: unknown, sender: Sender) => Promise<unknown> | undefined {
    async function invoke(request: BodyInvokeRequest, sender: Sender): Promise<unknown> {
        const { id: tab_id, windowId: window_id } = sender.tab ?? {};
        if (!deps.allowed.has(request.command) || tab_id === undefined || window_id === undefined) return {};
        // The overlay mounts in a main window only. A message window has none, so the key says so and does not fail in the Experiment.
        const needs_overlay = deps.registry.get(request.command)?.needs?.includes("overlay.mount") === true;
        if (needs_overlay && (await deps.api.windows.get(window_id)).type !== MAIN_WINDOW_TYPE) {
            await notify_refusal(deps.api, "The command line is not available in a message window. Open the message in a tab to use it.");
            return {};
        }
        // A page of the add-on is a tab with no message. The call may refuse for it, and the key then runs with no messages.
        const message_ids = (await deps.api.messageDisplay.getDisplayedMessages(tab_id).catch((error: unknown) => (console.error("desertbird body request:", error), []))).map((message) => message.id);
        await deps.run({ command: request.command, args: request.args, count: request.count, windowId: window_id, messageIds: message_ids });
        return {};
    }

    // The Enter goes to the window of the sender and no other, so a mail that fakes this message can at worst press Enter on its own link.
    async function open_link(sender: Sender): Promise<unknown> {
        if (sender.tab?.windowId !== undefined) await deps.hints?.sendEnter?.({ windowId: sender.tab.windowId });
        return {};
    }

    // One label set over the header and the body. The action passes the command's own validator, as from any other source. -1 hands the labels back to the body script.
    async function hints_pick(request: Partial<BodyHintsRequest>, sender: Sender): Promise<number> {
        const command = deps.registry.get("hint.pick");
        const checked = command && check_args(command, { action: request.action });
        const window_id = sender.tab?.windowId;
        if (!checked?.ok || window_id === undefined || !deps.hints?.pick) return -1;
        return deps.hints.pick({ windowId: window_id, action: checked.args["action"] as HintAction, place: "message" });
    }

    // The text is of a link in a mail, which the user chose with a label. An empty one would clear the clipboard.
    async function yank(request: BodyYankRequest): Promise<unknown> {
        if (request.text.trim() !== "") await deps.write_text?.(request.text);
        return {};
    }

    return (message, sender) => {
        const pending = read_pending(message);
        if (pending !== undefined) return sender.tab?.windowId === undefined ? Promise.resolve({}) : deps.which_key?.on_body_pending(sender.tab.windowId, pending.keys, pending.tree ?? "message").then(() => ({}));
        if ((message as Partial<BodyOpenLinkRequest> | null)?.type === "body.open_link") return open_link(sender);
        const hints = message as Partial<BodyHintsRequest> | null;
        if (hints?.type === "body.hints") return hints_pick(hints, sender);
        const yanked = message as Partial<BodyYankRequest> | null;
        if (yanked?.type === "body.yank" && typeof yanked.text === "string") return yank({ type: "body.yank", text: yanked.text });
        const request = read_invoke(message);
        return request === undefined ? undefined : invoke(request, sender);
    };
}
