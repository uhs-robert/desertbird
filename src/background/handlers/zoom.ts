// The zoom of what a window shows: the message pane in the mail tab, a message tab or a message window, or the page of the front tab. Started from DesertFox `src/commands/zoom.ts`, which zooms a tab through `tabs.getZoom` and `tabs.setZoom`. Thunderbird has neither, so the `zoom` Experiment reads and sets the level.

import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { ZoomApi } from "../../shared/protocol.ts";
import { keep_chain } from "../../shared/swallow.ts";
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
async function step_level(scope: ZoomScope, args: CheckedArgs): Promise<void> {
    const level = await scope.api.zoom.get({ windowId: scope.window_id });
    if (level === null) throw new RuntimeRefusal(NOTHING_TO_ZOOM);
    const delta = (args["delta"] as number) * scope.count;
    // Thunderbird's own Ctrl+minus reaches 0.2, below the 0.3 floor, so the clamp alone would make a zoom-out step zoom in.
    const moves_against_step = Math.sign(clamp_zoom(level + delta) - level) === -Math.sign(delta);
    if (moves_against_step) return;
    await set_level(scope, level + delta);
}

// Each step reads the level and then sets it. Two fast presses would both read the old level and one step would be lost, so the steps of a window run one after the other.
const steps_in_flight = new Map<number, Promise<void>>();

export function zoom_by(scope: ZoomScope, args: CheckedArgs): Promise<void> {
    const window_id = scope.window_id;
    const step = (steps_in_flight.get(window_id) ?? Promise.resolve()).then(() => step_level(scope, args));
    const queued = keep_chain(step);
    steps_in_flight.set(window_id, queued);
    // The chain of a window ends with its last step, so the map holds only the steps in flight.
    void queued.then(() => steps_in_flight.get(window_id) === queued && steps_in_flight.delete(window_id));
    return step;
}

export const zoom_set = (scope: ZoomScope, args: CheckedArgs): Promise<void> => set_level(scope, args["level"] as number);
