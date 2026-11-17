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

**Every result below came out the same on both apps.** The default thread list layout differs (a table in Betterbird, cards in Thunderbird). Timings differ by noise. Each scenario ran once per app in a fresh profile, so "the same" means the same in one run each. The key tests press each key 5 times.

### Setup

- Linux, Wayland. A headless `labwc` display that nothing shows on a real screen. `wtype` sent real key presses through the compositor's virtual keyboard, so each key is a trusted event with a real `code`. `grim` took the screenshots. The window is 1280x720.
- A new profile, a new `HOME` and no session bus for each scenario, started with `-profile <dir> -no-remote`. The profile holds Local Folders and generated mbox files. No mail server account exists and nothing goes over the network. The profile has one identity with no server, because compose fails without one (see Notes).
- The fixture: an Inbox of 60 messages (10 threads of 4 and 20 single messages, 33 unread) and 50 folders of 100 messages each, 5,000 in all, with 30 unread in each. One extra folder of one HTML message (`Html`) serves the message pane test. The query test on a large folder adds a folder of 10,000 messages to its own profile only. Every message has no attachment.
- A throwaway probe add-on: a MailExtension plus one Experiment, installed unsigned (`xpinstall.signatures.required` false, `extensions.experiments.enabled` true). The Experiment has typed verbs only: no eval, no free-string command and no free URL. It reports every `keydown` from its listeners, cancels keys on request, moves focus, reads the thread view and the process of the message pane, mounts overlays and runs the round trip loop.
- Each scenario runs as its own job in a fresh profile, so no state leaks from one scenario into the next. The probe asks a local server for each key press and screenshot. After each focus change it presses a bare Shift until a listener sees it (the settle step), so no measured key is the first press after the change.
- The probe profile sets `privacy.reduceTimerPrecision` to false and measures time with `ChromeUtils.now()` in the Experiment and `performance.now()` in the background page.

### Answers to the design's open questions

| Question | Answer |
| --- | --- |
| Where does the overlay mount? | In a remote `browser` element that the Experiment creates in a chrome document, in the main window or inside `about:3pane`. An extension-page iframe in `about:3pane` did not load. See Overlay mount. |
| Is `messages.query` for unread fast enough across 50 folders and 5,000 messages? | Not for a key press. See Unread queries for the numbers on 5,000 messages in 50 folders and on one folder of 10,000. |
| Does `tabs.remove` close the primary mail tab? | No. The call returns without an error and the tab stays, also when it is the only tab. |
| What does `mailTabs.setSelectedMessages` do with a message inside a collapsed thread? | It selects the message and opens the thread. The thread list grows by the thread's hidden rows. |

### Keys

The Experiment listened in three places: the top window in the capture phase (`top_capture`), the top window in the bubble phase (`top_bubble`) and the capture phase of the `about:3pane` and `about:message` windows. A scenario focuses a context, runs the settle step, resets the message, presses a key for real, then reads the message back through the API. "Acted" means the API showed a change in read state, flag, junk, tags, folder, selection, tab count or window count.

#### Where each listener sees a key

| Focus | `top_capture` | `about3pane_capture` | `top_bubble` | Content script |
| --- | --- | --- | --- | --- |
| Thread list (`about:3pane`, target `tbody`) | seen | seen | seen | none there |
| Folder tree (`ul#folderTree`) | seen | seen | seen | none there |
| Message pane document (`about:message` body) | seen | seen | seen | none there |
| Message body (`messagepane`, in the parent process, see Message pane process) | seen | seen | seen | seen (`messageDisplayScripts`) |
| Message in a tab | seen | not seen, the tab's own `about:message` listener sees it | seen | seen |
| Message in its own window | seen | not hooked | seen | seen |
| Compose body (editor document `about:blank?compose`) | seen | not hooked | seen | seen (`composeScripts`) |
| Compose To field (`input#toAddrInput`) | seen, target `input` | not hooked | seen | not hooked |
| Overlay browser with focus (see Overlay mount) | seen, target `browser` | not seen | seen | not applicable |

- The order of the listeners in a press that no listener cancelled was `top_capture`, `about3pane_capture` (when hooked), `aboutmessage_capture` (when the focus was in the message pane), `top_bubble`. The order comes from the Experiment's own clock stamp on each event. In the compose window it was `top_capture`, then `top_bubble`.
- The top window capture listener runs first for every window type and every focus. It is the one place that sees all keys.
- The chrome runtime has to skip a key when the target is an input (the To field, the quick filter) or the overlay's `browser`. The listener sees those keys too.
- Whether Thunderbird has acted on a key by the time `top_bubble` runs was not measured.

