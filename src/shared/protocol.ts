// The contract between the Experiment (chrome side) and the background page. Both import this file and nothing else from each other.
// Every value crosses the Experiment boundary as structured-clone data. No verb takes a script, a URL or a free string to run.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Compiled keymap as data. Leaves name command ids; the parent looks them up in its fixed motion table and ignores unknown ids. */
export interface KeymapTree {
    version: number;
    root: JsonValue;
}

/** Only the settings the key matcher reads. */
export type MatcherSettings = Record<string, JsonValue>;

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
}

export interface ViewRowsArgs {
    first: number;
    last: number;
}

export interface ViewRow {
    index: number;
    id: number;
    depth: number;
    collapsed: boolean;
    unread: boolean;
}

export interface ViewSelectArgs {
    anchor: number;
    end: number;
}

/** The Experiment namespaces and their verbs. A new verb needs a reason in the commit message. */
export const EXPERIMENT_VERBS = {
    keys: { functions: ["install"], events: ["onInvocation"] },
    view: { functions: ["rows", "select"], events: [] },
} as const;

/** Call and event shapes as the background sees them on `browser.keys` and `browser.view`. */
export interface KeysApi {
    install(args: KeysInstallArgs): Promise<void>;
    onInvocation: { addListener(listener: (invocation: KeysInvocation) => void): void; removeListener(listener: (invocation: KeysInvocation) => void): void };
}

export interface ViewApi {
    rows(args: ViewRowsArgs): Promise<ViewRow[]>;
    select(args: ViewSelectArgs): Promise<void>;
}
