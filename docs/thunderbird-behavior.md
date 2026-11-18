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

This contradicts the design's statement that the message body "runs in a content process the chrome listener cannot see". For local mail, a chrome listener in the parent process sees keys in the message body (`top_capture` with target `body` in the table above). Open point for the design: does the message pane need a content script for keys at all, or only for hints, find and anything that reads the body? Content that is not local mail (a feed article, a web page) was not measured and can differ. Remote content and sandboxed HTML in local mail were measured later, see Message scripts.

### Keys in compose

- `composeScripts.register` ran in the compose editor. A real `q` press with no cancel reached the content script and added one character to the body (`getComposeDetails`). With the top window cancel on `z`, the content script got nothing and the body did not change. A chrome cancel stops text entry in compose.
- Ctrl+E in the body of a plain-text reply reached the `composeScripts` script on Thunderbird 153 and on Betterbird (e2e kind `compose_editor`). With the script's cancel, the body afterwards held only the editor's text, so no Thunderbird action on the chord showed. The `desertbird_host` manifest in `~/.mozilla/native-messaging-hosts/` was found by `sendNativeMessage`, and `setComposeDetails({plainTextBody})` replaced the whole body, quote and signature included.
- HTML compose on Thunderbird 153.7.0 ESR (e2e kinds `compose_editor_html` and `compose_editor_html_top`): `getComposeDetails` gives the body as a whole document, `<!DOCTYPE html>`, a line break, then `<html>`. A reply below the quote is the cite line (`div.moz-cite-prefix`), the quote (`blockquote type="cite"`), an empty `<p><br></p>` for the cursor and the signature (`pre.moz-signature`, starting `-- `). With `reply_on_top` 1 and `sig_bottom` false it is `<p><br></p>`, the signature (with no `-- `), the cite line and the quote. Two reads with no change in between gave the same string, so the stale-body check compares strings. `setComposeDetails({body})` with the Markdown's HTML in place of the cursor line kept the quote and the signature byte for byte. A forward was not driven: `g F` opened its window only after many seconds there. An HTML draft with a `data:image/png;filename=pixel.png;base64,...` image, saved with `compose.saveMessage` and opened again with `compose.beginNew(id, {identityId})`, gave the image back on Thunderbird 153.7.0 as the same `data:` URL with its `filename` part. Betterbird gave it back as a `mailbox:` URL of the saved part (`mailbox:///<profile>/Mail/Local%20Folders/Drafts?number=1&part=1.2&type=image/png&filename=pixel.png`), which the external editor does not keep: an edit there drops the image and names the loss. Without `identityId` that `beginNew` never returned in a profile with no default account. An image inserted with Insert > Image was not measured, because the keys did not reach the dialog.
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
- Chosen for the product: the `browser` element in the main window document, pinned to the bottom edge (not an iframe, not a panel). Built and run in both apps with the end-to-end run. Two details the probe did not show: the message manager of the `browser` does not exist while `XULFrameLoaderCreated` is dispatched, so the load must run a microtask later; and the frame script and the load follow the order of the probe. The remote page is capped at 800 px wide. After the overlay is removed, a focus call on the thread list body returns the focus, and Thunderbird's own Down key then moves the selection in both apps.
- The hud (which-key panel, toasts) is a second remote `browser` of the same kind, left unfocused and transparent. Measured on both apps with the end-to-end run: a browser told a maximum size (`maxWidth`, `maxHeight` in `Extension:InitBrowser`) resizes to the size of its content, so a page of absolutely placed pieces ended `0x0` and drew nothing; with no maximum the browser keeps its box. The attribute `transparent="true"` on the `browser` lets the window show through the page, and `pointer-events: none` on the box lets clicks reach the list under it. The page follows `prefers-color-scheme` under the built-in light and dark themes of both apps.
- A key typed right after `:` with no pause (one `wtype` call) reached the list on Thunderbird 153.7 before the overlay had the focus, and an `x` in it archived a message. The same keys on Betterbird went to the overlay. The mount is a round trip from the key runtime to the background and back.

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

- The size limit of `messages.getFull` for a large body, and so of a yank of one.
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