#### Cancelling Thunderbird's single-key shortcuts

Each key was pressed 5 times with no cancel and 5 times with a top window capture listener that calls `preventDefault` and `stopPropagation` for that key. Cells are "acted out of 5". All 5 cancelled presses were seen by `top_capture` and flagged as cancelled. On the thread list, a cancelled press never reached the `about:3pane` listener or `top_bubble`.

| Key | Thread list, no cancel | Message pane | Message tab | Message window | Cancelled, in every context |
| --- | --- | --- | --- | --- | --- |
| `m` | 5 of 5: toggles read | 5 of 5 | 5 of 5 | 5 of 5 | 0 of 5 |
| `s` | 5 of 5: stars | 5 of 5 | 5 of 5 | 5 of 5 | 0 of 5 |
| `j` | 5 of 5: marks junk | 5 of 5 | 5 of 5 | 5 of 5 | 0 of 5 |
| `a` | 5 of 5: archives to `Archives/2025` | 5 of 5 | 5 of 5 | 5 of 5 | 0 of 5 |
| `r`, `R` | 0 of 5 | 0 of 5 | 0 of 5 | 0 of 5 | 0 of 5 |

The thread list has these keys as well. Each ran 5 presses, with no cancel and with a cancel:

| Key | No cancel | Cancelled |
| --- | --- | --- |
| `f`, `b`, `n`, `p` | 5 of 5: select the next, previous, next unread and previous unread message | 0 of 5 |
| `1` | 5 of 5: sets the tag `$label1` | 0 of 5 |
| `Enter` | 5 of 5: opens the message in a new tab | 0 of 5 |
| `0`, `x`, `/`, `*`, `#`, `Space` | 0 of 5 | 0 of 5 |

- `a` archived without a dialog, and the first archive created `Archives` and `Archives/2025` in Local Folders.
- `r` and `R` did nothing in any context. Reply is not a plain-key shortcut in the default setup, so a plain `r` is free for DesertBird.
- A chrome cancel stopped every key that did anything, in all four contexts, and a cancelled key reached no content script.

#### Cancelling Thunderbird's chords

Each chord was pressed 5 times with no cancel and 5 times with a cancel. The cancel is a top window capture listener that calls `preventDefault` and `stopPropagation` for that chord (`ctrlKey` set and the same `key`). `wtype` sent a real Control press around the letter. Each context ran as its own job in a fresh profile, on both apps. Before each press the probe closed extra tabs and windows and reset and selected the message. It then refocused the context, set the clipboard to a marker and ran the settle step. "Acted" means a change in message state (read, flag, junk, tags, folder) or selection. A change in the tab list, window list, active window, focus, quick filter text or clipboard also counts. In the message pane, the probe selected the whole body text before each press, so `<C-c>` and `<C-x>` had a selection to act on. In the quick filter box, it set the text to `hello world` and selected all of it. Cells are "acted out of 5". The command name is the XUL `<key>` that fired its `command` event.

| Chord | Thread list, no cancel | Message pane | Quick filter text box | Cancelled, in every context |
| --- | --- | --- | --- | --- |
| `<C-o>` | 5 of 5: opens the message in a new tab (`key_openMessage`) | 5 of 5, the same | 5 of 5, the same | 0 of 5 |
| `<C-i>` | 0 of 5 | 0 of 5 | 0 of 5 | 0 of 5 |
| `<C-l>` | 5 of 5: forwards, a compose window opens and takes focus (`key_forward`) | 5 of 5, the same | 5 of 5, the same | 0 of 5 |
| `<C-j>` | 5 of 5: opens the Saved Files tab (`key_savedFiles`) | 5 of 5, the same | 5 of 5, the same | 0 of 5 |
| `<C-k>` | 5 of 5: moves focus to the global search bar (`key_quickSearchFocus`) | 5 of 5, the same | 5 of 5, the same | 0 of 5 |
| `<C-x>` | 0 of 5 | 0 of 5 | 5 of 5: cuts the text to the clipboard | 0 of 5 |
| `<C-c>` | 0 of 5 | 5 of 5: copies the selected body text | 5 of 5: copies the text | 0 of 5 |
| `<C-h>` | 0 of 5 | 0 of 5 | 0 of 5 | 0 of 5 |

