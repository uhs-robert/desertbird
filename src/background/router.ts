// Runs one invocation: look up, validate, check the Experiment, call the handler on the messages the invocation names. Each failure ends in a notification.

import { RuntimeRefusal } from "../../vendor/desertfox/command.ts";
import { check_args } from "../../vendor/desertfox/registry/check_args.ts";
import type { Registry } from "../../vendor/desertfox/registry/define.ts";
import { EXPERIMENT_VERBS } from "../shared/protocol.ts";
import type { HintsApi, KeysApi, KeysInvocation, OverlayApi } from "../shared/protocol.ts";
import type { CmdlineSessions } from "./cmdline/service.ts";
import type { SearchSessions } from "./search/service.ts";
import type { AttachmentsApi } from "./handlers/attachments.ts";
import type { FolderApi } from "./handlers/folder_open.ts";
import type { FollowupApi } from "./handlers/followup.ts";
import type { MessageApi } from "./handlers/message.ts";
import type { QuickReplyApi } from "./handlers/quick_reply.ts";
import type { UnsubscribeApi } from "./handlers/unsubscribe.ts";
import type { SnoozeApi } from "./handlers/snooze.ts";
import type { ThreadViewApi } from "./handlers/thread_view.ts";
import type { UndoApi } from "./handlers/undo.ts";
import type { ViewApi } from "./handlers/view.ts";
import { notify_refusal } from "./notify.ts";
import type { NotificationsApi } from "./notify.ts";
import type { ScopedContext } from "./commands/index.ts";

// An intersection, not an interface that extends each part: the parts share `folders`, `messages` and `mailTabs` with different members.
export type RouterApi = MessageApi & ViewApi & NotificationsApi & SnoozeApi & FollowupApi & QuickReplyApi & AttachmentsApi & Pick<UnsubscribeApi, "windows"> & { messages: Pick<UnsubscribeApi["messages"], "getFull"> } & FolderApi & Omit<ThreadViewApi, "keys"> & Pick<UndoApi, "undo"> & {
    /** Absent when the Experiment failed to load. */
    keys: KeysApi | undefined;
    overlay: OverlayApi | undefined;
    hints?: HintsApi | undefined;
    cmdline: CmdlineSessions;
    search: SearchSessions;
};

const is_experiment_namespace = (name: string): name is keyof typeof EXPERIMENT_VERBS => Object.hasOwn(EXPERIMENT_VERBS, name);

/** A need that names an Experiment verb (`keys.install`) must be loaded. Any other need is an optional permission, which this router does not check. */
function missing_experiment_verb(api: RouterApi, needs: readonly string[]): string | undefined {
    return needs.find((need) => {
        const [namespace = "", verb = ""] = need.split(".");
        if (!is_experiment_namespace(namespace)) return false;
        const loaded = api[namespace] as Record<string, unknown> | undefined;
        return typeof loaded?.[verb] !== "function";
    });
}

export function create_router(registry: Registry, api: RouterApi) {
    async function route(invocation: KeysInvocation): Promise<void> {
        const command = registry.get(invocation.command);
        if (command === undefined) throw new RuntimeRefusal(`Unknown command ${invocation.command}.`);
        if (command.runs_in !== "background") throw new RuntimeRefusal(`${command.label} runs in the mail window and never reaches the background.`);
        const checked = check_args(command, invocation.args);
        if (!checked.ok) throw new RuntimeRefusal(checked.error);
        if (missing_experiment_verb(api, command.needs ?? []) !== undefined) throw new RuntimeRefusal(`${command.label} needs the DesertBird Experiment, which is not loaded.`);
        // The ids are the selection at the key press. A read of the selection now could see the row a later `j` moved to.
        const context: ScopedContext = { tab_id: undefined, window_id: invocation.windowId, frame_id: 0, mode: "normal", api, message_ids: invocation.messageIds, count: invocation.count };
        await command.run(context, checked.args);
    }

    return {
        async run(invocation: KeysInvocation): Promise<void> {
            try {
                await route(invocation);
            } catch (error) {
                const message = error instanceof RuntimeRefusal ? error.message : `${invocation.command} failed: ${error instanceof Error ? error.message : String(error)}`;
                await notify_refusal(api, message, invocation.windowId);
            }
        },
    };
}
