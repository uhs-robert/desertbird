// The entry of the `messageDisplayScripts` bundle: it runs in each message document, in the message pane, a message tab and a message window.

import { start_body_script } from "./body_keys.ts";
import type { BodyRuntime, BodyStorage, BodyWindow, TreeField } from "./body_keys.ts";
import { refused_as } from "../shared/swallow.ts";

declare const browser: { storage: { local: Pick<BodyStorage, "get">; onChanged: BodyStorage["onChanged"] }; runtime: BodyRuntime };

// Only the background can tell a message window, which runs the message mode keys, from a tab. A background that cannot answer yet leaves the message keys.
refused_as(browser.runtime.sendMessage({ type: "body.tree" }), "message_tree")
    .then((tree) => start_body_script(window as unknown as BodyWindow, { get: (key) => browser.storage.local.get(key), onChanged: browser.storage.onChanged }, browser.runtime, undefined, tree as TreeField, (action) => browser.runtime.sendMessage({ type: "body.hints", action }) as Promise<number>))
    .catch((error: unknown) => console.error("desertbird message keys:", error));
