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
