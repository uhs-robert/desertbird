import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { HintAction, HintsApi } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";

/** The hints Experiment as the router hands it on: the colors are filled in from the theme setting, so a command names the window and nothing else. */
export type ThemedHints = Pick<HintsApi, "sendEnter"> & { pick(args: { windowId: number; action?: HintAction; place?: "message" }): Promise<number> };

export interface HintWindowApi {
    hints: ThemedHints;
}

export async function pick_in_window(scope: HandlerScope<HintWindowApi>, args: CheckedArgs): Promise<void> {
    if ((await scope.api.hints.pick({ windowId: scope.window_id, action: args["action"] as HintAction })) === 0) throw new RuntimeRefusal("Nothing on screen to pick.");
}
