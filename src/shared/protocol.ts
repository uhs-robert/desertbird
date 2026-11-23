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

/** Set on the main window's root element while a hint pick of the `hints` Experiment shows labels. The page keys of `pages.js` listen on the same window root ahead of the pick, and they pass every key while it is set. A marker and not a call, because the two bundles share no state. */
export const HINTS_LIVE_ATTRIBUTE = "data-desertbird-hints";

/** Bumped on the main window's root element each time a hint pick ends, by a pick or a cancel, and never removed. The key runtimes of `keys.js` and `pages.js` read it to end their hold after `f`: the labels have taken and given back the keys, so a plain key is no longer a stray one. A counter and not a flag, so a runtime sees an end that happened after its own hold began. */
export const HINTS_DONE_ATTRIBUTE = "data-desertbird-hints-done";

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

/** The keys typed so far in a half-typed sequence in a message document, counts left out. No keys means no sequence is pending. The background takes the window from the sender. `tree` names the keys the panel lists: a message document leaves it out and gets the message keys, an own page sends `own` and gets the page keys, and a message window sends `window`. */
export interface BodyPendingRequest {
    type: "body.pending";
    keys: string[];
    tree?: "own" | "window";
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
    /** The tree the panel lists: a page tab names its own (`page`, `message` in a message tab, `window` in a message window). A report without one is the mail tab's. */
    source?: "page" | "message" | "window";
    /** With no keys: show the root of the tree at once (`g ?`) and not end the panel. */
    root?: true;
}

/** The third thing `keys.onInvocation` carries: visual mode, resize mode (`w r`) or manual insert mode (`i` in a page tab) started or ended in a window. Only the key runtimes know them. Insert from a focused text field is not sent: the status bar label reads the focus itself. */
export interface KeysMode {
    command: "mode";
    mode: ModeName;
    windowId: number;
}

export type KeysEvent = KeysInvocation | KeysPending | KeysMode;

export const MODE_NAMES = ["normal", "visual", "insert", "resize"] as const;
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
    resize: string;
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
    mode: ModeName;
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

/** The title the command line page sets once its input has the focus. The overlay host reads it as "ready", so the page and the host name it from here. */
export const OVERLAY_READY_TITLE = "DesertBird command line";

/** Payload of the `overlay.onClosed` event: a surface left a window without an `unmount` call, because the front tab changed or the window closed. */
export interface OverlayClosed {
    windowId: number;
    surface: OverlaySurface;
    /** Set when the host closed the surface because its page was not ready in time. Absent for the other ways out. */
    reason?: "not_ready";
}

/** The Experiment namespaces and their verbs. A new verb needs a reason in the commit message. */
export const EXPERIMENT_VERBS = {
    keys: { functions: ["install"], events: ["onInvocation"] },
    overlay: { functions: ["mount", "unmount", "setModeLabel"], events: ["onClosed"] },
    hints: { functions: ["sendEnter", "pick"], events: [] },
    pages: { functions: ["install"], events: ["onInvocation"] },
    // Loaded on first use, so the folder pane verbs stay out of the key script, which loads at startup.
    folderpane: { functions: ["fold", "focused", "viewRowCount"], events: [] },
    // Loaded on first use, so the thread list, pane focus and app verbs stay out of the key script.
    app: { functions: ["viewRows", "viewThread", "viewAllThreads", "viewScroll", "paneFocus", "paneResize", "appCommand", "appOpenPage"], events: [] },
    // Loaded on first use, like `folderpane`.
    zoom: { functions: ["get", "set"], events: [] },
    // Loaded at startup by the first install, since it takes the keys of the compose windows.
    composewin: { functions: ["install"], events: ["onInvocation"] },
} as const;

/** Call and event shapes as the background sees them on `browser.keys`. */
export interface KeysApi {
    install(args: KeysInstallArgs): Promise<void>;
    onInvocation: { addListener(listener: (event: KeysEvent) => void): void; removeListener(listener: (event: KeysEvent) => void): void };
}

/** Call shapes as the background sees them on `browser.app`: the thread list, pane focus and app verbs. Its script loads when the first call is made. */
export interface AppApi {
    viewRows(args: AppViewRowsArgs): Promise<AppViewRowsResult>;
    viewThread(args: AppViewThreadArgs): Promise<void>;
    viewAllThreads(args: AppViewAllThreadsArgs): Promise<void>;
    viewScroll(args: AppViewScrollArgs): Promise<void>;
    paneFocus(args: AppPaneFocusArgs): Promise<boolean>;
    paneResize(args: AppPaneResizeArgs): Promise<boolean>;
    appCommand(args: AppCommandArgs): Promise<boolean>;
    appOpenPage(args: AppOpenPageArgs): Promise<void>;
}

