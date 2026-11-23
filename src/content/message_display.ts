// The entry of the `messageDisplayScripts` bundle: it runs in each message document, in the message pane, a message tab and a message window.

import { start_body_script } from "./body_keys.ts";
import type { BodyRuntime, BodyStorage, BodyWindow } from "./body_keys.ts";
import { ignore_refusal } from "../shared/swallow.ts";

declare const browser: { storage: { local: Pick<BodyStorage, "get">; onChanged: BodyStorage["onChanged"] }; runtime: BodyRuntime };

// Only the background can tell a message window, which runs the message mode keys, from a tab. The document starts on the message keys and switches when the background answers. A background that is still starting cannot answer, so the question repeats each second for 30 s.
start_body_script(window as unknown as BodyWindow, { get: (key) => browser.storage.local.get(key), onChanged: browser.storage.onChanged }, browser.runtime, undefined, undefined, (action) => browser.runtime.sendMessage({ type: "body.hints", action }) as Promise<number>)
    .then(async (use_tree) => {
        for (let tries = 30; tries--; await new Promise((resolve) => setTimeout(resolve, 1000))) {
            const tree = await ignore_refusal(browser.runtime.sendMessage({ type: "body.tree" }));
            if (tree) return void (tree === "window_tree" && use_tree(tree));
        }
    })
    .catch((error: unknown) => console.error("desertbird message keys:", error));
