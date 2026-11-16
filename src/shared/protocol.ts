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

/** The Experiment namespaces and their verbs. A new verb needs a reason in the commit message. */
export const EXPERIMENT_VERBS = {
    keys: { functions: ["install"], events: ["onInvocation"] },
} as const;

/** Call and event shapes as the background sees them on `browser.keys`. */
export interface KeysApi {
    install(args: KeysInstallArgs): Promise<void>;
    onInvocation: { addListener(listener: (invocation: KeysInvocation) => void): void; removeListener(listener: (invocation: KeysInvocation) => void): void };
}
