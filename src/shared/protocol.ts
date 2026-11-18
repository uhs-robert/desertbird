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
/** The command line history: a list of lines, oldest first. The background writes it and the command line page reads it. */
export const CMDLINE_HISTORY_STORAGE_KEY = "desertbird_cmdline_history";
/** The lines typed after `/` and `?`, in the same shape as the command line history. */
export const SEARCH_HISTORY_STORAGE_KEY = "desertbird_search_history";
/** The quick filter the add-on last set for each mail tab, by tab id, in session storage. The API cannot read the filter back, so a restart of the background page would otherwise forget what Escape restores. */
export const APPLIED_FILTERS_STORAGE_KEY = "desertbird_applied_filters";
/** The `/` register: the last committed search, `{ text, direction }`. `n` and `N` read it, and it survives a restart of the add-on. */
export const SEARCH_REGISTER_STORAGE_KEY = "desertbird_search_register";

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

/** The keys typed so far in a half-typed sequence in a message document, counts left out. No keys means no sequence is pending. The background takes the window from the sender and shows the which-key panel of the message keys for it. */
export interface BodyPendingRequest {
    type: "body.pending";
    keys: string[];
}

/** Ctrl+E in a compose body. The background takes the window from the sender and runs `compose.edit_external` there. */
export interface ComposeEditRequest {
    type: "compose.edit";
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

/** The other thing `keys.onInvocation` carries: the keys typed so far in a half-typed sequence, counts left out. No keys means no sequence is pending. It rides the invocation event to keep the key runtime small. */
export interface KeysPending {
    command: "pending";
    keys: string[];
    windowId: number;
}

/** The third thing `keys.onInvocation` carries: visual mode started or ended in a window. Only the key runtime knows it. Insert mode is not sent: the status bar label reads the focus itself. */
export interface KeysMode {
    command: "mode";
    mode: "normal" | "visual";
    windowId: number;
}

export type KeysEvent = KeysInvocation | KeysPending | KeysMode;

export const MODE_NAMES = ["normal", "visual", "insert"] as const;
export type ModeName = (typeof MODE_NAMES)[number];

export const MODE_INDICATORS = ["always", "not_normal", "off"] as const;
export type ModeIndicator = (typeof MODE_INDICATORS)[number];

/** How the status bar label draws the mode: `classic` is colored text such as `-- NORMAL --`, `badge` is the mode name in a colored pill. */
export const MODE_LABEL_STYLES = ["classic", "badge"] as const;
export type ModeLabelStyle = (typeof MODE_LABEL_STYLES)[number];

/** The label colors of one color scheme, each as `#rrggbb`: one per mode, and the text on a badge. */
export interface ModeLabelScheme {
    normal: string;
    visual: string;
    insert: string;
    on_badge: string;
}

/** Both schemes cross, and the parent picks the one Thunderbird itself uses. The background page sees the OS scheme, which Thunderbird can differ from. */
export interface ModeLabelColors {
    dark: ModeLabelScheme;
    light: ModeLabelScheme;
}

/** What the status bar label of a window shows. `mode` is the mode the key runtime reports. The parent turns it into insert while a text field has the focus, and applies `indicator` to the result, which is why the setting travels with it. The parent maps mode and style to the text, and takes the colors from `colors`. */
export interface OverlaySetModeLabelArgs {
    windowId: number;
    mode: "normal" | "visual";
    indicator: ModeIndicator;
    style: ModeLabelStyle;
    colors: ModeLabelColors;
}

/** The pages the overlay can show. The parent maps each name to a page of the extension, so a caller never names a path or an address. `cmdline` takes the keyboard. `hud` (the which-key panel and the toasts) never does and lets clicks through. */
export const OVERLAY_SURFACES = ["cmdline", "hud"] as const;
export type OverlaySurface = (typeof OVERLAY_SURFACES)[number];

export interface OverlayMountArgs {
    windowId: number;
    surface: OverlaySurface;
    /** Lets mouse clicks through the box to the window under it. The search line sets it: its page is transparent and the keyboard drives it. */
    clickThrough?: boolean;
}

export interface OverlayUnmountArgs {
    windowId: number;
    surface: OverlaySurface;
}

/** Payload of the `overlay.onClosed` event: a surface left a window without an `unmount` call, because the front tab changed or the window closed. */
export interface OverlayClosed {
    windowId: number;
    surface: OverlaySurface;
}

/** The Experiment namespaces and their verbs. A new verb needs a reason in the commit message. */
export const EXPERIMENT_VERBS = {
    keys: { functions: ["install", "viewRows", "viewThread", "viewAllThreads", "viewScroll", "paneFocus", "appCommand", "appOpenPage"], events: ["onInvocation"] },
    overlay: { functions: ["mount", "unmount", "setModeLabel"], events: ["onClosed"] },
    hints: { functions: ["sendEnter", "pick"], events: [] },
    // Loaded on first use, so the folder pane verbs stay out of the key script, which loads at startup.
    folderpane: { functions: ["fold", "focused"], events: [] },
} as const;

/** Call and event shapes as the background sees them on `browser.keys`. */
export interface KeysApi {
    install(args: KeysInstallArgs): Promise<void>;
    onInvocation: { addListener(listener: (event: KeysEvent) => void): void; removeListener(listener: (event: KeysEvent) => void): void };
    viewRows(args: KeysViewRowsArgs): Promise<KeysViewRowsResult>;
    viewThread(args: KeysViewThreadArgs): Promise<void>;
    viewAllThreads(args: KeysViewAllThreadsArgs): Promise<void>;
    viewScroll(args: KeysViewScrollArgs): Promise<void>;
    paneFocus(args: KeysPaneFocusArgs): Promise<boolean>;
    appCommand(args: KeysAppCommandArgs): Promise<boolean>;
    appOpenPage(args: KeysAppOpenPageArgs): Promise<void>;
}

/** One visible row of the thread list. `depth` 0 is a thread root. `collapsed` is true for a thread whose replies are hidden. `flags` is the `nsMsgMessageFlags` word of the row's own message, so a collapsed thread shows its root's. The background reads the bits it needs. `id` is null when the extension cannot name the message. */
export interface ViewRow {
    index: number;
    id: number | null;
    depth: number;
    collapsed: boolean;
    unread: boolean;
    flags: number;
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

/** Folds the folder tree. The answer is false, with nothing done, unless the folder pane has the focus. `row` opens or closes the selected folder. `all` opens or closes every folder. `parent` ignores `open`: it closes the selected folder if it is open, else closes its parent and selects that. */
export interface FolderpaneFoldArgs {
    windowId: number;
    open: boolean;
    extent: "row" | "all" | "parent";
}

export interface FolderpaneFocusedArgs {
    windowId: number;
}

/** The `browser.folderpane` API, the folder pane verbs. Its script loads when the first call is made. `focused` says whether the folder pane has the focus. */
export interface FolderpaneApi {
    fold(args: FolderpaneFoldArgs): Promise<boolean>;
    focused(args: FolderpaneFocusedArgs): Promise<boolean>;
}

export type Pane = "folders" | "threads" | "message";

/** `left` and `right` name the pane beside the focused one, in the order folders, threads, message. The answer is false, with the focus left where it was, when the target pane is hidden, shows no message, or lies past the end. */
export interface KeysPaneFocusArgs {
    windowId: number;
    pane: Pane | "left" | "right";
}

/** The Thunderbird commands the Experiment runs, one name each. The answer is false when Thunderbird has the command disabled. */
export const APP_COMMANDS = ["cmd_openConversation"] as const;

export interface KeysAppCommandArgs {
    windowId: number;
    name: (typeof APP_COMMANDS)[number];
}

/** The pages the Experiment opens. The parent holds the addresses and no caller names one. */
export const APP_PAGES = ["addons", "themes", "config"] as const;

export interface KeysAppOpenPageArgs {
    windowId: number;
    page: (typeof APP_PAGES)[number];
}

export interface OverlayApi {
    /** Shows the surface in the window and gives it the focus. A second call for the same window replaces the first. */
    mount(args: OverlayMountArgs): Promise<void>;
    /** Removes the overlay and returns the focus to the thread list. Does nothing when no overlay is mounted. */
    unmount(args: OverlayUnmountArgs): Promise<void>;
    /** Puts the mode label at the start of the window's status bar, or removes it when the indicator is `off`. One window never holds two labels. */
    setModeLabel(args: OverlaySetModeLabelArgs): Promise<void>;
    onClosed: { addListener(listener: (closed: OverlayClosed) => void): void; removeListener(listener: (closed: OverlayClosed) => void): void };
}

/** Sends a trusted Enter to the focused element of the window. The key is fixed. */
export interface HintsSendEnterArgs {
    windowId: number;
}

/** The key in `storage.local` that holds the CSS declarations of a message hint label: its colors as literal values for both color schemes. The body script puts them in the inline style of each label, which no style sheet of a mail can override. */
export const HINT_STYLE_STORAGE_KEY = "desertbird_hint_style";

/** The two colors of a hint label, each as `#rrggbb`: the box and the letters. */
export interface HintLabelScheme {
    fill: string;
    text: string;
}

/** Both schemes cross, and the parent picks the one Thunderbird itself shows, as for the mode label. */
export interface HintLabelColors {
    dark: HintLabelScheme;
    light: HintLabelScheme;
}

/** Labels the targets of the front mail tab of the window. The answer is how many it labelled, and with none no hint mode starts. The typed label, Escape and the end of the labels are the parent's own, so no further call is needed. */
export interface HintsPickArgs {
    windowId: number;
    colors: HintLabelColors;
    /** What a typed label does. Absent means `activate`. */
    action?: HintAction;
}

/** `focus` focuses the target (a row is selected), `activate` clicks it, `yank` copies its address or text. */
export type HintAction = "focus" | "activate" | "yank";

export interface HintsApi {
    sendEnter(args: HintsSendEnterArgs): Promise<void>;
    pick(args: HintsPickArgs): Promise<number>;
}

/** The body script asks for the Enter that opens the link its hint pick focused. The window comes from the sender, never from this message. */
export interface BodyOpenLinkRequest {
    type: "body.open_link";
}

/** The body script asks the background to copy the address or text of the link its hint pick chose. */
export interface BodyYankRequest {
    type: "body.yank";
    text: string;
}

/** Messages from the command line page to the background, sent with `runtime.sendMessage`. The page learns its `windowId` from the address the overlay loaded it with. */
export type CmdlineRequest =
    | { type: "cmdline.hello"; windowId: number }
    | { type: "cmdline.complete"; windowId: number; text: string; caret: number }
    | { type: "cmdline.run"; windowId: number; text: string }
    | { type: "cmdline.close"; windowId: number }
    | { type: "cmdline.search_type"; windowId: number; text: string }
    | { type: "cmdline.search_commit"; windowId: number; text: string };

/** The rows are plain data. `positions` are the letters of `name` the query matched. */
export interface CmdlineCompletion {
    rows: { name: string; insert: string; description: string; args: string; positions: number[] }[];
    start: number;
    end: number;
    usage?: string;
    highlight_first?: true;
}

export type SearchDirection = "forward" | "backward";

/** `search` is set when the line opened as a search line (`/` or `?`): the page then shows that prompt and asks for no completion. `confirm` is set when the background mounted the page for a confirm prompt and not for a command line. */
export type CmdlineHello = { open: true; text: string; search?: SearchDirection } | { open: false; confirm?: ConfirmPrompt };

export type ConfirmAction = "archive" | "trash" | "move";

/** A confirm prompt as the page draws it. Every string is cleaned and cut in the background. The page shows them as plain text. */
export interface ConfirmPrompt {
    /** Made by the background for this prompt. An answer counts only with it. */
    token: string;
    action: ConfirmAction;
    count: number;
    items: { subject: string; from: string }[];
    /** How many of `count` the list leaves out. */
    more: number;
    target_folder_name?: string;
}

/** The page ignores every key for this long after it draws a prompt, and the background ignores answers for this long after the mount, so a key held from before cannot answer. */
export const CONFIRM_KEY_GRACE_MS = 300;

/** The confirm page's answer. Only `y` sends `yes`. */
export type ConfirmAnswerRequest = { type: "confirm.answer"; windowId: number; token: string; answer: "yes" | "no" };

/** `stale` means the background holds no prompt with this token (it timed out, or the background restarted), so the page closes itself. */
export type ConfirmAnswerResult = { outcome: "settled" | "ignored" | "stale" };

/** The note under the search line after a keystroke. `stale` means a newer keystroke replaced this one, so the page draws nothing. */
export type CmdlineSearchNote = { note: string; is_error: boolean } | { stale: true };

/** `ok` is false when the line is not a command, with the reason in `message`. The line stays open then. A usage line from `-h` comes back the same way. */
export type CmdlineRunResult = { ok: true } | { ok: false; message: string };

export type HudRequest = { type: "hud.state"; windowId: number };

/** The title of the panel at the root. A group in a chain starts with `+`, so no chain equals it. */
export const WHICH_KEY_ROOT_TITLE = "keys";
export const WHICH_KEY_TITLE_SEPARATOR = " \u00bb ";

/** The which-key panel as the page draws it: the chain of group names as a title (`["+Go", "+Pages"]`, or `["keys"]` at the root) and one row per key that can follow. */
export interface WhichKeyPanel {
    title: string[];
    rows: { key: string; label: string; is_group: boolean }[];
    border: "square" | "round" | "chamfer";
}

export interface ToastView {
    id: number;
    text: string;
    is_error: boolean;
}

/** Everything the hud page draws. The page keeps no state: it asks again each time the background sends `hud.changed`. */
export interface HudState {
    which_key: WhichKeyPanel | null;
    toasts: ToastView[];
    /** The command line is open in this window, so the toasts sit above its box. */
    lifted: boolean;
}

/** Sent by the background to every extension page when the state of a window's hud changed. */
export interface HudChanged {
    type: "hud.changed";
    windowId: number;
}
