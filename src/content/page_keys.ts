// The entry of the script on DesertBird's own pages (options, help). Those pages are content tabs, which the main-window runtime does not serve, so they run the message key script themselves, on their own tree. Keys typed in the page's inputs pass through, and the keymap editor takes its bindings as typed text in inputs.

import { start_body_script } from "./body_keys.ts";
import type { BodyRuntime, BodyStorage, BodyWindow } from "./body_keys.ts";

declare const browser: { storage: { local: Pick<BodyStorage, "get">; onChanged: BodyStorage["onChanged"] }; runtime: BodyRuntime };

start_body_script(window as unknown as BodyWindow, { get: (key) => browser.storage.local.get(key), onChanged: browser.storage.onChanged }, browser.runtime, (element) => element.click(), "own_tree").catch((error: unknown) => console.error("desertbird page keys:", error));
