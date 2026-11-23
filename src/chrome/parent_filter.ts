// The parent script of the `filter` API: the add-on's own part of the quick filter of a mail tab. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `filter`. Thunderbird loads it when the first call arrives, so the key script, which loads at startup, carries none of it.

import { define_message_filter, MESSAGE_FILTER_NAME, show_message_filter } from "./filter_runtime.ts";
import type { MessageFilterState, QuickFilterBarLike, QuickFilterManagerLike, SearchConstants } from "./filter_runtime.ts";
import { guard } from "./platform.ts";
import type { ExtensionContext } from "./platform.ts";
import type { FilterSetArgs } from "../shared/protocol.ts";

declare const ChromeUtils: { importESModule(url: string): { QuickFilterManager: QuickFilterManagerLike } };
declare const Ci: SearchConstants;

/** The tab manager maps a MailExtension tab id to its tab of `tabmail`. A mail tab's browser holds `about:3pane`, which holds the bar. */
type FilterContext = ExtensionContext & { extension: { tabManager: { get(tab_id: number): { nativeTab: { chromeBrowser?: { contentWindow: { quickFilterBar?: QuickFilterBarLike } | null } | null } } } } };

// Set on the first call. The definition holds a function of this add-on, which dies with it, so `shutdown` removes it from the manager.
let defined_in: QuickFilterManagerLike | null = null;

export function get_filter_api(context: FilterContext) {
    return {
        filter: {
            set: guard("filter.set", async ({ tabId, listId, dateUs }: FilterSetArgs): Promise<void> => {
                const bar = context.extension.tabManager.get(tabId).nativeTab.chromeBrowser?.contentWindow?.quickFilterBar;
                if (!bar) throw new Error(`tab ${tabId} shows no message list`);
                defined_in ??= ChromeUtils.importESModule("resource:///modules/QuickFilterManager.sys.mjs").QuickFilterManager;
                define_message_filter(defined_in, Ci);
                // The schema fills a missing optional property with undefined or null, so the state takes only real values.
                const state: MessageFilterState = {};
                if (typeof listId === "string") state.listId = listId;
                if (typeof dateUs === "number") state.dateUs = dateUs;
                await show_message_filter(bar, state);
            }),
        },
    };
}

export function shutdown(): void {
    if (defined_in && MESSAGE_FILTER_NAME in defined_in.filterDefsByName) defined_in.killFilter(MESSAGE_FILTER_NAME);
    defined_in = null;
}