### Clipboard write from the background (PR 5)

`navigator.clipboard.writeText` called from the persistent background page, on a key press that arrived through the Experiment, writes the clipboard with the `clipboardWrite` permission and no user activation of the page. Measured on Thunderbird 153.7 and Betterbird, with the text read back through the e2e helper. `messengerUtilities.convertToPlainText` exists on both and turns HTML into text: it decodes entities, drops the title and puts a tab between table cells.

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

## Phase 2: tabs

Facts measured while the end-to-end tab checks ran on Thunderbird 153.7 ESR and Betterbird. Both apps gave the same result.

### Tabs

- `tabs.update(id, {active: true})` selects a content tab, a message tab and the mail tab. `tabs.remove` closes a content tab and a message tab. Only the first tab ignores it (see above).
- `tabmail.tabContainer` reads `undefined` from the Experiment. `TabSelect` fires for every change of the front tab, also one made through `tabs.update`. At startup the window is hooked before `#tabmail-tabs` exists, so a listener on the strip never attached in about one run in three. A capture listener on the window always attaches.
- A popup window opened with `windows.create` takes focus at once and the main window reports `focused: false`. The main window then gets a `blur` event. A listener that reset only on a blur aimed at the window or its document did not fire in the end-to-end run, so the listener resets on any `blur` seen while `document.hasFocus()` is false.
- A bound chord pressed in the mail tab runs its command and Thunderbird's own action does not happen. `<C-j>` switched tabs and opened no Saved Files tab.
- A chord pressed in a content tab or a message tab reaches no DesertBird command. `<C-j>` in a content tab ran Thunderbird's own action and opened the Saved Files tab (type `special`). `<C-k>` in a message tab changed nothing. So the tab keys work from the mail tab only, and a switch to another tab by key has no way back by key.
- The tabs API gives the first mail tab and a second mail tab the same fields (`type: "mail"`, `mailTab: true`, the same `spaceId`). Only the index differs. `tabs.move` of the first tab fails with "The primary mail tab in a normal Thunderbird window cannot be moved", so it always stays at index 0.
- `mailTabs.create({})` opens a second mail tab (folder tab) and brings it to the front. `tabs.remove` closes it, and `q` closes it by key.

## Sort keys

Facts measured while the end-to-end sort key checks ran on Thunderbird 153.7 ESR and Betterbird. Both apps gave the same result.

- `mailTabs.update(tabId, {sortType: "received", sortOrder: "ascending"})` and the same with `"priority"` returned without an error. A following `mailTabs.query` reported the new `sortType`. `sort.set` takes both as `by` values.
- `, d`, `, s`, `, f` and `, o` set the sort and the row order of the Views folder (6 messages) as the keys name it. `getListedMessages` returned the rows in the order of the view. `, o` flipped the order of the column the list had.
## Snooze

`msg.snooze` is built on standard MailExtension APIs. What was checked and what is left for a hand check:

- The message waits in a `Snoozed` folder in its own account, found at `/Snoozed` or `/INBOX/Snoozed` (a server with an `INBOX.` namespace) and created at the account root when missing. Only an account whose root cannot hold subfolders (the root does not match `folders.query` with `canAddSubfolders: true`) falls back to the Local Folders `Snoozed` folder, and the message then moves across accounts. Any other create failure, including a create that gets no answer from the server within 10 seconds, refuses the snooze and leaves the message where it is. Two snoozes at once in one account share one create. The item stores the id of the folder the message went into. The wake queries only that folder by Message-ID, reads every page, and sends the message back to the Inbox of the account it came from, or to the folder it came from when the account has no Inbox. An item whose Snoozed folder is gone, or with neither an Inbox nor an origin folder, is dropped with a notification.
- `messages.move` gives the message a new id, so a snooze stores the Message-ID header and the origin account and never the numeric id. After the move back, the wake looks the message up again to mark it unread.
- A snooze that comes due while Thunderbird is closed wakes at the next start. The add-on cannot wake a closed application. After a start, the run at start and a tick every minute catch every item that is due.
- Firefox alarms do not survive a restart, so the add-on creates its one repeating alarm again on every start.
- The end-to-end run covers the key, the folder creation and the move in Local Folders. The due time is hours away, so the wake is not run end to end. The unit tests drive it against a model mailbox that gives moved messages new ids.
- A wake whose Inbox lookup fails keeps its item and tries again at the next tick. 
- Not measured, for a hand check: folder creation on a server with an `INBOX.` namespace, the move and the wake on a real IMAP account (the message returns with the same Message-ID), the same flow on Betterbird, a wake after a wait of minutes and after a restart, the wake notification text, and the unread count in the folder pane after a wake.

