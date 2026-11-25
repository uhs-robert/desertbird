// The hud page: the which-key panel and the toasts. It keeps no state. Each time the background says the hud of this window changed, it asks for the state and draws it.

import type { HudChanged, HudRequest, HudState } from "../shared/protocol.ts";
import { follow_theme } from "../shared/follow_theme.ts";
import { choose_columns, fit_title } from "../../vendor/desertfox/whichkey_layout.ts";
import { STYLE } from "../../vendor/desertfox/whichkey_style.ts";
import { height_for_column_chooser } from "./which_key_height.ts";

declare const messenger: {
    runtime: {
        sendMessage(message: HudRequest): Promise<unknown>;
        onMessage: { addListener(listener: (message: unknown) => void): void };
    };
};

follow_theme();
document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }));

const window_id = Number(new URLSearchParams(location.search).get("window"));
const which_key_element = document.getElementById("which_key") as HTMLDivElement;
which_key_element.className = "desertfox-whichkey";
const toasts_element = document.getElementById("toasts") as HTMLDivElement;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, class_name: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = class_name;
    if (text !== undefined) node.textContent = text;
    return node;
}

// DesertFox's panel look: its sheet and its column chooser are vendored, and the sheet reads the `--desertfox-*` tokens that `follow_theme` publishes on the page root.
const FOOTER: readonly [key: string, word: string][] = [["ESC", "close"]];

let drawn_panel: HudState["which_key"] = null;

function draw_which_key(panel: HudState["which_key"]): void {
    drawn_panel = panel;
    which_key_element.hidden = panel === null;
    if (panel === null) return;
    const columns = choose_columns(panel.rows.length, height_for_column_chooser(window.innerHeight));
    const list = make("div", "rows");
    list.style.gridTemplateColumns = `repeat(${columns}, auto)`;
    for (const row of panel.rows) {
        const line = make("div", row.is_group ? "row group" : "row");
        line.append(make("span", "key", row.key), make("span", "arrow", "\u279c"), make("span", "label", row.is_group ? `+${row.label}` : row.label));
        list.append(line);
    }
    const footer = make("div", "footer");
    for (const [key, word] of FOOTER) footer.append(make("span", "", key), word);
    const body = make("div", "body");
    body.append(list, footer);
    const frame = make("div", `frame ${panel.border}`);
    frame.append(body);
    const chip = make("div", "chip");
    const title_bar = make("div", "title");
    title_bar.append(chip);
    which_key_element.replaceChildren(title_bar, frame);
    // Only a rendered chip can say whether it overflows.
    chip.textContent = fit_title(panel.title, (candidate) => ((chip.textContent = candidate), chip.scrollWidth > chip.clientWidth)).text;
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