/** Installs the page keymap: the keys of the tabs that are not the mail tab. */
export interface PagesInstallArgs {
    pageTree: KeymapTree;
    /** The keys of a message tab with the focus outside the body. The body script takes the keys while the body has the focus. */
    messageTree: KeymapTree;
    /** The keys of a message window with the focus outside the body, cut from the message window tree as `messageTree` is cut from the message tree. */
    windowTree: KeymapTree;
    /** The keys that run while a text field has the focus (in the mail tab too) or manual insert mode is on. */
    typingTree: KeymapTree;
    /** Ids of the commands that open the overlay. The runtime holds plain keys after one fires, until the focus moves. */
    holdCommands: string[];
}

/** Call and event shapes as the background sees them on `browser.pages`. Its events carry the same payloads as `keys.onInvocation`. */
export interface PagesApi {
    install(args: PagesInstallArgs): Promise<void>;
    onInvocation: KeysApi["onInvocation"];
}

/** Installs the keys of the compose windows: the tree of normal mode, and whether the send key may send. */
export interface ComposewinInstallArgs {
    composeTree: KeymapTree;
    /** The `compose_send` setting. While it is false the send key runs nothing. */
    allowSend: boolean;
    /** The look of the mode label in the status bar: the `mode_indicator_style` setting and the colors of the `theme` setting, as for the label of the main window. */
    labelStyle: ModeLabelStyle;
    labelColors: ModeLabelColors;
}

