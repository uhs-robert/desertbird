// The zoom of what a window shows: the message pane in the mail tab, a message tab or a message window, or the page of the front tab. Started from DesertFox `src/commands/zoom.ts`, which zooms a tab through `tabs.getZoom` and `tabs.setZoom`. Thunderbird has neither, so the `zoom` Experiment reads and sets the level.

import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { ZoomApi } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 5;

export interface ZoomHandlerApi {
    zoom: ZoomApi;
}

type ZoomScope = HandlerScope<ZoomHandlerApi>;

const NOTHING_TO_ZOOM = "This tab has nothing to zoom. Calendar and tasks have no zoom, and the mail tab zooms the message it shows.";

// Rounded to 2 places so repeated 0.1 steps do not drift to 1.2000000000000002.
export function clamp_zoom(level: number): number {
    return Math.round(Math.min(Math.max(level, ZOOM_MIN), ZOOM_MAX) * 100) / 100;
}

async function set_level(scope: ZoomScope, level: number): Promise<void> {
    if (!(await scope.api.zoom.set({ windowId: scope.window_id, level: clamp_zoom(level) }))) throw new RuntimeRefusal(NOTHING_TO_ZOOM);
}

/** A count multiplies the step, so `3zi` zooms in by three steps in one change. */
export async function zoom_by(scope: ZoomScope, args: CheckedArgs): Promise<void> {
    const level = await scope.api.zoom.get({ windowId: scope.window_id });
    if (level === null) throw new RuntimeRefusal(NOTHING_TO_ZOOM);
    await set_level(scope, level + (args["delta"] as number) * scope.count);
}

export const zoom_set = (scope: ZoomScope, args: CheckedArgs): Promise<void> => set_level(scope, args["level"] as number);
