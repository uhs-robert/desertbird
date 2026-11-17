import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { OverlayApi, SearchDirection } from "../../shared/protocol.ts";
import type { CmdlineSessions } from "../cmdline/service.ts";
import type { SearchSessions } from "../search/service.ts";
import type { HandlerScope } from "./message.ts";

export interface SearchOpenApi {
    overlay: OverlayApi;
    cmdline: CmdlineSessions;
    search: SearchSessions;
}

/** Opens the command line as a search line. The live search starts first, so it knows the filter to restore before the first keystroke. */
export async function open_search(scope: HandlerScope<SearchOpenApi>, args: CheckedArgs): Promise<void> {
    if (scope.window_id < 0) throw new RuntimeRefusal("This window cannot show the command line.");
    const direction = args["direction"] as SearchDirection;
    await scope.api.search.start(scope.window_id, direction);
    scope.api.cmdline.begin(scope.window_id, { message_ids: scope.message_ids, text: "", search: direction });
    try {
        await scope.api.overlay.mount({ windowId: scope.window_id, surface: "cmdline", clickThrough: true });
    } catch (error) {
        scope.api.cmdline.end(scope.window_id);
        throw error;
    }
}

export const search_next = (scope: HandlerScope<{ search: SearchSessions }>): Promise<void> => scope.api.search.step(scope.window_id, "same");

export const search_prev = (scope: HandlerScope<{ search: SearchSessions }>): Promise<void> => scope.api.search.step(scope.window_id, "opposite");
