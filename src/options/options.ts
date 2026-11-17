// The options page. It lists the settings and the key bindings and writes both to `storage.local`. The background page picks the change up through `storage.onChanged`.

import { SETTING_DEFAULTS } from "../background/config/settings.ts";
import { SETTING_KINDS } from "../background/config/settings.ts";
import type { SettingName } from "../background/config/settings.ts";
import { CONFIG_VERSION } from "../background/config/migrations.ts";
import { create_config_store } from "../background/config/store.ts";
import type { ConfigStorage } from "../background/config/store.ts";
import { build_user_keymap, default_rows, edits_from_user_keymap, overrides_from_texts, setting_to_text } from "./model.ts";
import type { BindingRow } from "./model.ts";

declare const messenger: ConfigStorage;

const store = create_config_store(messenger);
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Node[]): HTMLElementTagNameMap[K] {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

const setting_inputs = new Map<SettingName, HTMLInputElement | HTMLSelectElement>();
const removed_defaults = new Set<string>();
let user_rows: BindingRow[] = [];

function say(message: string, is_error = false): void {
    const status = element("status");
    status.textContent = message;
    status.className = is_error ? "error" : "";
}

function render_settings(overrides: Record<string, unknown>): void {
    const form = element("settings_form");
    form.replaceChildren();
    setting_inputs.clear();
    for (const name of Object.keys(SETTING_KINDS) as SettingName[]) {
        const spec = SETTING_KINDS[name];
        const value = setting_to_text(name, name in overrides ? overrides[name] : SETTING_DEFAULTS[name]);
        let input: HTMLInputElement | HTMLSelectElement;
        if (spec.kind === "choice") {
            input = make("select", {}, ...spec.choices.map((choice) => make("option", { value: choice, textContent: choice, selected: choice === value })));
        } else if (spec.kind === "boolean") {
            input = make("select", {}, ...["true", "false"].map((choice) => make("option", { value: choice, textContent: choice, selected: choice === value })));
        } else {
            input = make("input", { type: "text", value });
        }
        setting_inputs.set(name, input);
        form.append(make("label", {}, make("span", { textContent: name }), input));
    }
}

function text_cell(row: BindingRow, field: keyof BindingRow): HTMLTableCellElement {
    return make("td", {}, make("input", { type: "text", value: row[field], oninput: (event) => void (row[field] = (event.target as HTMLInputElement).value) }));
}

function render_bindings(): void {
    const table = element("bindings_table");
    table.replaceChildren(make("tr", {}, ...["Keys", "Command", "Args", ""].map((title) => make("th", { textContent: title }))));
    for (const row of default_rows()) {
        const unbind = make("input", { type: "checkbox", checked: removed_defaults.has(row.keys), onchange: () => void (unbind.checked ? removed_defaults.add(row.keys) : removed_defaults.delete(row.keys)) });
        table.append(make("tr", {}, make("td", { textContent: row.keys }), make("td", { textContent: row.command }), make("td", { textContent: row.args }), make("td", {}, make("label", {}, unbind, make("span", { textContent: " Unbind" })))));
    }
    for (const row of user_rows) {
        const remove = make("button", {
            type: "button",
            textContent: "Remove",
            onclick: () => {
                user_rows = user_rows.filter((other) => other !== row);
                render_bindings();
            },
        });
        table.append(make("tr", {}, text_cell(row, "keys"), text_cell(row, "command"), text_cell(row, "args"), make("td", {}, remove)));
    }
}

async function save(): Promise<void> {
    const texts = Object.fromEntries([...setting_inputs].map(([name, input]) => [name, input.value])) as Record<SettingName, string>;
    const { overrides, errors } = overrides_from_texts(texts, SETTING_DEFAULTS);
    const first_error = Object.entries(errors)[0];
    if (first_error) return say(`${first_error[0]}: ${first_error[1]}`, true);
    const build = build_user_keymap({ removed: [...removed_defaults], rows: user_rows }, overrides);
    if ("error" in build) return say(build.error, true);
    if (build.blocked) return say(build.messages.join(" | "), true);
    await store.write_settings(overrides);
    await store.write_user_keymap(build.user_keymap);
    say(build.messages.length > 0 ? `Saved. ${build.messages.join(" | ")}` : "Saved.");
}

async function start(): Promise<void> {
    const config = await store.read();
    const edits = edits_from_user_keymap(config.user_keymap);
    for (const keys of edits.removed) removed_defaults.add(keys);
    user_rows = edits.rows;
    render_settings(config.setting_overrides);
    render_bindings();
    if (config.stored_version > CONFIG_VERSION) {
        // Saving would rewrite newer data in the old shape under the newer stamp, so the page only shows it.
        Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")).forEach((control) => void (control.disabled = true));
        say("These settings were saved by a newer DesertBird. This version shows them and cannot save.", true);
    }
}

element("add_binding").onclick = () => {
    user_rows.push({ keys: "", command: "", args: "" });
    render_bindings();
};
element("save").onclick = () => void save().catch((error: unknown) => say(`Could not save: ${error instanceof Error ? error.message : String(error)}`, true));
start().catch((error: unknown) => say(`Could not load: ${error instanceof Error ? error.message : String(error)}`, true));
