// The toolbar popup. Each button asks the background to run one command, then the popup closes.

import type { PopupRunRequest } from "../shared/protocol.ts";

declare const messenger: { runtime: { sendMessage(message: PopupRunRequest): Promise<unknown> } };

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-command]")) {
    button.addEventListener("click", () => {
        messenger.runtime.sendMessage({ type: "popup.run", command: button.dataset["command"] as PopupRunRequest["command"] }).catch(console.error).finally(() => window.close());
    });
}