/** Call and event shapes as the background sees them on `browser.composewin`. Its event carries only invocations: a compose window has no hud, so no pending keys and no mode go out. */
export interface ComposewinApi {
    install(args: ComposewinInstallArgs): Promise<void>;
    onInvocation: KeysApi["onInvocation"];
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

export interface AppViewRowsArgs {
    windowId: number;
    first: number;
    last: number;
}

/** `current` is the current row, or -1. `rows` holds the rows from `first` to `last` that exist, at most 500. */
export interface AppViewRowsResult {
    current: number;
    rows: ViewRow[];
}

export interface AppViewThreadArgs {
    windowId: number;
    row: number;
    open: boolean;
}

export interface AppViewAllThreadsArgs {
    windowId: number;
    open: boolean;
}

export interface AppViewScrollArgs {
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

export interface FolderpaneViewRowCountArgs {
    windowId: number;
}

/** The `browser.folderpane` API, the folder pane verbs. Its script loads when the first call is made. `focused` says whether the folder pane has the focus. `viewRowCount` answers how many rows the message list shows now (a closed thread counts its root only), which `app.viewRows` does not tell. */
export interface FolderpaneApi {
    fold(args: FolderpaneFoldArgs): Promise<boolean>;
    focused(args: FolderpaneFocusedArgs): Promise<boolean>;
    viewRowCount(args: FolderpaneViewRowCountArgs): Promise<number>;
}

export interface ZoomGetArgs {
    windowId: number;
}

/** `level` is 1 for 100%, from 0.3 to 5. */
export interface ZoomSetArgs {
    windowId: number;
    level: number;
}

/** The `browser.zoom` API: the zoom of the message pane or the page a main or message window shows. Its script loads when the first call is made. `get` answers null and `set` answers false when the front tab has nothing to zoom. */
export interface ZoomApi {
    get(args: ZoomGetArgs): Promise<number | null>;
    set(args: ZoomSetArgs): Promise<boolean>;
}

export type Pane = "folders" | "threads" | "message";

/** `left` and `right` name the pane beside the focused one, in the order folders, threads, message. The answer is false, with the focus left where it was, when the target pane is hidden, shows no message, or lies past the end. */
export interface AppPaneFocusArgs {
    windowId: number;
    pane: Pane | "left" | "right";
}

/** The way a pane border moves: the border of the focused pane goes left, right, up or down, or both splitters go back to their default sizes. */
export const PANE_RESIZE_DIRECTIONS = ["left", "right", "up", "down", "reset"] as const;
export type PaneResizeDirection = (typeof PANE_RESIZE_DIRECTIONS)[number];

/** `steps` is how many steps of 24 CSS pixels the border moves. The answer is false, changing nothing, when the focused pane has no border on that axis, is collapsed, or the folder pane has no splitter in this view. A move that stops at the size limit answers true. */
export interface AppPaneResizeArgs {
    windowId: number;
    direction: PaneResizeDirection;
    steps: number;
}

/** The Thunderbird commands the Experiment runs, one name each. The answer is false when Thunderbird has the command disabled. For the four step commands it is also false when the view has no message to step to, because Thunderbird stays put (next, previous) or wraps (next unread) there and does not say so. */
export const APP_COMMANDS = ["cmd_openConversation", "cmd_nextMsg", "cmd_previousMsg", "cmd_nextUnreadMsg", "cmd_previousUnreadMsg"] as const;

export type AppCommandName = (typeof APP_COMMANDS)[number];

export interface AppCommandArgs {
    windowId: number;
    name: AppCommandName;
}

/** The pages the Experiment opens. The parent holds the addresses and no caller names one. */
export const APP_PAGES = ["addons", "themes", "config"] as const;

export interface AppOpenPageArgs {
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

/** Labels the targets of the front tab of the window: the mail tab, or the window and the readable page of any other tab. The answer is how many it labelled, and with none no hint mode starts. The typed label, Escape and the end of the labels are the parent's own, so no further call is needed. */
export interface HintsPickArgs {
    windowId: number;
    /** With `place`: the tab of the body that asked. A pick finds another tab in front (the user switched while the request was on its way) and answers 0. */
    tabId?: number;
    colors: HintLabelColors;
    /** What a typed label does. Absent means `activate`. */
    action?: HintAction;
    /** `message`: label the header and body of the message that holds the focus, in the mail tab's reading pane, a message tab or a message window. The answer is then 0 when the focus is no longer in a message body, and -1 when the parent cannot read the body, so the body script labels the body itself. */
    place?: "message";
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

/** The body script asks the background for one label set over the message header and body. The background checks the action against the command's params, which fill in the default, and takes the window from the sender. The answer is the count of `hints.pick`, or -1 when the body script must label the body itself. */
export interface BodyHintsRequest {
    type: "body.hints";
    /** Absent means the command's default, `activate`. */
    action?: HintAction | undefined;
}

/** The body script asks which tree of the keymap record its document runs, before it takes a key. The answer is a field name of the record: `window_tree` in a message window, else `message_tree`. Only the background can tell a message window from a tab. */
export interface BodyTreeRequest {
    type: "body.tree";
}

export type BodyTreeField = "message_tree" | "window_tree";

/** The body script asks the background to copy the address or text of the link its hint pick chose. */
export interface BodyYankRequest {
    type: "body.yank";
    text: string;
}

/** Messages from the command line page to the background, sent with `runtime.sendMessage`. The page learns its `windowId` from the address the overlay loaded it with. */
export type CmdlineRequest =
    | { type: "cmdline.hello"; windowId: number }
    | { type: "cmdline.widgets"; windowId: number }
    | { type: "cmdline.complete"; windowId: number; text: string; caret: number }
    | { type: "cmdline.run"; windowId: number; text: string }
    | { type: "cmdline.close"; windowId: number }
    | { type: "cmdline.search_type"; windowId: number; text: string }
    | { type: "cmdline.search_commit"; windowId: number; text: string };

/** One row of the list, as plain data. `positions` are the letters of `name` the query matched. `usage` is what the note shows while the row is selected, and `keys` fills the last column. Both are absent when the row has nothing to say. */
export interface CmdlineRow {
    name: string;
    insert: string;
    description: string;
    args: string;
    positions: number[];
    usage?: string;
    keys?: string;
}

export interface CmdlineCompletion {
    rows: CmdlineRow[];
    start: number;
    end: number;
    usage?: string;
    highlight_first?: true;
}

export type SearchDirection = "forward" | "backward";

/** One status widget at the right end of the command line. `kind` names the widget for its style. */
export interface StatusWidget {
    kind: "folder" | "position";
    text: string;
}

/** The answer to `cmdline.widgets`: the widgets drawn once, as the line opens. Empty for a search line or a line that is closed. */
export interface CmdlineWidgets {
    widgets: StatusWidget[];
}

/** `prompt` is the `cmdline_prompt` setting. `search` is set when the line opened as a search line (`/` or `?`): the page then shows that prompt and asks for no completion. `confirm` is set when the background mounted the page for a confirm prompt and not for a command line. */
export type CmdlineHello = { open: true; text: string; prompt: string; search?: SearchDirection } | { open: false; confirm?: ConfirmPrompt };

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

/** The commands the toolbar popup may run, in the order its entries show. */
export const POPUP_COMMANDS = ["options.open", "help.open"] as const;
export type PopupCommand = (typeof POPUP_COMMANDS)[number];

/** A click on an entry of the toolbar popup. The background runs the command in the last focused main window, since the popup has no tab to take a window from. */
export interface PopupRunRequest {
    type: "popup.run";
    command: PopupCommand;
}
