import type { HandlerScope } from "./message.ts";
import { main_window_of } from "./tabs.ts";
import type { MainWindowApi } from "./tabs.ts";

export const HELP_PAGE = "help/help.html";

export interface HelpApi extends MainWindowApi {
    runtime: { getURL(path: string): string };
    tabs: {
        query(query: { url: string }): Promise<{ id?: number }[]>;
        create(properties: { url: string; windowId?: number }): Promise<unknown>;
        update(tab_id: number, properties: { active: true }): Promise<unknown>;
    };
}

/** Opens the help page in a tab of the key's window, or of the main window for a key in a message window, or shows the tab that already holds it. */
export async function open_help(scope: HandlerScope<HelpApi>): Promise<void> {
    const window_id = await main_window_of(scope.api, scope.window_id);
    const url = scope.api.runtime.getURL(HELP_PAGE);
    const open_id = (await scope.api.tabs.query({ url }))[0]?.id;
    if (open_id !== undefined) await scope.api.tabs.update(open_id, { active: true });
    else await scope.api.tabs.create({ url, ...(window_id >= 0 && { windowId: window_id }) });
}

export interface OptionsApi extends MainWindowApi {
    runtime: { openOptionsPage(): Promise<void> };
}

/** Opens the options page the manifest names. Thunderbird puts it in a main window, which comes to the front for a key in a message window. */
export async function open_options(scope: HandlerScope<OptionsApi>): Promise<void> {
    await main_window_of(scope.api, scope.window_id);
    await scope.api.runtime.openOptionsPage();
}

export interface WhichKeyApi {
    which_key?: { show_root(window_id: number): Promise<void> };
}

/** Lists every key bound at the top of the keymap in the window's hud panel. */
export async function show_root_keys(scope: HandlerScope<WhichKeyApi>): Promise<void> {
    await scope.api.which_key?.show_root(scope.window_id);
}
