import type { CommandGroup } from "./define.ts";

// Keys that move the selection of an open Thunderbird menu or popup. The `menukeys` Experiment runs them in the window, so they carry no handler here. They live in `menu_keys` and not in `normal_keys`, because j and k are the list motions of the mail tab and the menu keys only act while a popup is open. No tab kind offers the `menu` need, so no tab tree takes them.
export const menu: CommandGroup = {
    commands: {
        "menu.down": { runs_in: "chrome", bridge: false, needs: ["menu"], label: "Menu down", intent: "Move the selection of the open menu down by one item." },
        "menu.up": { runs_in: "chrome", bridge: false, needs: ["menu"], label: "Menu up", intent: "Move the selection of the open menu up by one item." },
    },
    normal_keys: {},
    menu_keys: {
        j: { id: "menu.down" },
        k: { id: "menu.up" },
    },
};
