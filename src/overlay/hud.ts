// The hud page: the which-key panel, the toasts and the mode badge. It keeps no state. Each time the background says the hud of this window changed, it asks for the state and draws it.

import type { HudChanged, HudRequest, HudState } from "../shared/protocol.ts";

declare const messenger: {
    runtime: {
        sendMessage(message: HudRequest): Promise<unknown>;
        onMessage: { addListener(listener: (message: unknown) => void): void };
    };
};

// A panel with more keys than this is cut, so it never grows past the box it sits in.
const MAX_ROWS = 24;

const window_id = Number(new URLSearchParams(location.search).get("window"));
const which_key_element = document.getElementById("which_key") as HTMLDivElement;
const toasts_element = document.getElementById("toasts") as HTMLDivElement;
const badge_element = document.getElementById("badge") as HTMLDivElement;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, class_name: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = class_name;
    if (text !== undefined) node.textContent = text;
    return node;
}

function draw_which_key(panel: HudState["which_key"]): void {
    which_key_element.hidden = panel === null;
    if (panel === null) return;
    which_key_element.className = panel.border;
    const rows = make("div", "rows");
    for (const row of panel.rows.slice(0, MAX_ROWS)) {
        const line = make("div", "row");
        line.append(make("span", "key", row.key), make("span", row.is_group ? "group" : "command", row.is_group ? `+${row.label}` : row.label));
        rows.append(line);
    }
    if (panel.rows.length > MAX_ROWS) rows.append(make("div", "row group", `... ${panel.rows.length - MAX_ROWS} more`));
    which_key_element.replaceChildren(make("div", "title", `after ${panel.title}`), rows);
}

function draw(state: HudState): void {
    draw_which_key(state.which_key);
    toasts_element.replaceChildren(...state.toasts.map((toast) => make("div", toast.is_error ? "error" : "info", toast.text)));
    document.body.classList.toggle("lifted", state.lifted);
    badge_element.hidden = state.badge === null;
    badge_element.textContent = state.badge ?? "";
}

// A later answer replaces an earlier one that arrives after it.
let latest_request = 0;
async function refresh(): Promise<void> {
    const request = ++latest_request;
    const state = (await messenger.runtime.sendMessage({ type: "hud.state", windowId: window_id })) as HudState;
    if (request === latest_request) draw(state);
}

messenger.runtime.onMessage.addListener((message) => {
    const changed = message as Partial<HudChanged> | null;
    if (changed?.type === "hud.changed" && changed.windowId === window_id) refresh().catch(console.error);
});

refresh().catch(console.error);
