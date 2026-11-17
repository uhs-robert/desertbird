import type { FolderpaneApi } from "../../shared/protocol.ts";
import type { AppApi } from "./app.ts";
import { focus_pane } from "./app.ts";
import type { HandlerScope } from "./message.ts";

export type CollapseApi = AppApi & { folderpane: FolderpaneApi | undefined };

// `H` is the pane chord from every other pane, so outside the folder pane it focuses the folder pane as `pane.focus` does. A folder script that is absent or fails to load must not take that chord away, so the failure is logged and the focus still moves.
export async function collapse_folder(scope: HandlerScope<CollapseApi>): Promise<void> {
    try {
        if (await scope.api.folderpane?.fold({ windowId: scope.window_id, open: false, extent: "parent" })) return;
    } catch (error) {
        console.error("folderpane.fold failed", error);
    }
    await focus_pane(scope, { pane: "folders" });
}