## Message scripts: keys in a message document

Facts measured while the end-to-end message checks ran on Thunderbird 153.7 ESR and Betterbird 153.7.0. Both apps gave the same result. The e2e kinds `message` and `message_remote` rerun them.

### Where the script runs

- The manifest key `message_display_scripts` injects a script into each message document: the reading pane, a message tab and a message window. Thunderbird injects it when about:message reports `MsgLoading`. The script ran in the top frame of all three, on every message it showed.
- The script runs only with the permission `messagesModify`. Without it, Thunderbird drops the injection with no error and the script never loads. This was the first result of the e2e run: the script never marked its document until the permission was in the manifest.
- The script reads `browser.storage.local` and `browser.storage.onChanged`. Both work in a message document.
- The script ran in a plain text mail, an HTML mail, an HTML mail with a remote image, and an HTML mail with a sandboxed `iframe` and a `script` element. It ran with remote content blocked (the default, where a banner shows above the body) and with remote content allowed (`mailnews.message_display.disable_remote_image` false). The reading pane scrolled one line on `j` in every case.
- The scrolled element is the document: `window.scrollBy` and `window.scrollTo` moved the message in all three places. `scrollHeight` of the root element is the page height.

### Keys

- Keys in the message body reach the script's capture listener on the window of the message document, as long as no listener above it cancels them. The chrome runtime's capture listener on the main window sees them first. It cancelled the plain printable keys of the reading pane until the script marked the document live. With the mark set, `j`, `k`, `<C-d>`, `<C-u>`, `gg`, `G` and counts all scrolled in the pane.
- A message tab and a message window need no handoff: the chrome runtime does not hook them, so their keys reach the script directly.
- With the script live, `s` typed in the reading pane starred no message and `m` did not toggle the read state. (`f` is the hint key now.) The script cancels every plain printable key, as the chrome runtime did.
- `Escape` is not cancelled, so Thunderbird still acts on it. In the reading pane and a message tab it ended a pending count. In a message window the `j` after it did not scroll, which fits Thunderbird closing the window on Escape. That was not checked directly, so the e2e run skips the Escape check there.
- The handoff is an attribute on the root element of the message document. The chrome runtime reads it through the `contentDocument` of the `messagepane` browser, which is readable (see Message pane process). Only the document that holds the end of the focus chain counts. Focus in the message header or in a frame inside the mail leaves the marked document out, so the runtime keeps swallowing there. The script runs in the top frame only, so a key typed in a frame never reaches it.


## Phase 2: folders and jumps

Facts measured on Thunderbird 153.7 ESR and Betterbird 153.7 with the e2e helper add-on (`folder_events_start`, `folder_events_read`, `show_folder`, `query_folder`). Both apps gave the same result in one run each. The fixture is Local Folders with an Inbox, a Trash that is an empty mbox, and mbox folders that hold messages.

### Display event

- `mailTabs.onDisplayedFolderChanged(tab, folder)` fires for a folder that `mailTabs.update({displayedFolder})` shows, and for a folder the user picks in the folder tree (Up and Down in the tree). `folder` carries `accountId` and `path`.
- The event fires in the same millisecond that the `update` call returns. It does not wait for the call's promise to be read.
- It does not fire when the call names the folder that is already shown.

### First display of a folder

- `mailTabs.update` throws "An unexpected error occurred" on the first display of a folder that holds messages and was never shown in the session (`/Views`, `/Html`). The folder shows and the display event still fires.
- A folder shown for the first time that is an empty mbox (`/Trash`) did not throw. A folder shown before did not throw.
- A `mailTabs.query` right after the failed call threw the same text for `/Views`, which was the first folder shown through the API in the session, and returned the new folder for `/Html`. So the query right after the error is not reliable evidence either way, and a handler that treats the error as success must accept both outcomes.
- The call to the folder already shown returns with no error.

