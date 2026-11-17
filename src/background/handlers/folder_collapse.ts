import type { FolderpaneApi } from "../../shared/protocol.ts";
import type { AppApi } from "./app.ts";
import { focus_pane } from "./app.ts";
import type { HandlerScope } from "./message.ts";

export type CollapseApi = AppApi & { folderpane: FolderpaneApi };

// `H` is the pane chord from every other pane, so outside the folder pane it focuses the folder pane as `pane.focus` does. A failed load of the folder script shows as the command's toast.
export async function collapse_folder(scope: HandlerScope<CollapseApi>): Promise<void> {
    if (await scope.api.folderpane.fold({ windowId: scope.window_id, open: false, extent: "parent" })) return;
    await focus_pane(scope, { pane: "folders" });
}