- `top_capture` saw all 240 presses per app (8 chords, 3 contexts, 2 modes, 5 presses). No press arrived with `defaultPrevented` already set, so Thunderbird handles none of these chords before the top window capture phase.
- With no cancel, `about3pane_capture` and `top_bubble` saw every press. With the cancel, neither saw any press, in every context.
- No chord is reserved. The four menu key bindings (`<C-o>`, `<C-l>`, `<C-j>`, `<C-k>`) fire from the main window's key set and a capture cancel stops all of them.
- The menu chords also fire when the quick filter text box has focus. The text box itself handles only `<C-x>` and `<C-c>`. `<C-h>` does not delete a character there.
- A cancel in the text box also stops cut and copy. The chrome runtime has to skip chords when the target is a text input, as it does for plain keys.
- `<C-o>` opens a tab, not a window, under the default "open messages in" setting.
- `<C-i>` maps to `calendar-new-event-key` in the main window's key set, but nothing opened in the mail tab.
- Every result came out the same on Thunderbird 153.7.0esr and Betterbird 153.7.0. The screenshots of the first press of each chord with no cancel, in the thread list and the message pane, show the same effects.

### Message pane process

The message body browser (`messagepane`) and the `about:message` browser were `isRemoteBrowser` false, with a `contentDocument` that the parent process could read. This held for a plain text message and for an HTML message, on both apps. The overlay browser, which the probe made `remote` with `remoteType` `extension`, was remote and the parent could not read its document.

This contradicts the design's statement that the message body "runs in a content process the chrome listener cannot see". For local mail, a chrome listener in the parent process sees keys in the message body (`top_capture` with target `body` in the table above). Open point for the design: does the message pane need a content script for keys at all, or only for hints, find and anything that reads the body? Content that is not local mail (a feed article, a web page, remote content) was not measured and can differ.

### Keys in compose

- `composeScripts.register` ran in the compose editor. A real `q` press with no cancel reached the content script and added one character to the body (`getComposeDetails`). With the top window cancel on `z`, the content script got nothing and the body did not change. A chrome cancel stops text entry in compose.
- The compose window must be the active window before a key press counts. The probe waits for that and runs the settle step.
- `tabs.create` called while the compose window was focused opened the tab in the main window (`windowId` of the `normal` window), not in the compose window. The compose window kept the focus.
- `tabs.create` with an extension page opened a content tab, but the focus stayed in the chrome document. A real key did not reach the page.

### Overlay mount

The Experiment mounted the same extension page four ways, in a red box. The page holds a text input and reports its keys to the background. Each mount ran with the settle step before the typed `abc`.

| Mount | Result |
| --- | --- |
| iframe in the `about:3pane` document, set through the `src` attribute, then through `location.href` | The page did not load. The frame stayed `about:blank`, no `load` event fired in 3 s after each try and the console showed no error. A second manifest with `web_accessible_resources` for the page gave the same result. Same on both apps. |
| `browser` element in the `about:3pane` document (`type=content`, `remote`, `remoteType=extension`) | The page loaded and reported its load 20 ms (Betterbird) and 16 ms (Thunderbird) after the mount call. `abc` and `Escape` reached it. |
| The same `browser` in the main window document | The page loaded with the extension APIs (`messenger` defined, `runtime.sendMessage` reached the background), 16 ms (Betterbird) and 14 ms (Thunderbird) after the call. `abc` and `Escape` reached it. |
| The same `browser` inside a XUL `panel` opened with `openPopupAtScreen` | The page loaded and got the keys, 16 ms (Betterbird) and 28 ms (Thunderbird) after the call. It was `0x0` and the screenshot shows an empty panel, because the sizing code of `ExtensionPopups` was not copied. |

- The iframe failure is most likely a process mismatch. The `browser` mounts are remote (`isRemoteBrowser` true, `remoteType` `extension`) and loaded the same URL with no `web_accessible_resources`. An extension page runs in the extension process, and an iframe in a chrome document of the parent process cannot change process. The `web_accessible_resources` run rules out a missing web-accessible entry. Both iframe attempts used a system principal. A different frame type, such as `type=content` on the iframe, was not tried.
- The listener of the top window also saw each overlay key, with target `browser`. The chrome runtime has to ignore keys that the overlay has focus for.
- Without focus on the overlay, typed text goes to the thread list and triggers shortcuts. The probe sets the focus first.
- The frame loader of a remote `browser` can fire its creation event before a listener that code adds after `appendChild`. Add the listener first.
- The look, the position and the return of focus were judged only from the screenshots.

