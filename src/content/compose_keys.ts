// The entry of the `composeScripts` bundle: it runs in the body editor of each compose window.

import { start_compose_keys } from "./compose_edit_key.ts";
import type { ComposeRuntime, ComposeWindow } from "./compose_edit_key.ts";

declare const browser: { runtime: ComposeRuntime };

start_compose_keys(window as unknown as ComposeWindow, browser.runtime);
