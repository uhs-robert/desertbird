# Measured Thunderbird and Betterbird behavior

This file records measurements of Thunderbird and Betterbird behavior that the design rests on. The code that produced them is in [`tools/measure/`](../tools/measure/README.md).

## Phase 0

Phase 0 answered these questions before design work:

- Where do plain keys work in the mail window, and which Thunderbird shortcuts can they cancel?
- Where does the overlay page mount?
- What does a round trip from chrome to the background cost?
- How fast does `messages.query` run on a large account?
- What do `tabs.remove` on the main tab and `mailTabs.setSelectedMessages` on a message in a collapsed thread do?
- Which API rows of the split table exist?

### Targets

| App | Version | Build | Source |
| --- | --- | --- | --- |
| Thunderbird ESR | 153.7.0esr | 20261110162734 | `https://archive.mozilla.org/pub/thunderbird/releases/153.7.0esr/linux-x86_64/en-US/thunderbird-153.7.0esr.tar.xz`, SHA-256 `dbdda16e00f09c5a61ddad607517014b9e3364bef3499a1a2f64f0a3e575bcb6` (the line in the release's `SHA256SUMS`, checked) |
| Betterbird | 153.7.0 (ESR base) | 20261110200555 | A system install, run from its own directory |

The floor is ESR 153. Both apps report `rv:153.0` and Thunderbird 153.7.0.

**Every result below came out the same on both apps.** The default thread list layout differs (a table in Betterbird, cards in Thunderbird). Timings differ by noise.

### Setup

- Linux, Wayland. A headless `labwc` display that nothing shows on a real screen. `wtype` sent real key presses through the compositor's virtual keyboard, so each key is a trusted event with a real `code`. `grim` took the screenshots. The window is 1280x720.
- A new profile, a new `HOME` and no session bus for each run, started with `-profile <dir> -no-remote`. The profile holds Local Folders and generated mbox files. No mail account exists and nothing goes over the network. The account has one identity with no server, because compose fails without one (see Notes).
- The fixture: an Inbox of 60 messages (10 threads of 4 and 20 single messages) and 50 folders of 100 messages each, 5,000 in all. 30 of every 100 bulk messages are unread. Every message has plain text and no attachment.
- A throwaway probe add-on: a MailExtension plus one Experiment, installed unsigned (`xpinstall.signatures.required` false, `extensions.experiments.enabled` true). The Experiment has typed verbs only: no eval, no free-string command and no free URL. It reports every `keydown` from its listeners, cancels keys on request, moves focus, reads the thread view, mounts overlays and runs the round trip loop.
- The probe runs its scenarios in order and asks a local server for each key press and screenshot. Each scenario waits for the effect of a key before it reads the state.
- The probe profile sets `privacy.reduceTimerPrecision` to false and measures time with `ChromeUtils.now()` in the Experiment and `performance.now()` in the background page.

### Answers to the design's open questions

| Question | Answer |
| --- | --- |
| Where does the overlay mount? | In a `browser` element that the Experiment creates in the main window document (`type=content`, `remote`, `remoteType=extension`), not in an iframe of `about:3pane`. See Overlay mount. |
| Is `messages.query` for unread fast enough across 50 folders and 5,000 messages? | No for a key press: 1.1 to 1.3 s over all folders. Yes for one folder (15 to 16 ms). A count per folder from `folders.getFolderInfo` costs 13 to 17 ms for all 50 folders. See Unread queries. |
| Does `tabs.remove` close the primary mail tab? | No. The call returns without an error and the tab stays, also when it is the only tab. |
| What does `mailTabs.setSelectedMessages` do with a message inside a collapsed thread? | It selects the message and opens the thread. The thread list grows by the thread's hidden rows. |

### Keys in the main window

The Experiment listened in three places: the top window in the capture phase (`top_capture`), the top window in the bubble phase (`top_bubble`) and the capture phase of the `about:3pane` and `about:message` windows. Each row is one real key press. "Seen" means the listener got the `keydown`.

| Focus | `top_capture` | `about3pane_capture` | `top_bubble` | Content script |
| --- | --- | --- | --- | --- |
| Thread list (`about:3pane`, target `tbody`) | seen | seen | seen | none there |
| Folder tree (`ul#folderTree`) | seen | seen | seen | none there |
| Message pane document (`about:message` body) | seen | seen | seen | none there |
| Message body (remote browser, `messagepane`) | seen, target `body` of the message document | seen | seen | seen (`messageDisplayScripts`) |
| Message in a tab, and in its own window | seen | seen in the tab, not hooked in the window | seen | seen |
| Compose body (editor document `about:blank?compose`) | seen | not hooked | seen | seen (`composeScripts`) |
| Compose To field (`input#toAddrInput`) | seen, target `input` | not hooked | seen | not hooked |
| Overlay browser with focus (see below) | seen, target `browser` | not seen | seen | not applicable |

- The top window capture listener runs first for every window type and every focus, including a remote message body. It is the one place that sees all keys.
- `top_bubble` ran after the `about:3pane` listener for every key that no listener cancelled. Thunderbird does not stop a key from reaching it. When the capture listener cancels a key, `top_bubble` and the `about:3pane` listener do not run. Whether Thunderbird has acted on the key by the time `top_bubble` runs was not measured.
- The chrome runtime must skip a key when the target is an input (the To field, the quick filter) or the overlay's `browser`. The listener sees those keys too.
- The first key press after the first focus change of a run was lost (on the folder tree in one run, on the thread list in the rerun). Every later press arrived. The cause was not investigated. It is likely a property of the test setup.

#### Cancelling Thunderbird's single-key shortcuts

17 keys were pressed in the thread list. Each ran once with no cancel and once with a top window capture listener that calls `preventDefault` and `stopPropagation` for all of them. Before each key the message `inbox-s1` was reset to unflagged and selected. The table shows what Thunderbird did, read back through the API:

| Key | Without a cancel | With the cancel |
| --- | --- | --- |
| `m` | Toggles read and unread | Nothing |
| `s` | Stars the message | Nothing |
| `j` | Marks the message as junk | Nothing |
| `f` | Selects the next message | Nothing |
| `b` | Selects the previous message | Nothing |
| `n` | Selects the next unread message | Nothing |
| `p` | Selects the previous unread message | Nothing |
| `1` | Sets the tag `$label1` | Nothing |
| `Enter` | Opens the message in a new tab and moves focus into it | Nothing |
| `0`, `r`, `R`, `x`, `/`, `*`, `#`, `Space` | Nothing seen in read, flag, junk, tags, selection, tabs, windows or focus | Nothing |

- The cancel stopped every key that did anything. The listener of `about:3pane` did not run for a cancelled key.
- `a` archives: typed text that began with `a` in the thread list moved the selected message to a new `Archives` folder. It was not measured as its own case.
- Chords were not measured.

### Keys in the message pane and in compose

- `messageDisplayScripts.register` ran the content script in the message body of the three pane, of a message tab and of a message window. Real `x` and `j` presses with the focus in the body reached it. A content script ran again for each message that loaded (44 loads in one run).
- A `pane.focus` verb for the message has to focus the `messagepane` browser. Focusing the `about:message` document puts the focus in a chrome document. There the content script gets no key and the top window listener does.
- The top window listener saw the same keys first. Cancelling `x` there kept the key from the content script too.
- `composeScripts.register` ran in the compose editor. A real `q` press with no cancel reached the content script and added one character to the body (`getComposeDetails`). With the top window cancel on `z`, the content script got nothing and the body did not change. A chrome cancel stops text entry in compose.
- A first key pressed 3 s after `compose.beginReply` returned was lost when the compose window was not yet the active window. The probe now waits until it is active.
- `tabs.create` with an extension page opened a content tab, but the focus stayed in the chrome document. A real key did not reach the page. A key in an extension page with focus was measured only through the overlay browser.

### Overlay mount

The Experiment mounted the same extension page three ways, in a red box over the thread pane. The page holds a text input and reports its keys to the background.

| Mount | Result |
| --- | --- |
| iframe in the `about:3pane` document, set through the `src` attribute, then through `location.href` | The page never loaded. The frame stayed `about:blank`, no `load` event fired in 3 s after each try and the console showed no error. Same on both apps. |
| `browser` element in the main window document (`type=content`, `remote`, `remoteType=extension`, then `extension-browser-inserted`, `Extension:InitBrowser` and `fixupAndLoadURIString`, the sequence in `ExtensionPopups.sys.mjs`) | The page loaded with the extension APIs (`messenger` defined, `runtime.sendMessage` reached the background). It reported its load 17 ms (Betterbird) and 19 ms (Thunderbird) after the mount call. Typed `abc` filled the input, and `Escape` reached it. The screenshot shows the box with the typed text. |
| The same `browser` inside a XUL `panel` opened with `openPopupAtScreen` | The page loaded and got the typed keys, 24 ms (Betterbird) and 28 ms (Thunderbird) after the call. It was `0x0` and the screenshot shows an empty panel, because the sizing code of `ExtensionPopups` was not copied. |

- The listener of the top window also saw each overlay key, with target `browser`. The chrome runtime has to ignore keys that the overlay has focus for.
- Without focus on the overlay, typed text goes to the thread list and triggers shortcuts. Typing `abc` into an unfocused overlay archived messages.
- The frame loader of a remote `browser` can fire its creation event before a listener that code adds after `appendChild`. Add the listener first.
- The look, the position and the return of focus were judged only from the screenshots.

### Round trip, chrome to background and back

The Experiment fired an event, the background page called a function in answer, and the Experiment timed the whole loop. A second loop timed a background call to an Experiment function that does nothing. 300 samples each, the first 10 dropped, the app idle:

| Loop | Betterbird (median, p95) | Thunderbird (median, p95) |
| --- | --- | --- |
| Chrome event to background and back | 0.08 ms, 0.13 ms | 0.10 ms, 0.18 ms |
| Background call to a verb and back | 0.08 ms, 0.12 ms | 0.10 ms, 0.16 ms |

The worst sample was 1.5 ms (Betterbird) and 3.9 ms (Thunderbird). The loops ran with nothing else busy. A thread list under load was not measured.

### Unread queries

50 folders of 100 messages (30 unread each) and the Inbox of 60. All numbers are medians of 14 timed runs after the first, on a warm cache.

| Call | Betterbird | Thunderbird |
| --- | --- | --- |
| `messages.query({unread: true})` over all folders, default paging, all pages collected | 1,151 ms (p95 1,243) | 1,112 ms (p95 1,298) |
| The same with `messagesPerPage: 6000` and `autoPaginationTimeout: 60000` | 729 ms | 727 ms |
| The same with `messagesPerPage: 1`, first page only | 6 ms | 6 ms |
| 50 calls of `messages.query({folderId, unread: true})` | 878 ms | 867 ms |
| One such call for one folder | 16 ms | 15 ms |
| 50 calls of `folders.getFolderInfo(folderId)`, reading `unreadMessageCount` | 13 ms | 17 ms |
| `messages.query({flagged: true})` over all folders | 193 ms | 195 ms |
| `mailTabs.getListedMessages` for a displayed folder of 100 | 51 ms | 55 ms |

- The first run of the all-folder unread query took 1.1 to 1.5 s. The counts matched: 1,500 unread bulk messages plus the Inbox's.
- The `messagesPerPage: 1` call returns the first match in folder order. It does not return "the next unread after the current message", so it cannot serve `] u` alone.
- To find the next unread across folders, a command can read the counts with `getFolderInfo` (13 to 17 ms for all 50) and then query one folder (about 16 ms). The sum was not run as one call.
- A folder with no summary file (`.msf`) lists no messages and `getFolderInfo` throws `NS_MSG_ERROR_FOLDER_SUMMARY_OUT_OF_DATE`. Opening the folder in the thread list builds the summary. Opening and parsing 100 messages took 166 ms per folder (8.3 s for 50 in Betterbird, 8.5 s in Thunderbird, including the display). A normal profile has the summaries already.

### Thread view and `setSelectedMessages`

The Inbox in grouped-by-thread view (`mailTabs.update` with `viewType: "groupedByThread"` worked), all threads collapsed: 30 rows (10 thread roots and 20 singles), 60 rows expanded.

| Call | Result |
| --- | --- |
| `mailTabs.setSelectedMessages(tabId, [child of a collapsed thread])` | The call returned `undefined`. The thread opened (30 rows became 33) and the child was selected at its row (index 5, level 2 of the thread). `getSelectedMessages` returned the child. |
| The same with the root of a collapsed thread | The root was selected and the list grew to 33 rows. |
| The same with one child in each of two collapsed threads | Both threads opened (36 rows) and both children were selected. |

The probe read the rows from the `about:3pane` view (`gDBView`), which the API does not expose. `view.rows` needs that, as the design says.

### `tabs.remove` on the primary mail tab

`tabs.remove(mailTabId)` ran twice: with a second (content) tab open, and with the mail tab as the only tab. Both times the promise resolved with no value and gave no error. `tabs.query` still listed the mail tab and the window stayed open.

### Standard API rows

The probe walked the `messenger` object for each row of the split table and checked its type. A function or event object means the row exists on the target. Rows below were present on both apps unless noted.

- `messages`: `update`, `query`, `get`, `getFull`, `getRaw`, `list`, `continueList`, `move`, `archive`, `delete`, `onUpdated`, `onNewMailReceived`, and `listTags` (deprecated since 121).
- `messages.tags.list` exists only with the permission `messagesTagsList`. It was absent without it. The manifest also needs `messagesTags`, `messagesRead`, `messagesUpdate`, `messagesMove` and `messagesDelete` for the rows that use them.
- `folders`: `query` (the folder object has `specialUse`, for example `["inbox"]`), `getFolderInfo` and `markAsRead`. `accounts.list` is present.
- `compose`: `beginNew`, `beginReply`, `beginForward`, `getComposeDetails`, `setComposeDetails`.
- `messageDisplay`: `open`, `getDisplayedMessages`.
- `mailTabs`: `update`, `query`, `setQuickFilter`, `getListedMessages`, `getSelectedMessages`, `setSelectedMessages`, `onDisplayedFolderChanged`, `onSelectedMessagesChanged`.
- `tabs`: `create`, `remove`, `update`, `query`, `get`, `onActivated`, `onRemoved`. `windows`: `create`, `remove`, `getAll`.
- `messageDisplayScripts.register` and `composeScripts.register`.
- `commands.onCommand` and `commands.update` exist only when the manifest has a `commands` key. `menus.create` needs the `menus` permission and `addressBooks.openUI` the `addressBooks` permission.
- There is no `messenger.clipboard`. `navigator.clipboard.writeText` and `readText` exist in the background page (with the permissions `clipboardWrite` and `clipboardRead`).

These calls ran for real:

- `messages.update`, `messages.query`, `messages.list` and `continueList`.
- `folders.query` and `getFolderInfo`.
- `mailTabs.update`, `setSelectedMessages`, `getSelectedMessages` and `getListedMessages`.
- `messageDisplay.open` (tab and window) and `getDisplayedMessages`.
- `compose.beginNew`, `beginReply` and `getComposeDetails`.
- `tabs.create`, `tabs.update` and `tabs.remove`, and both script registrations.

The other rows were checked for presence only.

### Notes for the build

- `mailTabs.update({displayedFolder})` threw "An unexpected error occurred" 51 times in a run, though each folder displayed. The count equals the first display of the Inbox plus each of the 50 folders. The console held `can't access property 0, this._sort[0] is undefined` from `DBViewWrapper.sys.mjs` (`primarySortType`), raised while `ext-mailTabs.js` converted the updated tab. `folder.open` needs to treat that error as "the view is still loading".
- `compose.beginReply` crashed both apps (a segmentation fault) when the Local Folders account had no identity. With an identity it worked. `compose.beginNew` worked in both cases.
- An Experiment function that throws gives the background only "An unexpected error occurred". Wrapping each verb to rethrow `ExtensionError` with the message made the cause readable.
- `performance` is not defined in an Experiment parent script. `ChromeUtils.now()` is.
- On a fresh profile, `mailnews.default_view_flags` 1 made new folder views threaded. `mailTabs.update({viewType: "groupedByThread"})` did the same through the API.

### Not measured

- Chords with modifiers, key repeat and the cost of a held key under a loaded thread list.
- Keys with focus in an extension page that is a content tab, the address book tab and the settings tab. `tabs.create` refused `about:addons` ("Loading URL not allowed").
- A second window of the main type, and tabs other than the mail tab, the message tab and the content tab.
- X11, other keyboard layouts and other platforms. Only Linux on Wayland with a US layout ran.
- A signed add-on, and the review of Experiments on addons.thunderbird.net.
- The look of the overlay panel beyond the empty box in the screenshot.

### Reproduce

```bash
tools/measure/fetch_thunderbird.sh
node tools/measure/run.mjs betterbird
node tools/measure/run.mjs thunderbird
```

See [`tools/measure/README.md`](../tools/measure/README.md). A full run takes about 7 minutes per app. Results are JSON files and screenshots in `$MEASURE_DIR/run/<app>/out/`.
