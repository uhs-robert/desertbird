// The help page. It lists every command with its keys and usage, read from the registry and the live keymap.

import { effective_keymap } from "../background/config/keymap.ts";
import { create_config_store } from "../background/config/store.ts";
import type { ConfigStorage } from "../background/config/store.ts";
import { MESSAGE_KEYMAP, registry } from "../background/commands/index.ts";
import { help_groups } from "./model.ts";
import type { HelpEntry } from "./model.ts";

declare const messenger: ConfigStorage;

const store = create_config_store(messenger);
const groups_element = document.getElementById("groups") as HTMLElement;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, class_name?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (class_name !== undefined) node.className = class_name;
    return node;
}

function keys_cell(entry: HelpEntry): HTMLTableCellElement {
    const cell = make("td");
    if (entry.keys.length === 0) cell.append(make("span", "none", "none"));
    for (const key of entry.keys) {
        cell.append(make("kbd", key.keys));
        const note = [key.where === "message" ? "in a message" : "", key.args].filter((part) => part !== "").join(", ");
        if (note !== "") cell.append(make("span", note, "args"));
        cell.append(document.createElement("br"));
    }
    return cell;
}

function command_cell(entry: HelpEntry): HTMLTableCellElement {
    const cell = make("td");
    // A command that runs in the mail window has no command line form: the keys are its only way in.
    cell.append(make("code", entry.runs_in === "background" ? entry.usage : "keys only"));
    return cell;
}

async function render(): Promise<void> {
    const config = await store.read();
    groups_element.replaceChildren(
        ...help_groups(registry, effective_keymap(config.user_keymap), MESSAGE_KEYMAP).map((group) => {
            const table = make("table");
            const head = make("tr");
            head.append(...["Keys", "Command", "What it does"].map((title) => make("th", title)));
            table.append(head);
            for (const entry of group.entries) {
                const row = make("tr");
                row.append(keys_cell(entry), command_cell(entry), make("td", entry.intent));
                table.append(row);
            }
            const section = make("section");
            section.append(make("h2", group.name), table);
            return section;
        }),
    );
}

// A saved binding changes the page without a reload.
messenger.storage.onChanged.addListener(() => void render().catch(console.error));
render().catch(console.error);
