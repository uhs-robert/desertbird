import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { HintsApi } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";

/** The hints Experiment as the router hands it on: the colors are filled in from the theme setting, so a command names the window and nothing else. */
export type ThemedHints = Pick<HintsApi, "sendEnter"> & { pick(args: { windowId: number }): Promise<number> };

export interface HintWindowApi {
    hints: ThemedHints;
}

export async function pick_in_window(scope: HandlerScope<HintWindowApi>): Promise<void> {
    if ((await scope.api.hints.pick({ windowId: scope.window_id })) === 0) throw new RuntimeRefusal("Nothing on screen to pick.");
}
