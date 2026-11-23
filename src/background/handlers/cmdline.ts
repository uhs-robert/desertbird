import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { OverlayApi } from "../../shared/protocol.ts";
import type { CmdlineSessions } from "../cmdline/service.ts";
import { MESSAGE_WINDOW_TYPE } from "../window_types.ts";
import type { HandlerScope } from "./message.ts";

export interface CmdlineApi {
    overlay: OverlayApi;
    cmdline: CmdlineSessions;
    windows: { get(window_id: number): Promise<{ type?: string }> };
}

/** Opens the command line over the window of the key press. The session is stored first, because the page asks for it as soon as it loads. */
export async function open_cmdline(scope: HandlerScope<CmdlineApi>, args: CheckedArgs): Promise<void> {
    if (scope.window_id < 0) throw new RuntimeRefusal("This window cannot show the command line.");
    // The window type is read before the session is stored, so a window that is gone ends the key and leaves no session behind.
    const { type } = await scope.api.windows.get(scope.window_id);
    scope.api.cmdline.begin(scope.window_id, { message_ids: scope.message_ids, text: String(args["text"] ?? ""), ...(type === MESSAGE_WINDOW_TYPE && { kind: "window" as const }) });
    try {
        await scope.api.overlay.mount({ windowId: scope.window_id, surface: "cmdline" });
    } catch (error) {
        scope.api.cmdline.end(scope.window_id);
        throw error;
    }
}
