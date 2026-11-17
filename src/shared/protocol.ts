// The contract between the Experiment (chrome side) and the background page. Both import this file and nothing else from each other.
// Every value crosses the Experiment boundary as structured-clone data. No verb takes a script, a URL or a free string to run.

import { COMPILED_KEYMAP_VERSION } from "../../vendor/desertfox/prefix_tree.ts";

export { COMPILED_KEYMAP_VERSION };

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Compiled keymap as data. Leaves name command ids. The parent looks them up in its fixed motion table and ignores unknown ids. */
export interface KeymapTree {
    version: typeof COMPILED_KEYMAP_VERSION;
    root: JsonValue;
}

/** The storage key of the record the background keeps: the compiled keymaps and the hash of the bindings they came from. The body script reads its tree from here. */
export const KEYMAP_STORAGE_KEY = "desertbird_compiled_keymap";

/**
 * The handoff between the body script and the chrome runtime. The body script sets this attribute on the root element of the message document once it holds its keymap and listens for keys.
 * The runtime reads it through the document of the `messagepane` browser. While it is set, the runtime leaves the reading-pane keys to the body script and no longer swallows them.
 * The handoff is a marker and not an Experiment verb, so the verb table stays fixed. A mail can carry the same attribute in its own markup. That costs nothing but Thunderbird's single-key shortcuts firing in that mail.
 */
export const BODY_SCRIPT_LIVE_ATTRIBUTE = "data-desertbird-keys";

/** The storage key of the settings the user changed. The body script reads its scroll step from here. */
export const SETTINGS_STORAGE_KEY = "desertbird_settings";

/** The default of the `message_scroll_step_px` setting: one `j` or `k` in a message. */
export const MESSAGE_SCROLL_STEP_PX = 40;

/**
 * A key of the message document whose command runs in the background (`/` opens the command line). The body script sends the leaf it matched. The background takes the window and the displayed messages from the sender, never from this message, and runs the command through the router and its one validator.
 * Only a command that a message key binds is accepted.
 */
export interface BodyInvokeRequest {
    type: "body.invoke";
    command: string;
    args: Record<string, JsonValue>;
    count: number;
}

/** The background asks the body script of a tab to find text and highlight it. The pattern is literal text, never a regular expression. */
export interface BodyFindRequest {
    type: "body.find";
    pattern: string;
}

/** `found` is false when the text is not in the message. */
export interface BodyFindReply {
    found: boolean;
}

/** The key matcher reads no setting: it walks the tree alone. The object stays so a setting can join without a new verb shape. */
export type MatcherSettings = Record<string, never>;

export interface KeysInstallArgs {
    tree: KeymapTree;
    settings: MatcherSettings;
    /** Ids of the commands that take the keyboard away from the list (they open the overlay). The runtime holds plain keys after one fires, until the focus moves. */
    holdCommands: string[];
}

/** Payload of the `keys.onInvocation` event: a background leaf fired in a window. */
export interface KeysInvocation {
    command: string;
    args: Record<string, JsonValue>;
    count: number;
    windowId: number;
    /** The MailExtension ids of the messages selected when the key was pressed. The command acts on these, not on what is selected when it arrives. */
    messageIds: number[];
}

/** The pages the overlay can show. The parent maps each name to a page of the extension, so a caller never names a path or an address. */
export const OVERLAY_SURFACES = ["cmdline"] as const;
export type OverlaySurface = (typeof OVERLAY_SURFACES)[number];

export interface OverlayMountArgs {
    windowId: number;
    surface: OverlaySurface;
}

export interface OverlayUnmountArgs {
    windowId: number;
}

/** Payload of the `overlay.onClosed` event: the overlay left a window without an `unmount` call, because the front tab changed or the window closed. */
export interface OverlayClosed {
    windowId: number;
}

/** The Experiment namespaces and their verbs. A new verb needs a reason in the commit message. */
export const EXPERIMENT_VERBS = {
    keys: { functions: ["install"], events: ["onInvocation"] },
    overlay: { functions: ["mount", "unmount"], events: ["onClosed"] },
} as const;

/** Call and event shapes as the background sees them on `browser.keys`. */
export interface KeysApi {
    install(args: KeysInstallArgs): Promise<void>;
    onInvocation: { addListener(listener: (invocation: KeysInvocation) => void): void; removeListener(listener: (invocation: KeysInvocation) => void): void };
    viewRows(args: KeysViewRowsArgs): Promise<KeysViewRowsResult>;
    viewThread(args: KeysViewThreadArgs): Promise<void>;
    viewAllThreads(args: KeysViewAllThreadsArgs): Promise<void>;
    viewScroll(args: KeysViewScrollArgs): Promise<void>;
}

/** One visible row of the thread list. `depth` 0 is a thread root. `collapsed` is true for a thread whose replies are hidden. `id` is null when the extension cannot name the message. */
export interface ViewRow {
    index: number;
    id: number | null;
    depth: number;
    collapsed: boolean;
    unread: boolean;
}

export interface KeysViewRowsArgs {
    windowId: number;
    first: number;
    last: number;
}

/** `current` is the current row, or -1. `rows` holds the rows from `first` to `last` that exist, at most 500. */
export interface KeysViewRowsResult {
    current: number;
    rows: ViewRow[];
}

export interface KeysViewThreadArgs {
    windowId: number;
    row: number;
    open: boolean;
}

export interface KeysViewAllThreadsArgs {
    windowId: number;
    open: boolean;
}

export interface KeysViewScrollArgs {
    windowId: number;
    row: number;
    position: "center" | "top" | "bottom";
}

export interface OverlayApi {
    /** Shows the surface in the window and gives it the focus. A second call for the same window replaces the first. */
    mount(args: OverlayMountArgs): Promise<void>;
    /** Removes the overlay and returns the focus to the thread list. Does nothing when no overlay is mounted. */
    unmount(args: OverlayUnmountArgs): Promise<void>;
    onClosed: { addListener(listener: (closed: OverlayClosed) => void): void; removeListener(listener: (closed: OverlayClosed) => void): void };
}

/** Messages from the command line page to the background, sent with `runtime.sendMessage`. The page learns its `windowId` from the address the overlay loaded it with. */
export type CmdlineRequest =
    | { type: "cmdline.hello"; windowId: number }
    | { type: "cmdline.complete"; windowId: number; text: string; caret: number }
    | { type: "cmdline.run"; windowId: number; text: string }
    | { type: "cmdline.close"; windowId: number };

/** The rows are plain data. `positions` are the letters of `name` the query matched. */
export interface CmdlineCompletion {
    rows: { name: string; insert: string; description: string; args: string; positions: number[] }[];
    start: number;
    end: number;
    usage?: string;
}

export type CmdlineHello = { open: true; text: string } | { open: false };

/** `ok` is false when the line is not a command, with the reason in `message`. The line stays open then. A usage line from `-h` comes back the same way. */
export type CmdlineRunResult = { ok: true } | { ok: false; message: string };