### Folder lookup

- `folders.query({accountId, path})` and `folders.query({path})` return the folder. A path that does not exist returns an empty list, not an error.
- `folders.query({specialUse: ["inbox"]})` finds the Inbox. Local Folders has no Drafts, Sent or Archives folder until one exists on disk, so `specialUse` for those returns an empty list.
- Not measured: a folder renamed or deleted on a server, and a first display on a real IMAP folder.
### Find, hints and the command line from a message

- The command line opens in a main window only. `overlay.mount` looks the window up among the `mail:3pane` windows, so a standalone message window has none. A message tab and the reading pane sit in a main window, so the line opens there. In a message window `/` refuses with a notification.
- The body script reaches the background with `runtime.sendMessage`, and the background reaches the script with `tabs.sendMessage` on the front tab of the window. Both worked in the pane and in a message tab. The sender of a message from the script carries `tab.id` and `tab.windowId`. The background takes the window and the messages (`messageDisplay.getDisplayedMessages`) from the sender.
- The find is `window.find` in the message document. It selects the match and scrolls to it. The `wrapAround` flag measured as no help in a message tab (the search stopped at the last match), so the script wraps itself: at the end of the matches it moves the selection to the far end and searches again.
- Where the focus lands after the line closes: in a message tab `window.focus()` from the script puts it back in the message, so `n` and `N` work at once. In the reading pane the overlay returns the focus to the thread list, and `window.focus()` did not move it into the message. `F6` does.
- A hint pick focuses the link and the Experiment then sends the Enter. A real Enter on the focused link reached Thunderbird's own click handling: for a link whose text names `bank.example` and whose address is `127.0.0.1`, Thunderbird showed its Link Mismatch dialog (read from the e2e screenshot), as a mouse click does. A script `click()` is an untrusted event and skips that handling, measured with the e2e probe `hints: click() on the external link` (a content script clicks the same link): on Thunderbird 153.7.0 ESR and on Betterbird the pane went straight to the link address (an error page for the closed port) and no Link Mismatch dialog showed. So the pick focuses the link and the `hints` Experiment presses a trusted Enter (a `nsITextInputProcessor` key press in the window), which Thunderbird handles as a click. The e2e shot `hint_external_pick` shows the Link Mismatch dialog after the one-step pick on both apps. A link to a place in the same message scrolled to its target on Enter. Opening an external link in the system browser was not measured and is a hand check.


## Unsubscribe

Not measured yet. The design rests on these calls, and each is a hand check:

- `messages.getFull(id)` returns the headers as lower-case names with a list of values. The `List-Unsubscribe` header is read from there.
- `windows.openDefaultBrowser(url)` is in the 153.7.0 schema and needs no permission. Whether it opens the system default browser on both apps is not run.
- `compose.beginNew(undefined, {to, subject, body, identityId})` opens a draft with those fields and the identity that received the mail.
- Hostile header samples (`http:`, `javascript:`, `data:`, `file:`, malformed brackets) open nothing. The parser tests cover this. A run with real mail is a hand check.

## Thread verbs

Measured with the end-to-end run on the fixture Inbox (ten threads of four, opened collapsed) on Thunderbird 153.7.0 ESR and on Betterbird. The chrome functions are `threadTree.expandRowAtIndex` and `collapseRowAtIndex`, `commandController.doCommand("cmd_expandAllThreads")` and `("cmd_collapseAllThreads")`, and `getRowAtIndex(row).scrollIntoView` after `scrollToIndex`.

