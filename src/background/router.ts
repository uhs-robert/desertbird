// Runs one invocation: look up, validate, check the Experiment, resolve the selection, call the handler. Each failure ends in a notification.

import { RuntimeRefusal } from "../../vendor/desertfox/command.ts";
import { check_args } from "../../vendor/desertfox/registry/check_args.ts";
import type { Registry } from "../../vendor/desertfox/registry/define.ts";
import { EXPERIMENT_VERBS } from "../shared/protocol.ts";
import type { KeysApi, KeysInvocation } from "../shared/protocol.ts";
import type { MessageApi, MessageListPage, Selection } from "./handlers/message.ts";
import { notify_refusal } from "./notify.ts";
import type { NotificationsApi } from "./notify.ts";
import type { ScopedContext } from "./registry.ts";

export interface RouterApi extends MessageApi, NotificationsApi {
    tabs: { query(query: { windowId: number; active: true }): Promise<{ id?: number }[]> };
    /** Absent when the Experiment failed to load. */
    keys: KeysApi | undefined;
}

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

// A selection larger than one page comes back in pages. Archive and delete act on all of it, so every page is read.
async function all_messages(api: RouterApi, first_page: MessageListPage): Promise<MessageListPage["messages"]> {
    const messages = [...first_page.messages];
    for (let page = first_page; page.id; ) {
        page = await api.messages.continueList(page.id);
        messages.push(...page.messages);
    }
    return messages;
}

async function resolve_selection(api: RouterApi, window_id: number): Promise<Selection> {
    const [tab] = await api.tabs.query({ windowId: window_id, active: true });
    if (tab?.id === undefined) throw new RuntimeRefusal("No active tab in this window.");
    const messages = await all_messages(api, await api.mailTabs.getSelectedMessages(tab.id));
    return { tab_id: tab.id, messages: messages.map((message) => ({ id: message.id, account_id: message.folder?.accountId })) };
}

export function create_router(registry: Registry, api: RouterApi) {
    async function route(invocation: KeysInvocation): Promise<void> {
        const command = registry.get(invocation.command);
        if (command === undefined) throw new RuntimeRefusal(`Unknown command ${invocation.command}.`);
        if (command.runs_in !== "background") throw new RuntimeRefusal(`${command.label} runs in the mail window and never reaches the background.`);
        const checked = check_args(command, invocation.args);
        if (!checked.ok) throw new RuntimeRefusal(checked.error);
        if (missing_experiment_verb(api, command.needs ?? []) !== undefined) throw new RuntimeRefusal(`${command.label} needs the DesertBird Experiment, which is not loaded.`);
        const selection = await resolve_selection(api, invocation.windowId);
        const context: ScopedContext = { tab_id: selection.tab_id, window_id: invocation.windowId, frame_id: 0, mode: "normal", api, selection };
        await command.run(context, checked.args);
    }

    return {
        async run(invocation: KeysInvocation): Promise<void> {
            try {
                await route(invocation);
            } catch (error) {
                const message = error instanceof RuntimeRefusal ? error.message : `${invocation.command} failed: ${error instanceof Error ? error.message : String(error)}`;
                await notify_refusal(api, message);
            }
        },
    };
}