### Time from a key to the background page

Two measurements, both with the clock stamped in the Experiment and in the background page.

- **Event path only (lower bound).** The Experiment fires an event, the background answers with a function call and the Experiment times the loop. No key is involved, and the app was idle. 300 samples, the first 10 dropped. It is the cost of the event path alone, a lower bound for key to handler.
- **Real key presses.** The background stamps `performance.now()` when `onKey` arrives. The Experiment stamps `ChromeUtils.now()` in its listener. The ping loop maps one clock onto the other (the offset spread was 0.02 ms). The time from `wtype`'s send to the listener is not included.

| Measure | Betterbird | Thunderbird |
| --- | --- | --- |
| Event path, chrome event to background and back (median, p95, max) | 0.09 ms, 0.15 ms, 1.43 ms | 0.09 ms, 0.18 ms, 1.28 ms |
| Background call to a verb and back (median, p95, max) | 0.10 ms, 0.16 ms, 1.64 ms | 0.10 ms, 0.16 ms, 0.24 ms |
| Key to the background, idle, 40 presses (median, p95, max) | 0.32 ms, 0.46 ms, 0.99 ms | 0.33 ms, 0.50 ms, 0.56 ms |
| Key to the background, 8 bursts of 5 keys while an all-folder unread query runs (median, p95, max) | 0.12 ms, 0.30 ms, 0.40 ms | 0.13 ms, 0.54 ms, 0.74 ms |

An idle key costs more than the ping because the event wakes an idle page (not tested). The burst rows are lower because the page is already awake (not tested). The timer starts inside the keydown listener, so neither the idle row nor the burst row includes the time a key waits in the parent queue, because both use the same listener timestamp (`tools/measure/probe/experiment/parent.js:69`). The added cost is under 1 ms in every sample. These numbers cover the path from the Experiment to the background. They do not cover the time Thunderbird spends on the key itself.

### Unread queries

All numbers are medians (p95 and max beside them) of 30 timed runs after a first run, on a warm cache, in a fresh profile per scenario. With 30 samples, p95 is the 29th value. The first run of each is listed because it is what a user sees first.

**50 folders of 100 messages (5,000) and the Inbox of 60.** Cells are median, p95, max, with the first run in brackets.

| Call | Betterbird | Thunderbird |
| --- | --- | --- |
| `messages.query({unread: true})` over all folders, default paging, all pages collected | 1111, 1211, 1237 ms (1192) | 1108, 1223, 1303 ms (1127) |
| The same with `messagesPerPage: 6000` and `autoPaginationTimeout: 60000` | 722, 791, 794 ms (803) | 718, 781, 791 ms (711) |
| The same with `messagesPerPage: 1`, first page only | 9.0, 18, 22 ms (3.7) | 9.7, 44, 104 ms (4.0) |
| 50 calls of `messages.query({folderId, unread: true})` | 966, 1340, 1520 ms (884) | 969, 1273, 1297 ms (777) |
| One such call for one folder of 100 | 16, 20, 26 ms (16) | 15, 18, 18 ms (15) |
| 50 calls of `folders.getFolderInfo(folderId)`, reading `unreadMessageCount` | 21, 85, 255 ms (31) | 21, 158, 180 ms (9.5) |
| `messages.query({flagged: true})` over all folders | 191, 210, 217 ms (200) | 190, 223, 230 ms (190) |
| `mailTabs.getListedMessages` for a displayed folder of 100 (n=10) | 65, 75 ms (max of 10) | 63, 68 ms (max of 10) |

**One folder of 10,000 messages (3,000 unread).** The folder was open in the thread list. Same cell format.

