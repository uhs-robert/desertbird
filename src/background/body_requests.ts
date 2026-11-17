// The requests of the body script, which runs in a message document. A key of that document whose command lives in the background (`/` opens the command line) arrives here.

import type { Registry } from "../../vendor/desertfox/registry/define.ts";
import type { BodyInvokeRequest, BodyOpenLinkRequest, HintsApi, JsonValue, KeysInvocation } from "../shared/protocol.ts";
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
    /** The Experiment that sends the Enter of a hint pick. Absent when it failed to load, and the pick then leaves the Enter to the user. */
    hints?: Pick<HintsApi, "sendEnter"> | undefined;
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
        const message_ids = (await deps.api.messageDisplay.getDisplayedMessages(tab_id).catch(() => [])).map((message) => message.id);
        await deps.run({ command: request.command, args: request.args, count: request.count, windowId: window_id, messageIds: message_ids });
        return {};
    }

    // The Enter goes to the window of the sender and no other, so a mail that fakes this message can at worst press Enter on its own link.
    async function open_link(sender: Sender): Promise<unknown> {
        if (sender.tab?.windowId !== undefined) await deps.hints?.sendEnter({ windowId: sender.tab.windowId });
        return {};
    }

    return (message, sender) => {
        if ((message as Partial<BodyOpenLinkRequest> | null)?.type === "body.open_link") return open_link(sender);
        const request = read_invoke(message);
        return request === undefined ? undefined : invoke(request, sender);
    };
}
