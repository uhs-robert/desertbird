import type { HandlerScope } from "./message.ts";
import { main_window_of } from "./tabs.ts";
import type { MainWindowApi } from "./tabs.ts";

export const HELP_PAGE = "help/help.html";

export interface HelpApi extends MainWindowApi {
    runtime: { getURL(path: string): string };
    tabs: {
        query(query: { url: string }): Promise<{ id?: number; windowId?: number }[]>;
        create(properties: { url: string; windowId?: number }): Promise<unknown>;
        update(tab_id: number, properties: { active: true }): Promise<unknown>;
    };
}

/** Shows the tab that already holds the help page and brings its window to the front. Else opens the page in a tab of the key's window, or of the main window for a key in a message window. */
export async function open_help(scope: HandlerScope<HelpApi>): Promise<void> {
    const url = scope.api.runtime.getURL(HELP_PAGE);
    const open = (await scope.api.tabs.query({ url }))[0];
    if (open?.id !== undefined) {
        // Activating a tab does not focus its window, which can be another main window than the key's.
        if (open.windowId !== undefined) await scope.api.windows.update(open.windowId, { focused: true });
        return void (await scope.api.tabs.update(open.id, { active: true }));
    }
    const window_id = await main_window_of(scope.api, scope.window_id);
    await scope.api.tabs.create({ url, ...(window_id >= 0 && { windowId: window_id }) });
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
