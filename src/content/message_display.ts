// The entry of the `messageDisplayScripts` bundle: it runs in each message document, in the message pane, a message tab and a message window.

import { start_body_script } from "./body_keys.ts";
import type { BodyStorage, BodyWindow } from "./body_keys.ts";

declare const browser: { storage: { local: Pick<BodyStorage, "get">; onChanged: BodyStorage["onChanged"] } };

start_body_script(window as unknown as BodyWindow, { get: (key) => browser.storage.local.get(key), onChanged: browser.storage.onChanged }).catch((error: unknown) => console.error("desertbird message keys:", error));
