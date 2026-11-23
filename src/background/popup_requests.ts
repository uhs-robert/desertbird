// The requests of the toolbar popup page. It has no tab, so the window is the last focused main window and the sender is checked by its page address.

import { POPUP_COMMANDS } from "../shared/protocol.ts";
import type { KeysInvocation, PopupCommand } from "../shared/protocol.ts";

export const POPUP_PAGE = "popup/popup.html";

export interface PopupRequestDeps {
    /** The address of the popup page. Only a message from that page runs a command. */
    popup_url(): string;
    /** The main window the command acts in, or undefined when none is open. */
    target_window(): Promise<number | undefined>;
    /** Runs one invocation through the router and its validator. It reports its own failures. */
    run(invocation: KeysInvocation): Promise<void>;
}

type Sender = { tab?: { id?: number }; url?: string };

/** Answers a runtime message of the popup, or returns undefined for a message that is not one. */
export function create_popup_requests(deps: PopupRequestDeps): (message: unknown, sender: Sender) => Promise<unknown> | undefined {
    return (message, sender) => {
        const request = message as { type?: unknown; command?: unknown } | null;
        if (request?.type !== "popup.run") return undefined;
        const command = POPUP_COMMANDS.find((id) => id === request.command) as PopupCommand | undefined;
        if (command === undefined || sender.tab !== undefined || sender.url !== deps.popup_url()) return Promise.resolve({});
        return deps.target_window().then(async (window_id) => {
            if (window_id !== undefined) await deps.run({ command, args: {}, count: 1, windowId: window_id, messageIds: [] });
            return {};
        });
    };
}