| Call | Betterbird | Thunderbird |
| --- | --- | --- |
| `messages.query({folderId, unread: true})`, default paging, 3,000 results | 2153, 2236, 2460 ms (2310) | 2156, 2438, 2576 ms (2135) |
| The same with `messagesPerPage: 12000` and `autoPaginationTimeout: 60000` | 1407, 1624, 1635 ms (1570) | 1396, 1432, 1433 ms (1385) |
| The same with `messagesPerPage: 1`, first page only | 11, 196, 223 ms (21) | 11, 22, 23 ms (12) |
| `folders.getFolderInfo(folderId)`, reading `unreadMessageCount` | 0.7, 5.2, 6.6 ms (4.6) | 0.6, 9.2, 11 ms (2.4) |
| `mailTabs.getListedMessages`, 10,000 results collected | 6902, 7194, 7286 ms (7291) | 6900, 7129, 7134 ms (6895) |
| `messages.list(folderId)`, 10,000 results collected | 6844, 7021, 7313 ms (7182) | 6822, 7193, 7241 ms (6703) |

- First open of the 10,000-message folder, with parsing and until `messages.list` returned all of it: 7.7 s (Betterbird), 7.3 s (Thunderbird).

- The unread total matched the live count: 1,500 unread bulk messages plus the Inbox's live unread count (33 in the fresh profile), 1,533 in all.
- The costs grow with the folder size. For one folder, 100 to 10,000 messages (100 times more) took the unread query from about 16 ms to about 2,150 ms (135 times) and `getListedMessages` from about 65 ms to about 6,900 ms (106 times). `step.unread {scope: folder}` through either call misses a per-key budget on a large folder. Only `getFolderInfo` stays cheap (about 0.7 ms at 10,000 messages), and it returns counts, not message ids.
- The all-folder query takes about 1.1 s warm and 1.2 s on the first run, so cold and warm agree. It is not fast enough per key press.
- The `messagesPerPage: 1` call returns the first match in folder order. It does not return "the next unread after the current message", so it cannot serve `] u` alone.
- To find the next unread across folders, a command can read the counts with `getFolderInfo` (21 ms median for all 50) and then query one folder. The sum was not run as one call.
- A folder with no summary file (`.msf`) lists no messages and `getFolderInfo` throws `NS_MSG_ERROR_FOLDER_SUMMARY_OUT_OF_DATE`. Opening the folder in the thread list builds the summary. A normal profile has the summaries already.

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

### Quick filter rows

`mailTabs.setQuickFilter` was applied to the Inbox in the ungrouped view and the visible row count was read from the view. Each filter was then cleared with `{}`, which restored 60 rows.

| Row | Filter | Rows shown | Expected |
| --- | --- | --- | --- |
| `filter.set` unread | `{unread: true}` | 33 | 33 (from `messages.query`) |
| `filter.set` starred | `{flagged: true}` | 3 | 3 |
| `filter.set` tag | `{tags: {mode: "any", tags: {$label1: true}}}` | 3 | 3 (three messages tagged) |
| `filter.set` attachment | `{attachment: true}` | 0 | 0 (the Inbox fixture has no attachments, so this row cannot fail) |
| `search.threads` text | `{text: {text: "Single 1", subject: true}}` | 11 | 11 (from a subject query) |

The end-to-end run repeated the filters on Thunderbird 153.7.0 and Betterbird 153.7.0 in a `Views` folder of 6 messages, one of them with a real attachment. `{attachment: true}` showed 1 of 6 rows on both apps. Unread showed 3, starred 2, the `$label1` tag 2 and the text `Views 3` 1, and `{}` restored 6. No build older than 153.7.0 ran, so the Betterbird 153.2.0 floor for `filter.set` and `search.threads` is still an assumption.

### Native host manifests

A manifest for a stdio host and a script that records its start went into six folders under the job's `HOME`. Only `~/.mozilla/native-messaging-hosts/` was read, by both apps. `~/.thunderbird/`, `~/.betterbird/` and `~/.config/{mozilla,thunderbird,betterbird}/` under `native-messaging-hosts` gave "No such native application". The script ran for the `~/.mozilla` manifest. Both `libxul` files also contain the system path `/usr/lib/mozilla`. The system folders cannot be written, so they were not tested.

### Standard API rows

The probe walked the `messenger` object for each row of the split table and checked its type. A function or event object means the row exists on the target. Both apps gave the same result. Two manifests ran: the full one, and a minimal one without `messagesTagsList`, `menus`, `addressBooks` and the `commands` key.