- Expand and collapse of one row work on both apps. After `l` on a collapsed root, `j` enters the thread. After `h` on a root, `j` skips its replies.
- `cmd_expandAllThreads` and `cmd_collapseAllThreads` work on both apps through the `commandController` global of `about:3pane`. After `z R` the row below the first root is its first reply. After `z M` it is the next root.
- `mailTabs.setSelectedMessages` with a thread root id selects the root and leaves the thread closed.
- The tree has no call that places a row: `scrollToIndex` only brings it into view. The verb calls it first (only rows near the view have an element), then `scrollIntoView` on the row, then `scrollBy` back by the sticky column header height read at run time (all of it for top, half for center, none for bottom). Without the move, `z t` hid the row under the header in the Betterbird table view.
- With the move, `z t`, `z z` and `z b` put the row at the top, middle and bottom of the list on both apps, in the Betterbird table view and the Thunderbird card view, in a list tall enough for several rows. The list clamps at its ends: a row near the start cannot reach the middle or bottom, a row near the end cannot reach the top.
- In a view grouped by its sort column, a group header row reports the message key of its first member, so the header and that member have the same id.

## Save attachments

Taken from the API schemas. Not yet measured on a running Thunderbird or Betterbird, so each point is a hand check.

- `downloads.download` resolves when the download starts, not when it ends. The command ends then too. The blob URL stays until `downloads.onChanged` reports `complete` or `interrupted`, with a ten-minute fallback for a download that never reports one, so a large file is not cut short.
- `filename` is relative to the Downloads directory, so the add-on cannot write elsewhere.
- `messages.listAttachments` returns `contentDisposition` and `type` on 153. The handler skips inline parts and every part whose type is not `normal` (a deleted attachment leaves a placeholder, a detached or linked part has no bytes in the message) and reports how many it skipped.
- An explicit `saveAs` wins over the "always ask where to save" setting, so `where: downloads` sets `saveAs: false` and never shows the dialog. A canceled dialog rejects the call and counts as not saved.
- Hand checks: the bytes of a saved file against the fixture attachment, a tens-of-MB attachment, Betterbird, a mail with a hostile file name, and a mail with a deleted attachment and an inline logo.

## New-mail notifications

Taken from the API schemas and the 153.7.0 notification code. Not yet measured on a running Thunderbird or Betterbird, so each point is a hand check.

- Action buttons do not work. The `notifications` schema lists `buttons`, but `ext-notifications.js` carries `TODO Bug 1190681, implement button support`, and `onButtonClicked` never fires. Only `onClicked` and `onClosed` work. The add-on shows no buttons, and the click opens the message.
- `messages.onNewMailReceived` fires after filters and junk classification, for the Inbox and normal folders unless `monitorAllFolders` is set. The handler keeps the Inbox only, by `folder.specialUse` (the live field, where `type` is the deprecated MV2 one), and skips read and junk messages.
- The notification id to message ids map is in memory. The background page is persistent and Thunderbird clears every notification of the add-on when it shuts down, so no entry outlives the page. `onClosed` drops an entry. Turning the setting off clears every open notification and the map. The setting is checked again before each notification is created.
- A click clears its notification. On a message that is gone (`messages.get` rejects) it shows a notification and opens nothing. A moved message keeps its id and opens. The batch click opens the first message of the batch.
- The first page of the delivered message list is the only page read. A delivery larger than one page is not counted past it.
- Hand checks: the notification renders on Wayland, Plasma and GNOME with no buttons; real mail triggers it and the click opens the message; Thunderbird's own alert also shows (a double alert); Betterbird behaves the same.

## Quick reply draft

Measured with the end-to-end run on Thunderbird 153.7.0 ESR and on Betterbird (the same result on both), with an identity that has a text signature, once in plain compose and once in HTML compose. `compose.beginReply` resolves to the compose tab, and `getComposeDetails` right after it returns the finished draft with the quote and the signature, so no wait is needed.

- Inserting the slot text above the quote with `getComposeDetails` and `setComposeDetails` keeps the quote and the signature in both compose modes. The measured draft is the default one: reply below the quote, signature at the bottom (the profile sets neither `reply_on_top` nor `sig_bottom`). It has the cite line, the quoted text, then the signature (`moz-signature`). Reply on top and a signature above the quote were not measured.
- Known limit: with reply on top and the signature above the quote, the HTML insert lands below the signature, because it goes before the cite line. Plain compose puts the text at the very top in every layout.
- An empty `div` does not survive `setComposeDetails`, so the blank line between the text and the cite line is an empty `<p><br></p>`.
- The HTML path sets the text with `textContent`. A slot text of `Second & <b>line</b>.` reads back as `Second &amp; &lt;b&gt;line&lt;/b&gt;.` in the draft body, so it is not live markup.
- A preset `body` on `beginReply` was not measured, because the insert after the draft opens keeps both parts.
## Follow-up reminders

