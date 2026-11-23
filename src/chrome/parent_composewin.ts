// The parent script of the `composewin` API: the keys of every compose window. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `composewin`: `getAPI(context)` returns `get_composewin_api(context)` and `onShutdown` calls `shutdown()`.
// The ids and globals below are Thunderbird's own compose markup (`messengercompose.xhtml`, `MsgComposeCommands.js`), measured on Betterbird 153 (docs/thunderbird-behavior.md, "Compose window keys").

import { create_compose_runtime } from "./compose_runtime.ts";
import type { ComposeCommand, ComposeField, ComposeMode, ComposeRuntime, ComposeTarget } from "./compose_runtime.ts";
import { guard, load_platform, open_windows } from "./platform.ts";
import type { ExtensionContext, MainWindow } from "./platform.ts";
import type { KeyTarget } from "./runtime.ts";
import type { ComposewinInstallArgs, KeysEvent } from "../shared/protocol.ts";

const COMPOSE_WINDOW_URL = "chrome://messenger/content/messengercompose/messengercompose.xhtml";
const COMPOSE_WINDOW_TYPE = "msgcompose";
const WINDOW_LISTENER_ID = "desertbird@uhs-robert/composewin";
const LABEL_ID = "desertbird-compose-mode";
const NO_WINDOW_ID = -1;
const ADDRESS_ROWS: Partial<Record<ComposeField, string>> = { to: "addressRowTo", cc: "addressRowCc", bcc: "addressRowBcc" };

interface FocusedField {
    id?: string;
    localName?: string;
    /** An address input's autocomplete popup. The window's `#PopupAutoComplete` reads closed while this one is open (measured). */
    popupOpen?: boolean;
    popup?: { state?: string } | null;
    closest?(selector: string): unknown;
}

interface LabelNode {
    id: string;
    textContent: string;
    style: { cssText: string };
    remove(): void;
}

interface ComposeWindow extends MainWindow {
    windowRoot?: KeyTarget;
    document: MainWindow["document"] & {
        activeElement: FocusedField | null;
        getElementById(id: string): unknown;
        createElementNS(namespace: string, name: string): LabelNode;
    };
    focusMsgBody(): void;
    showAndFocusAddressRow(row_id: string): void;
    goDoCommand(command: string): void;
    setTimeout(callback: () => void, ms: number): unknown;
}

const invocation_listeners = new Set<(invocation: KeysEvent) => void>();
let runtime: ComposeRuntime | null = null;

function target_of(window: ComposeWindow): ComposeTarget {
    const focused = window.document.activeElement;
    return focused?.id === "messageEditor" ? "body" : focused?.localName === "input" && !focused.closest?.("findbar") ? "field" : "other";
}

function show_mode(window: ComposeWindow, mode: ComposeMode | null): void {
    const document = window.document;
    let label = document.getElementById(LABEL_ID) as LabelNode | null;
    if (mode === null) return label?.remove();
    const bar = document.getElementById("status-bar") as { append(node: LabelNode): void } | null;
    if (!label && bar) {
        label = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
        label.id = LABEL_ID;
        label.style.cssText = "font: bold 11px monospace; margin-inline: 1em 6px; align-self: center";
        bar.append(label);
    }
    if (label) label.textContent = `-- ${mode.toUpperCase()} --`;
}

// `run_command` waits for a timer: the save prompt of `cmd_close` and the confirm of `cmd_sendWithCheck` wait in a nested event loop, which would hold the key handler until they are answered. `window.close()` is never used: it drops a changed draft with no prompt (measured).
function ensure_runtime(context: ExtensionContext): ComposeRuntime {
    runtime ??= create_compose_runtime<ComposeWindow>({
        register_window_listener(listener) {
            load_platform().ExtensionSupport.registerWindowListener(WINDOW_LISTENER_ID, {
                chromeURLs: [COMPOSE_WINDOW_URL],
                onLoadWindow: listener.on_load_window,
                onUnloadWindow: listener.on_unload_window,
            });
        },
        unregister_window_listener: () => load_platform().ExtensionSupport.unregisterWindowListener(WINDOW_LISTENER_ID),
        open_windows: () => open_windows(COMPOSE_WINDOW_TYPE) as ComposeWindow[],
        key_target_of: (window) => window.windowRoot ?? window,
        target_of,
        field_takes_escape(window) {
            const focused = window.document.activeElement;
            return target_of(window) === "field" && (focused?.popupOpen === true || focused?.popup?.state === "open" || !!focused?.closest?.("mail-address-pill"));
        },
        focus_field(window, field) {
            const row_id = ADDRESS_ROWS[field];
            // Showing the row first reveals a hidden Cc or Bcc row.
            if (row_id) window.showAndFocusAddressRow(row_id);
            else if (field === "body") window.focusMsgBody();
            else (window.document.getElementById("msgSubject") as { focus(): void } | null)?.focus();
        },
        run_command: (window, command: ComposeCommand) => void window.setTimeout(() => window.goDoCommand(command), 0),
        show_mode,
        window_id_of: (window) => context.extension.windowManager.getWrapper(window)?.id ?? NO_WINDOW_ID,
        emit: (invocation) => {
            for (const listener of invocation_listeners) listener(invocation);
        },
    });
    return runtime;
}

export function get_composewin_api(context: ExtensionContext) {
    return {
        composewin: {
            install: guard("composewin.install", ({ composeTree, allowSend }: ComposewinInstallArgs): void => ensure_runtime(context).install(composeTree, allowSend)),
            onInvocation: new (load_platform().ExtensionCommon.EventManager)({
                context,
                name: "composewin.onInvocation",
                register: (fire) => {
                    const listener = (invocation: KeysEvent) => fire.async(invocation);
                    invocation_listeners.add(listener);
                    return () => invocation_listeners.delete(listener);
                },
            }).api(),
        },
    };
}

/** Removes the key listener and the mode label from every compose window, removes the window listener and forgets the event subscribers. */
export function shutdown(): void {
    runtime?.shutdown();
    runtime = null;
    invocation_listeners.clear();
}