- Present in both manifests: `messages` (`update`, `query`, `get`, `getFull`, `getRaw`, `list`, `continueList`, `move`, `archive`, `delete`, `onUpdated`, `onNewMailReceived`, `listTags`), `folders` (`query`, `getFolderInfo`, `markAsRead`), `accounts.list`, `compose` (`beginNew`, `beginReply`, `beginForward`, `getComposeDetails`, `setComposeDetails`), `messageDisplay` (`open`, `getDisplayedMessages`), `mailTabs` (`update`, `query`, `setQuickFilter`, `getListedMessages`, `getSelectedMessages`, `setSelectedMessages`, `onDisplayedFolderChanged`, `onSelectedMessagesChanged`), `tabs` and `windows`, both script registrations, and `spaces`. The folder object has `specialUse`, for example `["inbox"]`.
- Present only with the full manifest: `messages.tags.list` (permission `messagesTagsList`), `commands.onCommand` and `commands.update` (the `commands` key), `menus.create` (permission `menus`) and `addressBooks.openUI` (permission `addressBooks`). All four were absent in the minimal manifest.
- There is no `messenger.clipboard` in either. `navigator.clipboard.writeText` and `readText` exist in the background page.

These calls ran for real:

- `messages.update`, `messages.query`, `messages.list` and `continueList`.
- `folders.query` and `getFolderInfo`.
- `mailTabs.update`, `setQuickFilter`, `setSelectedMessages`, `getSelectedMessages` and `getListedMessages`.
- `messageDisplay.open` (tab and window) and `getDisplayedMessages`.
- `compose.beginNew`, `beginReply` and `getComposeDetails`.
- `messages.archive` through the `a` key, not as an API call.
- `tabs.create`, `tabs.update` and `tabs.remove`, and both script registrations.

The other rows were checked for presence only.

### Notes for the build

- `mailTabs.update({displayedFolder})` threw "An unexpected error occurred" on the first display of each folder (51 times in a 50-folder run), though each folder displayed. The console held `can't access property 0, this._sort[0] is undefined` from `DBViewWrapper.sys.mjs` (`primarySortType`), raised while `ext-mailTabs.js` converted the updated tab. `folder.open` needs to treat that error as "the view is still loading".
- `compose.beginReply` crashed both apps (a segmentation fault: signal SIGSEGV on Betterbird, exit code 11 on Thunderbird) when the Local Folders account had no identity. The job `reply_no_identity` keeps the run, in `app_exit.json`. With an identity it worked.
- An Experiment function that throws gives the background only "An unexpected error occurred". Wrapping each verb to rethrow `ExtensionError` with the message made the cause readable.
- `performance` is not defined in an Experiment parent script. `ChromeUtils.now()` is.
- The first key press after a focus change was lost once in each key scenario (the settle step counted one missed press per scenario). A real runtime cannot rely on the first press after a focus change.
- The probe never removes its key listeners, its overlay or its console listener, because it never shuts down during a run. The real chrome runtime must remove its key listeners from every window and remove its overlay and its window and console listeners in `onShutdown`. Otherwise a disabled or updated add-on leaves old handlers on every open window, and a cancelled key stays cancelled until the window closes.
- A fresh profile needs `mailnews.default_view_flags` 1 for threaded folder views. `mailTabs.update({viewType: "groupedByThread"})` did the same through the API.

### Not measured

- Key repeat, and a held key under a busy thread list. The burst test above ran 5 keys per burst.
- Keys with focus in an extension page that is a content tab, the address book tab and the settings tab. `tabs.create` refused `about:addons` ("Loading URL not allowed").
- A second window of the main type, and tabs other than the mail tab, the message tab and the content tab.
- Message content that is not local mail, and whether it makes `messagepane` remote.
- X11, other keyboard layouts and other platforms. Only Linux on Wayland with a US layout ran.
- A signed add-on, and the review of Experiments on addons.thunderbird.net.
- The look of the overlay panel beyond the empty box in the screenshot.
- The quick filter on a Betterbird build older than 153.7.0.
- The system folders for native host manifests, and one run of each scenario per app only.

### Reproduce

```bash
tools/measure/fetch_thunderbird.sh
node tools/measure/run.mjs betterbird /path/to/betterbird
node tools/measure/run.mjs thunderbird
```

See [`tools/measure/README.md`](../tools/measure/README.md). A full run takes about 35 minutes per app. Results are JSON files and screenshots in `$MEASURE_DIR/run/<app>/<job>/out/`.

## Phase 1

Facts measured while the end-to-end tests ran on Thunderbird 153.7 ESR and Betterbird, with the same result on both unless noted.

