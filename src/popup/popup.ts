// The toolbar popup. Each button asks the background to run one command, then the popup closes. Keys: see keys.ts.

import type { PopupRunRequest } from "../shared/protocol.ts";
import { action_for_key, next_index } from "./keys.ts";

declare const messenger: { runtime: { sendMessage(message: PopupRunRequest): Promise<unknown> } };

const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-command]")];

for (const button of buttons) {
    button.addEventListener("click", () => {
        messenger.runtime.sendMessage({ type: "popup.run", command: button.dataset["command"] as PopupRunRequest["command"] }).catch(console.error).finally(() => window.close());
    });
}

// Enter, Space, Tab and Escape stay native. A pressed key cap button is clicked, so the one click path runs the command.
document.addEventListener("keydown", (event) => {
    const action = action_for_key(event);
    if (action.kind === "none") return;
    event.preventDefault();
    if (action.kind === "press") buttons.find((button) => button.dataset["command"] === action.command)?.click();
    else buttons[next_index(buttons.indexOf(document.activeElement as HTMLButtonElement), action.step, buttons.length)]?.focus();
});

window.focus();
buttons[0]?.focus();
