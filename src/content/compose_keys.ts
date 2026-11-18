// The entry of the `composeScripts` bundle: it runs in the body editor of each compose window.

import { start_compose_keys } from "./compose_edit_key.ts";
import type { ComposeRuntime, ComposeStorage, ComposeWindow } from "./compose_edit_key.ts";
import { create_mode_label } from "./compose_mode_label.ts";
import type { LabelDocument } from "./compose_mode_label.ts";

declare const browser: { runtime: ComposeRuntime; storage: { local: Pick<ComposeStorage, "get">; onChanged: ComposeStorage["onChanged"] } };

start_compose_keys(window as unknown as ComposeWindow, browser.runtime, create_mode_label(document as unknown as LabelDocument, () => new CSSStyleSheet()), document.hasFocus(), { get: (key) => browser.storage.local.get(key), onChanged: browser.storage.onChanged }).catch((error: unknown) => console.error("desertbird compose keys:", error));
