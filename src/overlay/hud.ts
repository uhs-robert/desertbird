// The hud page: the which-key panel and the toasts. It keeps no state. Each time the background says the hud of this window changed, it asks for the state and draws it.

import type { HudChanged, HudRequest, HudState } from "../shared/protocol.ts";
import { follow_theme } from "../shared/follow_theme.ts";

declare const messenger: {
    runtime: {
        sendMessage(message: HudRequest): Promise<unknown>;
        onMessage: { addListener(listener: (message: unknown) => void): void };
    };
};

follow_theme();

// A panel after a typed prefix with more keys than this is cut, so it never grows past the box it sits in. The root list is the key list itself and shows every key, in more columns.
const MAX_ROWS = 24;

const window_id = Number(new URLSearchParams(location.search).get("window"));
const which_key_element = document.getElementById("which_key") as HTMLDivElement;
const toasts_element = document.getElementById("toasts") as HTMLDivElement;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, class_name: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = class_name;
    if (text !== undefined) node.textContent = text;
    return node;
}

const ROOT_ROWS = 12;

// The root list has to show every column with whole labels, so a narrow window gets taller columns instead of a horizontal scrollbar, which a keyboard cannot reach. Rows grow until the panel stops overflowing sideways, or until one column is left.
function fit_root_rows(rows: HTMLElement, row_count: number): void {
    for (let count = ROOT_ROWS; count <= row_count; count++) {
        rows.style.setProperty("--root_rows", String(count));
        if (which_key_element.scrollWidth <= which_key_element.clientWidth) return;
    }
}

let drawn_panel: HudState["which_key"] = null;

function draw_which_key(panel: HudState["which_key"]): void {
    drawn_panel = panel;
    which_key_element.hidden = panel === null;
    if (panel === null) return;
    const is_root = panel.title === "";
    which_key_element.className = is_root ? `${panel.border} root` : panel.border;
    const shown_rows = is_root ? panel.rows : panel.rows.slice(0, MAX_ROWS);
    const rows = make("div", "rows");
    for (const row of shown_rows) {
        const line = make("div", "row");
        line.append(make("span", "key", row.key), make("span", row.is_group ? "group" : "command", row.is_group ? `+${row.label}` : row.label));
        rows.append(line);
    }
    const hidden_count = panel.rows.length - shown_rows.length;
    which_key_element.replaceChildren(make("div", "title", is_root ? "keys" : `after ${panel.title}`), rows, ...(hidden_count > 0 ? [make("div", "row group", `... ${hidden_count} more`)] : []));
    if (is_root) fit_root_rows(rows, shown_rows.length);
}

window.addEventListener("resize", () => draw_which_key(drawn_panel));

function draw(state: HudState): void {
    draw_which_key(state.which_key);
    toasts_element.replaceChildren(...state.toasts.map((toast) => make("div", toast.is_error ? "error" : "info", toast.text)));
    document.body.classList.toggle("lifted", state.lifted);
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
