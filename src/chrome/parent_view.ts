// The parent script of the `view` API, in its own bundle. A footer defines the ExtensionAPI class `view`: `getAPI(context)` returns `get_view_api(context)`.
// It holds no state, so `shutdown` has nothing to remove.

import type { ViewRow, ViewRowsArgs, ViewSelectArgs } from "../shared/protocol.ts";
import { guard, most_recent_main_window, tabmail_of } from "./platform.ts";
import type { ExtensionContext } from "./platform.ts";
import { primary_about_3pane, read_rows, select_range } from "./view.ts";
import type { About3PaneLike } from "./view.ts";

function main_about_3pane(): About3PaneLike {
    const window = most_recent_main_window();
    const about_3pane = window && primary_about_3pane(tabmail_of(window));
    if (!about_3pane) throw new Error("no mail window");
    return about_3pane;
}

export function get_view_api(context: ExtensionContext) {
    return {
        view: {
            rows: guard("view.rows", ({ first, last }: ViewRowsArgs): ViewRow[] => read_rows(main_about_3pane(), first, last, (header) => context.extension.messageManager.convert(header).id)),
            select: guard("view.select", ({ anchor, end }: ViewSelectArgs): void => select_range(main_about_3pane(), anchor, end)),
        },
    };
}

export function shutdown(): void {}
