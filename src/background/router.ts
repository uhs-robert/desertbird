// Runs one invocation: look up, validate, check the Experiment, resolve the selection, call the handler. Each failure ends in a notification.

import { RuntimeRefusal } from "../../vendor/desertfox/command.ts";
import { check_args } from "../../vendor/desertfox/registry/check_args.ts";
import type { Registry } from "../../vendor/desertfox/registry/define.ts";
import { EXPERIMENT_VERBS } from "../shared/protocol.ts";
import type { KeysInvocation, ViewApi } from "../shared/protocol.ts";
import type { MessageApi, Selection } from "./handlers/message.ts";
import { notify_refusal } from "./notify.ts";
import type { NotificationsApi } from "./notify.ts";
import type { ScopedContext } from "./registry.ts";

export interface RouterApi extends MessageApi, NotificationsApi {
    tabs: { query(query: { windowId: number; active: true }): Promise<{ id?: number }[]> };
    /** Absent when the Experiment failed to load. */
    view: ViewApi | undefined;
}

const VIEW_PREFIX = "view.";

/** A need names an Experiment verb (`view.rows`). Any other need is an optional permission, which this router does not check. */
const view_verbs_of = (needs: readonly string[]): string[] => needs.filter((need) => need.startsWith(VIEW_PREFIX)).map((need) => need.slice(VIEW_PREFIX.length));

function missing_experiment_verb(api: RouterApi, needs: readonly string[]): string | undefined {
    const loaded: readonly string[] = api.view === undefined ? [] : EXPERIMENT_VERBS.view.functions.filter((verb) => typeof api.view?.[verb] === "function");
    return view_verbs_of(needs).find((verb) => !loaded.includes(verb));
}

// A handler may call only the view verbs its definition lists, so `needs` stays the true record of what a command uses.
// A command with no view needs still gets an object, whose verbs all throw, so a handler never meets `undefined`.
function view_limited_to(view: ViewApi | undefined, needs: readonly string[]): ViewApi {
    const allowed = view_verbs_of(needs);
    const checked = (verb: string): ViewApi => {
        if (view === undefined || !allowed.includes(verb)) throw new Error(`view.${verb} is not listed in the command's needs`);
        return view;
    };
    return { rows: (args) => checked("rows").rows(args), select: (args) => checked("select").select(args) };
}

async function resolve_selection(api: RouterApi, window_id: number): Promise<Selection> {
    const [tab] = await api.tabs.query({ windowId: window_id, active: true });
    if (tab?.id === undefined) throw new RuntimeRefusal("No active tab in this window.");
    const { messages } = await api.mailTabs.getSelectedMessages(tab.id);
    return { tab_id: tab.id, messages: messages.map((message) => ({ id: message.id, account_id: message.folder?.accountId })) };
}

export function create_router(registry: Registry, api: RouterApi) {
    async function route(invocation: KeysInvocation): Promise<void> {
        const command = registry.get(invocation.command);
        if (command === undefined) throw new RuntimeRefusal(`Unknown command ${invocation.command}.`);
        if (command.runs_in !== "background") throw new RuntimeRefusal(`${command.label} runs in the mail window and never reaches the background.`);
        const checked = check_args(command, invocation.args);
        if (!checked.ok) throw new RuntimeRefusal(checked.error);
        const needs = command.needs ?? [];
        if (missing_experiment_verb(api, needs) !== undefined) throw new RuntimeRefusal(`${command.label} needs the DesertBird Experiment, which is not loaded.`);
        const selection = await resolve_selection(api, invocation.windowId);
        const context: ScopedContext = { tab_id: selection.tab_id, window_id: invocation.windowId, frame_id: 0, mode: "normal", api, view: view_limited_to(api.view, needs), selection };
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