`msg.remind` is built on standard MailExtension APIs and is not measured in a running Thunderbird yet. Left for a hand check:

- A reply is a message newer than the anchor in the Inbox or an Archives folder of the anchor's account, subfolders included (Thunderbird archives by year, into Archives/2026 and so on), whose `References` or `In-Reply-To` header names the anchor. The check runs only when the reminder is due, and not in the first 5 minutes after a start, because the folders have not synced then. A reply that arrived while Thunderbird was closed cancels the reminder once the sync has brought it in. A reply that syncs later than the grace is missed, which is a hand check. An anchor in Trash or Junk counts as deleted.
- The reply check reads the headers of each newer message in those folders, so a busy Inbox makes the check slower. A reply filed in any other folder is not seen, and a header that cannot be read is skipped.
- Hand check: a reply archived into a year subfolder of Archives cancels the reminder.
- The `Follow up` tag is created on first use, which needs the `messagesTags` permission.
- The notification id holds the account and the Message-ID header of the anchor. A click looks the anchor up and opens it in a tab.


## Step keys and visual mode

Measured with the end-to-end run on Thunderbird 153.7.0 ESR and on Betterbird, which gave the same times within 6 ms (`E2E_SCALE=1`: the 10,000-message Big folder, 3 of every 10 unread and 1 in 25 starred, plus 50 folders of 100). Each time is the wall time from the last key to the selection change, polled through the helper's light `selection` command. Polling has a granularity of about 100 ms, and the `j` baseline is 218 ms, so the cost of a step is the number minus that.

| Key | Time |
| --- | --- |
| `j` (baseline) | 218 ms |
| `] u`, next unread one row away | 319 ms |
| `] s`, next starred up to 25 rows away | 318 ms |
| `2000 ] u`, a pass over about 6,000 rows (13 blocks of 500) | 3327 ms |
| `] U` with unread rows ahead | 317 ms |
| `] U` from the last row of Big, no unread ahead: 52 folder counts, one query, a folder change | 219 ms |

- `keys.viewRows` costs about 0.25 s per block of 500 rows in a folder of 10,000, so a step that finds its match nearby takes one block. A count reads each block once.
- `folders.getFolderInfo` throws "An unexpected error occurred" for a folder Thunderbird has not opened yet, and a different error for a root folder. The step reads a failing count as none.
- `messages.query` with `messagesPerPage: 1` and `autoPaginationTimeout: 0` can return an empty first page with a list id. The step follows it with `continueList`.
- Selecting a message in the thread list marks it read when the message pane shows it, so an unread step that walks the list leaves the rows it visited read.
- `threadTree.selectedIndices = [...]` followed by `threadTree.currentIndex = end` selects a range with the current row at its end. `_selectRange(anchor, end)` of the tree sets the current row to the anchor.

## Panes, undo and pages

Measured with the end-to-end run on Thunderbird 153.7.0 ESR and on Betterbird, with the same result on both. Native Down tells which pane has the focus: it moves the selection of the pane that holds it.

