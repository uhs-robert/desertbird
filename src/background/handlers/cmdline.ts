import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { OverlayApi } from "../../shared/protocol.ts";
import type { CmdlineSessions } from "../cmdline/service.ts";
import type { HandlerScope } from "./message.ts";

export interface CmdlineApi {
    overlay: OverlayApi;
    cmdline: CmdlineSessions;
}

/** Opens the command line over the window of the key press. The session is stored first, because the page asks for it as soon as it loads. */
export async function open_cmdline(scope: HandlerScope<CmdlineApi>, args: CheckedArgs): Promise<void> {
    if (scope.window_id < 0) throw new RuntimeRefusal("This window cannot show the command line.");
    scope.api.cmdline.begin(scope.window_id, { message_ids: scope.message_ids, text: String(args["text"] ?? "") });
    try {
        await scope.api.overlay.mount({ windowId: scope.window_id, surface: "cmdline" });
    } catch (error) {
        scope.api.cmdline.end(scope.window_id);
        throw error;
    }
}