### Focus chains

The event target seen from the top window is not enough to tell where focus is. For the thread list and the folder pane, `composedPath()[0]` is the browser that holds `about:3pane`, a browser the parent process can read. A check for "the focus is in a browser" matches there, so a browser is not a text field.

| Focus | `target` | `originalTarget` |
| --- | --- | --- |
| Thread list | `tbody` | `tbody` |
| Folder pane | `ul#folderTree` | `ul#folderTree` |
| Quick filter | `search-bar#qfb-qs-textbox` | `input` in its shadow tree |
| Global search (`Ctrl+K`) | `global-search-bar` | `input` in its shadow tree, in the top document |
| Message body | chain: `about:3pane` browser, `messageBrowser`, `messagepane` (type `content`, not remote), `body` | |

- No unreadable browser showed up in any of these cases.
- Five Tabs from the thread list end on the message header buttons and then a notification button. They never reach the body.
- Betterbird: three Tabs from the folder pane end on `button#threadColButton`, not on the thread list.
- A key press with a context menu open (opened with `Shift+F10`) still reaches the top window listener. The menu is `menupopup#mailContext` in `about:3pane`. Its `state` is `open` and its `open` attribute stays unset. With no check, `j` moved the thread selection under the open menu on Thunderbird.

### F6 order

`F6` cycles the panes in this order: folder pane, thread list, message body (when a message shows), spaces toolbar, global search. `Shift+F6` reverses it. Both apps agree. `F6` from the thread list puts focus in the message body.

### Collapsed threads and the displayed messages

`messageDisplay.getDisplayedMessages` returns an array. With a collapsed thread root selected, the pane shows the thread summary and the array holds every message of the thread (4 of 4 in the fixture). A handler that needs one message must choose one.

### Selection after archive and delete

Thunderbird keeps a row selected after `messages.archive` and `messages.delete` on the selected message. In the 60-message Inbox it selected the next row (archive of `Single 2` selected `Single 3`, delete of `Single 3` selected `Single 4`). With the last row removed it selected the new last row (`Single 18` after `Single 19`, `Single 17` after `Single 18`).

## Phase 2: message state and compose

Measured on Thunderbird 153.7.0 and Betterbird, each in a fresh profile with the Local Folders fixture. The probes were raw API calls from a temporary version of the e2e helper add-on, with no DesertBird guard in front. The permission probe ran on Thunderbird only.

### Compose calls

- With no default account (Local Folders only), `compose.beginForward` without `details.identityId` never returned its promise and opened no window, with an identity on the account and without one. Thunderbird's own Ctrl+L forward worked. `beginForward(id, "forwardAsAttachment")` returned, and so did `beginForward(id, undefined, {identityId})`, which also keeps the user's forward mode.
- With a default POP3 account that has two identities and Local Folders with none, `beginReply` and `beginForward` both returned and opened a window on both apps, for a Local Folders message with the default account's identity and for a message addressed to the alias identity with the alias. Without an `identityId`, forward worked too, but composed from the default identity even for the alias-addressed message. So the identity is passed explicitly.
- `compose.beginNew` with no identity opened a compose window and did not crash.
- `compose.beginReply` crashes the app with no identity anywhere (Phase 0). DesertBird refuses reply, forward and new before the call when no identity exists in any account.

### `accounts.getDefault`

It returned `null` in a profile whose only account is Local Folders with an identity, because Local Folders cannot be the default account. `compose.beginNew` still composes there. The guard for `msg.new` reads the default account when there is one and any identity otherwise.

### Permissions

- `messages.update` needs `messagesUpdate`. Without it `browser.messages.update` is not a function.
- `messages.tags.list` needs `messagesTagsList`. `messages.listTags` works with no permission and is the deprecated form. `messagesTags` alone does not define `messages.tags.list`.
- `folders.markAsRead` needs `accountsFolders`.
- `folders.query({accountId, path})` works with `accountsRead`.

### Selection after `messages.move`

Thunderbird keeps a row selected after `messages.move` of the selected message, as it does after archive and delete. It selected the next row (a move of `Single 2` at row 12 selected `Single 3` at row 13 of the old list), and the new last row when the last row moved. Both apps agree.

### Cost of the per-id loop

The handlers make one `messages.update` call per selected id, in order, because the API takes one id. Select-all in a large folder sends every id. The cost on a large selection was not measured.