- `about:3pane` has the globals `folderTree` (the folder pane, `ul#folderTree`) and `messageBrowser`. The tree has `selectedRow`, `expandRow(row)` and `collapseRow(row)`, which do nothing on a row without children or in the state asked for. `folderTree.focus()` and `threadTree.table.body.focus()` give the focus to the folder pane and the thread list. `messageBrowser.contentWindow.getMessagePaneBrowser().focus()` gives it to the message body of a single shown message.
- A collapsed thread root shows the thread summary and no message body, so focusing the message pane on it leaves the focus where it was. The check selects a single message first.
- `paneLayout.folderPaneVisible` and `paneLayout.messagePaneVisible` in `about:3pane` give the same answer as the `mailTabs` fields after `t f` and `t m`. With either pane hidden, `H` and `<A-l>` left the focus in the thread list and showed the refusal toast.
- `folderTree.rowCount` counts the visible rows. Setting `folderTree.selectedIndex` selects the row, scrolls it into view and opens the folder, and the focus stays in the folder pane. `j`, `k`, `g g` and `G` there moved the folder selection.
- `H` and `<A-l>` typed into the quick filter reach the field: `H` filtered the list and no pane took the focus.
- `h` on the account row of Local Folders closes it, and Down then stays on the account row. `l` opens it, and Down reaches the Inbox.
- The folder tree rows are `li` elements. A folder with subfolders has the class `children`, and a closed one also `collapsed`. One invisible wrapper row with the classes `unselectable children` holds every account and is no visible row (`rowCount` does not count it). Closing it empties the folder pane, so `z M` and the parent lookup of `H` skip it. `z M`, `z R` and `H` on a folder, on a child, and from the thread list gave the same result on both apps.
- The folder pane verbs live in a second Experiment API, `folderpane`, with its own script. The design rests on Firefox loading an Experiment script on the first call to its API, which is how it treats an API with no startup event. That timing was not measured on its own. The end-to-end run shows only that the verbs work.
- The focus is in the folder pane when the focus chain of the main window holds an element with the id `folderTree`.
- The body script takes every key while the message pane has the focus, so `g e` and `g f` there run through its own keymap and the background. Both moved the focus out.
- `cmd_undo` is a command of the main window's `DefaultController`. `cmd_openConversation` is a command of the `commandController` of `about:3pane`. Both have `isCommandEnabled`.
- What `cmd_undo` undoes, on the fixture Inbox: a delete by the native Delete key is undone and the thread returns to the Inbox. `d d` (the `messages.delete` API) is not undone, and `:undo` after it changes nothing. A second `:undo` with nothing left to undo changes no mail. `u` and `:undo` now run DesertBird's own undo log instead (see `docs/design.md`, `msg.undo`), and the native step is left to Thunderbird's Edit menu.
- `cmd_openConversation` is enabled for one selected message that the search index covers. It opened a conversation tab in the full run and was disabled in a fresh profile, where `g C` opened nothing and the command refused with a message. Keys do not run in the conversation tab.
- `openAddonsMgr("addons://list/extension")` and `openAddonsMgr("addons://list/theme")` open or reuse the Add-ons Manager tab. `openContentTab("about:config")` opens the configuration editor in a tab. Keys do not run in those tabs, so the next key press needs the mail tab in front.

## Mode label

- The label is a XUL `label` with class `statusbarpanel`, inserted before the first child of `#statusTextBox` (else `#status-bar`) of `messenger.xhtml`. Measured on Thunderbird 153.7.0 and Betterbird with the end-to-end run: it draws at the start of the bar, left of the status text.
- A `focusin` and `focusout` capture listener on the window sees focus move into and out of the quick filter, which sits in `about:3pane`. The label reads the innermost focused element (`focus.ts`) on each event, so insert mode follows the field.
- The label colors come from the theme setting. The classic style colors the text with the mode role and the badge style fills a pill with it. Thunderbird's own `--color-yellow-50` and the other palette variables were used before and gave about 1.9 to 1 on a light status bar.

## Color scheme

Measured on Thunderbird 153.7.0 headless, with the Thunderbird theme (Compact Dark or Compact Light, or none) set against `ui.systemUsesDarkTheme`:

| Where the query runs | Follows |
| --- | --- |
| `matchMedia("(prefers-color-scheme: dark)")` in the main window (chrome) | Thunderbird's theme |
| the same in an extension page mounted in the window (hud, command line) | Thunderbird's theme |
| the same in an extension page in a tab (options) | Thunderbird's theme |
| the same in the background page | the OS |

So a surface in the window needs no setting to pick dark or light: it asks its own `prefers-color-scheme`. The background page cannot choose, so it sends both sets and the window side picks. `#status-bar` reads `rgb(39, 39, 42)` under a dark theme and `rgb(250, 250, 250)` under a light one, with the OS set either way.
