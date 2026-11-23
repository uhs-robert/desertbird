import { zoom_by, zoom_set } from "../handlers/zoom.ts";
import type { ZoomHandlerApi } from "../handlers/zoom.ts";
import { needing, scoped } from "./define.ts";
import type { CommandGroup } from "./define.ts";

// The args and steps of DesertFox. `zM` and `zR` stay the thread folds of the mail tab, so only the lower-case keys zoom by half a step.
export const zoom: CommandGroup = {
    commands: needing("main", {
        "zoom.by": {
            bridge: false,
            runs_in: "background",
            label: "Zoom by",
            intent: "Zoom the message or the page in or out by an amount. A value of 0.1 is ten percent. A count multiplies it. The level stays within 0.3 and 5.",
            params: [{ name: "delta", type: "float" }],
            count: "repeat",
            needs: ["zoom.get", "zoom.set"],
            run: scoped<ZoomHandlerApi>(zoom_by),
        },
        "zoom.set": {
            bridge: false,
            runs_in: "background",
            name: "zoom",
            label: "Set zoom",
            intent: "Set the zoom level of the message or the page. A level of 1 is 100%. The level is limited to 0.3 through 5.",
            params: [{ name: "level", type: "float" }],
            needs: ["zoom.set"],
            run: scoped<ZoomHandlerApi>(zoom_set),
        },
    }),
    normal_keys: {
        zi: { id: "zoom.by", args: { delta: 0.1 }, label: "Zoom in" },
        "z+": { id: "zoom.by", args: { delta: 0.1 }, label: "Zoom in" },
        zo: { id: "zoom.by", args: { delta: -0.1 }, label: "Zoom out" },
        "z-": { id: "zoom.by", args: { delta: -0.1 }, label: "Zoom out" },
        zm: { id: "zoom.by", args: { delta: 0.5 }, label: "Zoom in a lot" },
        zr: { id: "zoom.by", args: { delta: -0.5 }, label: "Zoom out a lot" },
        "z=": { id: "zoom.set", args: { level: 1 }, label: "Reset zoom" },
        zI: { id: "zoom.set", args: { level: 3 }, label: "Zoom to 300%" },
        zO: { id: "zoom.set", args: { level: 0.3 }, label: "Zoom to 30%" },
    },
};
