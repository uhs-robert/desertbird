# DesertBird design

DesertBird is a keyboard-first Thunderbird add-on, and it works in Betterbird too. It replaces setups that load key files into Thunderbird through an autoconfig file. It follows the DesertFox design: one command registry, one validator, the keymap as data, no string eval and a native host with fixed verbs.

The goals:

- It installs as one signed add-on and needs no autoconfig file, no package-manager hook and no second key add-on.
- Every default binding maps to a registry command (the split table below).
- Most commands run on standard MailExtension APIs. An Experiment is the privileged part of a Thunderbird add-on, and it runs chrome code. This one does only what no standard API can do, through a fixed set of verbs.

## Principles

- Same principles as DesertFox `docs/design.md`. Define each command once in the registry, and check args only in the one `check_args`. Keep the keymap as data and never evaluate strings. Give the native host and the Experiment fixed verbs only. Keep no state only in memory, and write a migration for every change to stored data.
- Hybrid add-on: a MailExtension plus one Experiment. A pure MailExtension cannot take plain keys in the main mail window, because the `commands` API takes modifier chords only.
- The Experiment holds no command logic of its own. It has two parts. The chrome runtime holds the key matcher, the modes and the instant commands, like DesertFox `content.js`. The verb table is a fixed list of calls the background can make. A new verb needs a reason in the commit, the same rule as a new native host verb.
- Bindings that run code from a string do not exist. The keymap is data.
- The external editor goes through the DesertFox native host verbs `editor_start` and `editor_collect`, not a terminal launched through XPCOM. The host owns the editor command, so no request carries argv.
- Code home: this repository. The core shared with DesertFox (`define`, the checks, `check_args`, the parser, the prefix tree) lives in `packages/core` in the DesertFox repo. DesertBird installs it from a git tag or npm. There is no third repository. Until the core moves there, this repository carries no core.

## Architecture

The parts map onto DesertFox like this:

| DesertBird part | DesertFox counterpart | Holds |
| --- | --- | --- |
| Background page | Background page | The registry, the handlers that use standard APIs, keymap compile, config, storage |
| Chrome runtime (Experiment parent script) | `content.js` | The key listener in each mail and compose chrome window, the prefix tree matcher, modes, counts, and the `runs_in: "chrome"` handlers |
| Chrome verbs (Experiment API schema) | None (new) | A fixed table of privileged operations that background handlers call |
| `messageDisplayScripts` | `content.js` in a page | Keys and hints inside the message body, which runs in a content process the chrome listener cannot see. Measured: for local mail the message pane is not remote and a chrome listener sees its keys (see [`thunderbird-behavior.md`](thunderbird-behavior.md), Message pane process) |
| `composeScripts` | `content.js` in a field | Insert mode, `<C-o>`, `e` in normal mode and the mode label inside the compose body (built); hints are not |
| Overlay page in the chrome window | `cmdline.html` in a remote `browser` element and the `ui` bundle | Command line, completion, which-key and toasts |
| Native host | Native host | Config read (`read_config`) and the external editor (`editor_start`, `editor_collect`) |

Registry changes from DesertFox:

- `runs_in` takes `background`, `chrome`, `message` or `compose`. A command runs on one side only.
- `chrome` holds only commands that must answer a held key at once: the motions, page moves, counts and mode changes. The DesertFox admission rule for `content.js` applies to the chrome runtime as written, with its own size guard.
- `needs` lists the chrome verbs a background handler calls (`needs: ["view.rows", "view.select"]`). The router refuses with a message when the Experiment is missing or failed to load, never a silent no-op.
- A build step writes the split table below from the registry, the way DesertFox generates `docs/keymap.md`. A test fails when a handler calls a chrome verb its `needs` does not list.

## Chrome verbs

This list is the whole privileged surface. Each verb takes typed args and is checked against the Experiment schema.

- `keys.install {tree, settings}`, `keys.set_mode {mode}` and the `keys.onInvocation` event: the chrome runtime matches keys locally and sends finished invocations, the typed prefix of a half-typed sequence (`pending`) and the start and end of visual mode (`mode`).
- `view.rows {first, last}`: built as `app.viewRows`, with `app.viewThread`, `app.viewAllThreads` and `app.viewScroll` for the three below, all in the on-demand `app` API. The key script, which loads at startup, holds none of them. `viewRows` also returns the current row. The visible thread rows with index, message id, depth, collapsed, unread and the message flags word. `view.select {anchor, end}`, `view.scroll {row, position}`, `view.thread {row, open}` and `view.all_threads {open}`.
- `folder_tree.expand {open, extent}`: built as `folderpane.fold`, in the on-demand `folderpane` API. `extent` is `row` (the selected row, for `h` and `l`), `all` (`z M`, `z R`) or `parent` (`H`). It answers false, doing nothing, unless the folder pane has the focus, which is how `h`, `l`, `z M`, `z R` and `H` tell the two panes apart. A failed load of its script leaves `h`, `l`, `z M` and `z R` acting on the thread list. It takes no folder because the selected row is the cursor.
- `folderpane.viewRowCount`: the rows the message list shows now (`gDBView.rowCount`). It sits in the on-demand `folderpane` API and not in `keys`. The command line reads it once at open for the `[n/m]` widget. The line's status widgets differ from DesertFox, which shows the address, the scroll place and the tab place of a page: DesertBird shows the folder and the row place, a pinned `status.ts` would carry only dead Firefox code, and the widgets arrive in their own message after the focus is set.
- `folder_tree.focused {}`: built as `folderpane.focused`. It answers whether the folder pane has the focus. The background asks it on `/`, so one key serves both panes. No `select` verb exists: `mailTabs.update` with the folder opens the closed folders above it and selects its row, and `pane.focus` returns the focus to the folder pane.
- `pane.focus {pane}`: built as `app.paneFocus`, where pane is `folders`, `threads`, `message`, or `left` and `right` for the pane beside the focused one. It answers false, leaving the focus where it was, when the target is a collapsed pane, a message pane with no live body script, or past an end.
- `app.command {name}`: built as `app.appCommand`. One name from a fixed allowlist of Thunderbird commands, now only `cmd_openConversation`. It runs on the command controller of the page that shows the message (the mail tab, a message tab or a message window). It answers false when Thunderbird has the command disabled. Never a free string.
- `app.open_page {page}`: built as `app.appOpenPage`. One key of a fixed table (`addons`, `themes`, `config`), never a URL. The counterpart of the DesertFox host verb `open_firefox_page`.
- `hints.sendEnter {windowId}`: built, in its own bundle. A trusted Enter key press (the key is fixed, no text) in the window, for the link a hint pick in a message focused. A script `click()` skips Thunderbird's check for a link that lies about its address, so the body script asks for a real key instead.
- `hints.pick {windowId, colors, action?}`: built, in the same bundle. Labels the buttons, tabs, fields, folder rows and message rows of the front mail tab, each label drawn in its own chrome document (the window, `about:3pane` and `about:message`) in a closed shadow root, and holds the keys until a label is typed in full or the labels end. The one verb covers collecting, narrowing and acting, because the key sink must sit in the same bundle as the labels: a hint letter is also a command key (`a`, `d`), and a round trip to the background per key would let it run. The `action` argument (`focus`, `activate`, `yank`; absent is `activate`) says what the typed label does. A yank writes the text with `nsIClipboardHelper` in the parent, inside the key event, so no round trip to the background sits between the key and the clipboard. The parent reads the text from the page and the call never carries any. The message and compose content scripts hold their own hints.
- `overlay.mount` and `overlay.unmount`: the extension page that draws the command line, which-key and toasts in the chrome window.
- `overlay.setModeLabel`: the mode label at the start of the status bar. The args are a window id, three enums (the mode, the `mode_indicator` setting and the `mode_indicator_style` setting) and the label colors as `#rrggbb` for both color schemes. The parent owns the text and picks the scheme Thunderbird shows in the window. The Experiment draws it because a page cannot sit inside the status bar. It reads the focus itself for insert mode, since the key runtime does not track insert.

## Split table

"Standard" means the command runs in the background (or a content script) on MailExtension APIs only. "Experiment" means it needs the chrome runtime or a chrome verb. Each standard row is checked against the target ESR.

| Command (proposed id) | Default keys | Side | How |
| --- | --- | --- | --- |
| `msg.read {state: read, unread, toggle}` | `m r`, `m u` | Standard | `messages.update`. Takes a count: `5 m r` marks five rows from the current row, by the rule of `a` and `d d` (the selection plus the rows below, one undo entry for all ids, a refusal when the range reaches into a closed thread or the view is not the thread list). A toggle with a count follows the first message. A plain repeat on the same selection would change nothing after the first run, so the count takes rows instead. |
| `folder.read_all` | `m R` | Standard | `folders.markAsRead` |
| `msg.flag` | `m s` | Standard | `messages.update` |
| `msg.junk` | `m j` | Standard | `messages.update` |
| `msg.tag {tag}` | `m t`, `:tag` | Standard | `messages.update`, `messages.tags.list`. It toggles: the first selected message decides whether the tag goes on or off every message, as for the star. `u` undoes it: the entry holds, per message that changed, the one tag key and whether the message had it, so the undo touches only that tag. |
| `msg.move {folder, account}` | `m m`, `m p`, `:move` | Standard | `messages.move`, `folders.query`, `accounts.list`. The folder is looked up in the account `--account` names, else in the one account the selection shares |
| `msg.copy {folder, account}` | `m c`, `:copy` | Standard | `messages.copy`, `folders.query`, `accounts.list`. The same lookup as `msg.move`. The originals stay, so it records no undo item |
| `msg.remind {after: one_day, three_days, one_week}`, `msg.remind_cancel` | `m f d`, `m f t`, `m f w`, `m f c` | Standard | `messages.get`, `messages.query`, `messages.getHeaders`, `messages.update`, `messages.tags.list`, `messages.tags.create`, `folders.query`, `notifications`, `messageDisplay.open`, `alarms`. A reminder on a message, checked when due: a later Inbox or Archives message (subfolders included) that names the anchor in `References` or `In-Reply-To` cancels it. Otherwise the anchor gets the `Follow up` tag and a notification that opens it on click. Items live in `storage.local`. |
| `msg.snooze {until: later_today, tomorrow, weekend, monday}` | `m z l`, `m z t`, `m z w`, `m z m` | Standard | `messages.get`, `folders.query`, `folders.create`, `accounts.list`, `messages.move`, `messages.query`, `messages.update`, `alarms`. The message waits in a `Snoozed` folder of its own account (Local Folders when the account cannot hold subfolders) and the snoozed items live in `storage.local`. |
| `msg.archive` | `a`, `:archive` | Standard | `messages.archive`. A count archives that many rows from the current one (`app.viewRows`), and `.` repeats it. `u` undoes it. |
| `msg.delete` | `d d`, `:delete` | Standard | `messages.delete`. A count deletes that many rows from the current one (`app.viewRows`), and `.` repeats it. A count refuses when the current row is no longer one the key selected, or when the rows it reaches hold a closed thread. `u` undoes it. |
| `msg.reply {to: sender, all, list}` | `r`, `R` | Standard | `compose.beginReply` |
| `msg.reply_with {slot: 1 to 9}` | `g r 1` to `g r 9` (also in a message) | Standard | `compose.beginReply`, `compose.getComposeDetails`, `compose.setComposeDetails` |
| `msg.forward` | `g F` | Standard | `compose.beginForward` |
| `msg.new` | `c` | Standard | `compose.beginNew` |
| `msg.unsubscribe` | `g u` (also in a message) | Standard | `messages.getFull`, `windows.openDefaultBrowser`, `compose.beginNew`, `storage.local`. Two presses: a preview notification, then the action within 15 seconds. https opens in the browser, mailto opens a draft. It sends nothing and has no new permission |
| `msg.open` | `<C-l>` | Standard | `messageDisplay.open` |
| `msg.yank {field: content, subject, sender, address, message_id}` | `y y`, `y s`, `y f`, `y a`, `y i` | Standard | `messages.get`, `messages.getFull`, `navigator.clipboard.writeText` with the `clipboardWrite` permission. The `browser.clipboard` API only sets images. A hint yank in a message reaches the same writer through `body.yank`. A hint yank in the mail window uses `nsIClipboardHelper` in the parent (see `hint.window`). |
| `msg.save_attachments {where: downloads, ask}` | `g a` (also in a message) | Standard | `messages.get`, `messages.listAttachments`, `messages.getAttachmentFile`, `downloads.download` with the `downloads` permission. Files land in `Downloads/DesertBird/<date>-<subject>/`, because `filename` is relative to the Downloads directory and a free path needs a native host. Names and the subject are cleaned by `safe_filename`, a clash is renamed by `conflictAction: uniquify`, and a saved file is never opened. `ask` sets `saveAs` for each file. |
| `notify.toggle` | `:notify.toggle` | Standard | `storage.local`, `notifications.create`. Flips the `notify_new_mail` setting. While it is on, `messages.onNewMailReceived` shows a desktop notification per unread, non-junk Inbox message, or one batch for more than three. A click runs `messageDisplay.open`. No new permission |
| `folder.open {folder, special}` | `o`, `g i`, `g t`, `g d`, `g s`, `:open`, `:inbox` | Standard | `folders.query` with `specialUse`, `mailTabs.update`. Built: `g i`, `g t`, `g d`, `g s` and the handler for `folder` (the typed form: `o` opens the command line on `open `). No default key opens a Projects folder, because that is a personal folder name, so a user binding is the way to get it. `g p` is the prefix of the Thunderbird pages. `--account` names the account to look a path up in, for a path two accounts hold. A special folder is looked up in the shown folder's account first, then in any account. The first-display error is a success when the tab shows the folder or is still loading it. |
| `filter.set {state: unread, all, starred, toggle_starred, tag, attachment}` | `F u`, `F r` (reset), `F s` (toggle), `F f` (picker), `F a` (attachments), `:filter` | Standard | `mailTabs.setQuickFilter` |
| `sort.set {by, order: ascending, descending, toggle}` | `s d`, `s j`, `s f`, `s z`, `s t`, `s a`, `s u`, `s r`, `s p`, `s o`, `s s` (picker), `:sort` | Standard | `mailTabs.update` |
| `pane.toggle {pane: message, folder}` | `w m`, `w f` (the +Panes group) | Standard | `mailTabs.update` |
| `tab.switch`, `tab.next`, `tab.prev`, `tab.close` | `T` and `t T`, `:tab`, `J` and `K` (also `<A-j>`, `<A-k>`, `t n`, `t p`), `t 0` (the first tab), `<C-x>`, `<C-c>`, `q` | Standard | `tabs.*`. `tab.switch` takes a number or a title (a whole title first) and its command line list shows this window's tabs. Phase 0 checks that `tabs.remove` closes the primary mail tab. If it does not, `tab.close` refuses there. Measured: it does not, so `tab.close` refuses there. |
| `mark.set {slot}`, `mark.jump {slot}` | `M <key>`, `' <key>` | Standard | Folder marks in `storage.local`, `mailTabs.update`. Each key is one binding with no `slot` arg. The `slot` param is a `key` param, so `commands/captures.ts` moves the leaf under a capture branch (`capture_branch`) and the key press after `M` or `'` fills it, for any one key. A mark holds the account id and path. `mark.set` is not bridge safe (it writes state). |
| `jump.back`, `jump.forward` | `<C-o>`, `<C-i>` | Standard | Folder history in `storage.local`, `mailTabs.onDisplayedFolderChanged`. Built: one history for all windows, 100 entries, a cursor into it. A jump marks its own display event, which the listener drops, so a jump adds no entry. The folder shown at start is recorded first. With two windows on different folders, `<C-o>` in a window can target the folder that window already shows and then changes nothing. A held chord repeats. Storage key `desertbird_folder_state` (marks and history, versioned, with a migration table). |
| `step.unread {direction, scope: folder, all_folders}` | `] u`, `[ u`, `] U`, `[ U` | Standard | Built. A step in the shown folder reads `app.viewRows` (the list in the order the user sees, unread from the row) and selects the row with `mailTabs.setSelectedMessages`. With `all_folders` and no match left, it reads `folders.getFolderInfo` unread counts (skipping Trash, Junk and virtual folders), takes the next folder that has any, wrapping once, then runs `messages.query` for one unread message with `messagesPerPage: 1`, shows the folder and selects it. A row holds its own message's flags, so an unread reply inside a closed thread is found when the thread opens. See [`thunderbird-behavior.md`](thunderbird-behavior.md), Step keys, for the timings. |
| `step.starred {direction}`, `step.attachment {direction}` | `] s`, `[ s`, `] a`, `[ a` | Standard | Built. The same row walk as `step.unread` with the flags word of `app.viewRows` (starred is bit 0x4, attachment 0x10000000). A count steps that many matches in one pass. |
| `search.threads {query}` | `:search` | Standard | `mailTabs.setQuickFilter` with text |
| `search.open {direction}`, `search.next`, `search.prev` | `/`, `?`, `n`, `N` in the mail tab | Standard | The command line in search mode. `mailTabs.setQuickFilter` per keystroke (debounced, stale answers dropped, the last filter kept in session storage), `app.viewRows` for the count and the stepping. The `/` register is in `storage.local`. Built. Pane-aware: with the folder pane focused, a forward search is `search.folders`. The API cannot read the quick filter, so Escape restores the last filter the add-on set (a hidden empty bar when none). |
| `search.message {query}` | `/` in the message pane, `n`, `N` | Standard | `messageDisplayScripts` find in the body |
| `compose.edit_external` | `e`, `<C-e>`, `:edit` | Standard | `compose.getComposeDetails` and `setComposeDetails`, host `editor_start` and `editor_collect`. Built for plain-text and HTML compose with `<C-e>` and with `e` in compose normal mode (after `<C-o>` or Escape in the body), behind the default-off `external_editor` setting and the `desertbird_host` manifest. HTML goes through Markdown (build order 4). `:edit` exists but refuses outside a compose window, and the command line does not open in compose windows yet. |
| `config.reload`, `help.open` | `:reload`, `:help`, `, h` | Standard | Background, extension page |
| `options.open` | `, s`, `:options` | Standard | Background. `runtime.openOptionsPage()`: the DesertBird options page. |
| `help.whichkey` | `g?`, `, ?` | Standard | Background. The root keys in the which-key panel of the window, until the next key. The panel title is the chain of group names (`+Go » +Pages`, `keys` at the root), and each group has a name from one table in `commands/index.ts`. In a message document `g?` and `, ?` open the help page. The `,` prefix is the leader (group name `DesertBird`): `, h` help, `, s` options, `, ?` the key list. A half-typed prefix in the mail tab or a message tab shows the panel of the message keys, reported by the body script. A standalone message window shows none. |
| `motion.down`, `motion.up` | `j`, `k` | Experiment | Chrome runtime, `view.rows` and `view.select`. The thread list order, with collapsed threads, is only in the view. With the folder pane focused, `j`, `k`, `g g` and `G` move the folder selection instead. |
| `motion.left`, `motion.right` | `h`, `l` | Experiment | `view.thread`, `folder_tree.expand`. Built for the thread list: `h` goes from a reply to its root or closes the thread, `l` opens a closed thread or goes to the first reply. In the folder pane they close and open the selected folder row through `folder_tree.expand`: the handler asks it first and goes on to the thread logic only when the folder pane does not have the focus. |
| `motion.top`, `motion.bottom` | `g g`, `G` | Experiment | Chrome runtime |
| `view.half_page {direction: next, previous}` | `<C-d>`, `<C-u>` | Experiment | `view.rows`. Built in the background: it moves a fixed ten rows from the current row, clamped to the list. A true half page needs the list height, which the key script has no bytes for, and is tracked separately. |
| `view.reposition {position: center, top, bottom}` | `z z`, `z t`, `z b` | Experiment | `view.scroll`. Built. |
| `thread.fold_all {open}` | `z M`, `z R` | Experiment | `view.all_threads`. Built. With the folder pane focused it opens or closes every folder through `folder_tree.expand` with `extent: all`, and tries that first, as `h` and `l` do. |
| `step.thread_root {direction: next, previous}` | `] t`, `[ t` | Experiment | `view.rows` depth. The API gives no thread tree. Built: the background reads rows in blocks of 50 and selects the root with `mailTabs.setSelectedMessages`. |
| `visual.toggle` | `v` | Experiment | Built in the chrome runtime as modal key state: the anchor row. `j`, `k`, `g g` and `G` extend the selection from it. A background command (`a`, `d d`, `m r`, `m s`) reads the range as its selection. One that removes or moves the rows (`a`, `d d`, `m m`) ends the mode. One that leaves the rows in the list (`m r`, `m u`, `m s`, `m j`, registry flag `keeps_selection`) keeps it, so a second command acts on the same range until `v` or Escape. `m t` and `m c` bind `cmdline.open`, which is not tagged, so they open the command line and end the mode. The tag and copy commands keep the range only when a binding fills their argument. `v` again or Escape ends it and keeps the current row. Escape is taken only while the mode is on. The actions stay standard. `msg.move` and `msg.snooze` keep `repeatable: false`. |
| `folder.collapse` | `<S-h>` | Experiment | `folder_tree.expand` with `extent: parent`, then `pane.focus`. Built. In the folder pane it closes the selected folder, or else closes its parent and selects that. From any other pane it focuses the folder pane, so the chord below keeps its meaning. It focuses the pane too when the folder script is missing or fails. |
| `pane.focus {pane}` | `g f`, `g e`, `g m`, `<S-h>` (message document only), `<A-h>`, `<S-l>`, `<A-l>` | Experiment | `pane.focus`. Built. The chords name a pane, not a direction: `<S-h>` the folder pane, `<A-h>` and `<S-l>` the thread list, `<A-l>` the message pane. `g f`, `g e` and the four chords also bind in the message document, because the body script takes every key while the message pane has the focus. A hidden pane, or a message pane with no message, is refused with a toast. |
| `pane.left`, `pane.right` | none | Experiment | `pane.focus` with `left` or `right`. Built: the pane beside the focused one in the order folders, threads, message. It stops at the ends with no toast, and a hidden pane counts as an end. No default key: the chords above name panes. |
| `search.folders {query}` | `/` in the folder pane | Experiment | `folder_tree.focused`. Built, as the folder kind of `search.open`, in `search/folder_search.ts`. The key map has no per-pane binding, and that is solved in the handler: `search.open` asks `folderpane.focused` and a forward search with the folder pane focused searches folder names. `?` stays a thread search. The line is the command line in search mode. The query is a case-insensitive substring of the folder name (the last path segment), matched in the background over every folder from `folders.query`, in tree order, closed parents included. Typing moves nothing and only counts the matches. Enter selects the first match, opens it and keeps the focus in the folder pane. `n` and `N` step the matches and wrap, and refuse outside the folder pane. Escape leaves the folder that was selected before the line opened. The `/` register holds a `kind` (`threads` or `folders`), so `n` and `N` know which list to step. |
| `msg.undo` | `u` (also in a message), `:undo` | Standard | DesertBird's own undo log: `messages.query` by Message-ID, `messages.move`, `messages.update`. Built, `repeatable: false` and `bridge: false`. Thunderbird records no undo step for an API change (see [`thunderbird-behavior.md`](thunderbird-behavior.md), Panes, undo and pages), so `msg.delete`, `msg.archive` and `msg.move` record the Message-ID, the origin folder and the destination of each message, and `msg.read`, `msg.flag` and `msg.junk` record the old value, `msg.tag` records the toggled tag key and whether each message had it. `u` takes the newest entry and moves each message back, or writes the old value back. One stack serves every window, keeps the newest 20 entries and lives in `storage.local` under `desertbird_undo`. Undo only moves a message back and never deletes. It searches only the destination (Trash, every Archives folder with its subfolders, or the folder of the move), and tells copies that share a Message-ID apart by the Date header and the size it recorded. A message it cannot find is looked up again three times over three seconds, for an IMAP server that has not synced the copy yet. This wait does not hold the log, so `a` and `d d` run meanwhile. Then `u` refuses with a toast, moves nothing and marks the entry. The next `u` on a marked entry looks once more, moves back what it finds, drops the rest with a toast, and leaves the older entries free. A message with no Message-ID, and a delete from Trash, which is for good, record nothing and warn. Snooze, `folder.read_all` and changes made in Thunderbird itself are not undone. A tag undo writes back only the toggled tag, from the tags the message has now. It puts back a tag only while the tag still exists, else the step keeps that message and says why. There is no redo. |
| `thread.open_conversation` | `g C` (also in a message) | Experiment | `app.command cmd_openConversation`. Built. Thunderbird enables the command only for a message in its search index. Otherwise it refuses with a message. |
| `app.open_page {page}` | `g p a`, `g p t`, `g p c` | Experiment | `app.open_page`. Built. |
| `hint.window {action}`, `hint.pick {action}` | `f`, `; f`, `; c`, `; y`, `:hint` | Experiment in chrome (`hint.window`), standard in the message body (`hint.pick`) | `hint.window`: `hints.pick`. `action` is `activate` (default), `focus` or `yank`. `f` is `activate`, so `f` and `; c` do the same. `;` is a prefix of three leaves, `; f` (`focus`), `; c` (`activate`) and `; y` (`yank`), so which-key lists them after `;` and a user can rebind each. In the mail window `; ;` opens the command line on `hint `, where `hint` (the typed name of `hint.window`) takes the action as a flag, for example `hint --yank`. Focus focuses a button, tab or field, and selects a folder or thread row as a pick does. Yank copies the target's `href` when it has one, else its trimmed text (the folder name, the subject cell of a thread row). A target with no value gets no label. A `yank` with no value on screen refuses like an empty pick. The text goes to the clipboard through `nsIClipboardHelper` in the parent, when the label completes, because the label is typed inside the Experiment and the background cannot wait for that key. `hint.pick`: the body script. The same actions and letters as `hint.window`, over the links, buttons and fields of the message. Yank copies the link address, else the trimmed text, and sends it as `body.yank` to the background, which writes it with the clipboard handler of `msg.yank`. The compose script has no hints and is not changed. |
| Key capture, counts, `.`, modes, `<Esc>` | `0`-`9`, `.`, `esc` | Experiment | Chrome runtime. `.` replays the last motion or background command from runtime memory. A command with `repeatable: false` (`msg.move`, `msg.snooze`, `msg.remind`, `msg.remind_cancel`, `msg.undo` and `cmdline.open`, among others) clears it instead |
| Command line, which-key, toasts | `:` | Experiment for the mount only | `overlay.mount`. The page itself is a normal extension page. |
| Mode label | none | Experiment | `overlay.setModeLabel`. The background tells it the mode and the settings. It is an element of the status bar and no page. |

The table has 42 rows. 27 run without the Experiment (26 Standard and one Standard if fast enough). 15 need it (13 Experiment and two mixed rows, hints and the overlay mount). The Experiment carries key capture, the thread view and focus.

## Decisions

- ESR floor: 153 ESR, so `strict_min_version` is 153.0. ESR 128 is end of life, Betterbird retired its 140 line, and each extra base costs a test run on the chrome verbs. Revisit when a user on an older ESR asks.
- HTML compose conversion: a vendored `marked` (Markdown to HTML) and `turndown` (HTML to Markdown), both MIT. This needs no pandoc install and no host verb that spawns a process. The editor itself still needs the host. Revisit if the quote split (see build order 4) still loses structure.
- Bridge socket: built before the first listing, so the first listing asks for `nativeMessaging` once. The bridge is the DesertFox bridge host and socket. It is off by default behind the `bridge` setting and gives the mode in the bar, `run` from outside and the CLI verbs. The add-on side, its never-list and its frames are in [`src/background/bridge/README.md`](../src/background/bridge/README.md). `test/registry.test.ts` holds the audited set of `bridge: true` commands. Reads (folders, headers, bodies, attachment names) each sit behind their own default-off share setting, checked in the add-on at each request. A body leaves only as cleaned text marked untrusted, and an encrypted body never leaves. The table of read frames is in the same README. A `draft` frame sits behind its own default-off `bridge_allow_drafts` setting. It saves a plain-text draft to Drafts through a compose window that it closes again, and answers only ok or a fixed refusal. The add-on never sends: it holds `compose.save` and not `compose.send`. An `act` frame (archive, trash, move) sits behind its own default-off `bridge_allow_actions` setting and moves nothing until the person presses `y` on a prompt in the Thunderbird window. It runs the key handlers, so `u` reverses it, and trash never deletes for good. Every command states `bridge`. It is true only for a command that moves the view or the selection and does no harm doing so (`motion.*`). In v1 the bridge still refuses the chrome and message-pane commands, `motion.*` among them, because the background has no verb to start them. It is false for anything that changes mail, sends, discloses data or is hard to undo (`msg.*`).
- Phase 2 scope: `step.*` is deferred, and the typed-value commands listed in build order 2 get default keys with the phase 3 command line. The keymap matches a chord only when it binds that chord. The alt chords (`<A-h>`, `<A-l>`) stay out of phase 2, because the motions that use them are out of it.
- `downloads` is a required permission, for the same reason: an add-on with an Experiment cannot use optional permissions. Only `msg.save_attachments` uses it.
- `nativeMessaging` is a required permission, because an add-on with an Experiment cannot use optional permissions. The host itself stays optional. A command that needs it refuses with a message when it is missing.

## Store rules

The rules of addons.thunderbird.net shape the build:

- An add-on with an Experiment gets a manual review, so the split table stays the evidence that the Experiment does only what no standard API does.
- Third-party libraries (`marked`, `turndown`) ship as the exact release files in a vendor folder, listed in `VENDOR.md` or `package.json`. They load beside the esbuild bundle and never go into it, so the store can match them against the release.
- A build that bundles our own code needs a source archive with build instructions and a lockfile, and `npm ci` must work.
- The Experiment bundle stays unminified, so the reviewer reads what ships. It is built with esbuild because the chrome runtime reuses the core key matcher.

## Reuse from DesertFox

These parts carry over with few changes:

- `define`, the define-time checks and `check_args`.
- The command line parser, the printer and completion.
- The key notation and the prefix tree compiler.
- The which-key panel, toasts, the mode label and themes. The 16 Oasis themes are in: the `theme` setting picks one, the background publishes its role colors to `storage.local`, and the hud, the command line and the options page read them as `--desertfox-*` tokens. Thunderbird tells its own color scheme to the pages and to the window, and the background page sees only the OS scheme (measured), so the background sends both schemes and the pages and the label pick.
- The TOML config and its merge.
- The `commands.json` build and help generation.
- The native host verbs `read_config`, `editor_start` and `editor_collect`.

New work: the Thunderbird commands, the chrome runtime and verbs, a `thunderbird-behavior.md` of measured facts, and the HTML compose round trip.

The e2e timing capture (`tools/e2e/timings.mjs`) is a new small file, not a copy of the DesertFox one. That one is built around cases, categories and wrapped debugger calls, which the e2e has none of, and its piece timer does not nest a kind piece around section pieces. It writes the same report shape (`pieces`, `cases`, `categories`), so the later weights and merge code read it as it is. The memory sampler and the startup stamps have no DesertFox counterpart.

## Keys on a page of another process

DesertFox takes plain keys on web pages through a content script and has none on `about:` pages. A remote page in Thunderbird is out of reach of the chrome runtime, and the setups that load key files into the main window passed plain keys aimed at a `browser` untouched, so only chords ran there.

Departure, step 1: when a tab comes to the front, its browser is remote and the focus sits on the window body or the tab strip, the overlay Experiment (`src/chrome/page_focus.ts`) focuses that browser after a tick. The page's own script then runs `j` and `q` on the options and help pages with no click. Any other focused element stays. The code lives in the overlay bundle because the key runtime has no size to spare.

## Keys in the other tabs

DesertFox has one content script per web page. Thunderbird draws its tabs (calendar, tasks, settings, the address book, `about:` pages, search results, chat) in chrome documents and parent-process pages that no content script reaches. The `pages` Experiment (`experiment/pages.js`, `src/chrome/page_runtime.ts`) takes their keys. Departures from DesertFox, each with its reason:

- The page keys run in a bundle of their own on the window root, where DesertFox has one `content.js`. The size guard of `keys.js` was full, and the admission rule keeps this code out of it. `hints.js` is the precedent for a bundle that listens on the window root. It sees a key before the key runtime and steps aside in the mail tab, so the two never take the same key.
- A decision by focus (`src/chrome/readable_focus.ts`) where DesertFox has no decision. A tab is readable when its document is a chrome document or a parent-process document. It is out of reach when the focus chain ends in a browser whose document the walk cannot enter, or when nothing in the tab has the focus and the front tab's browser is remote. Only the close chord runs there, because the chrome cannot see a text field inside such a page. A text field or an open menu passes every key.
- The scroll target is the nearest scrollable ancestor of the focused element, else the scrolling element of its document, else, when that does not scroll, the largest visible scrollable element of the document, or of the front tab's panel in the window document (the settings tab scrolls inside a pane the focused sidebar button is not part of). DesertFox adds a site selector and always scans for the largest box. The chrome documents are known and there are no site rules here, and the scan runs only when the root does not scroll.
- No smooth scroll and no insert mode `i`. The page actor of a later step owns pages that draw their own editors.
- The hold after a command that opens the overlay and the end report of the key list are copies of the mail runtime's, because the two bundles share no state.
- A key the page keymap leaves unbound passes to Thunderbird. DesertFox cancels unbound keys in some modes.
- The page keys are not a table of their own. Each command names what a tab must offer in `needs` (`list`, `message`, `body`, `tab`, beside the Experiment verbs), and `src/background/commands/tab_keymaps.ts` cuts the one keymap for each tab kind: a tab gets the keys of the commands it can serve, and the rest reach Thunderbird. DesertFox has the same field with other values (`content` and permission names). `needs` stays a string list, so the vendored type carries them. The reading keys a tab with no body script scrolls with are `page_keys` in the `page` group. A user binding goes into every tree its command allows, and `tab.close_mail` needs the list, so Ctrl+C and Ctrl+X still copy and cut.
- `J`, `K`, `<A-j>`, `<A-k>` and the `t` group (+Tabs) switch tabs in these tabs, `T`, `, h`, `, s`, `, ?` and `c` work there, and `g p a`, `g p t` and `g p c` open the add-ons, themes and config pages. Ctrl+J (Saved Files) and Ctrl+K (quick search) are Thunderbird's own, since DesertBird binds neither.
- A message tab with the focus outside the body (in the header or on the tab strip) takes the message tree, so `d`, `a`, `r` and the reading keys work there, run on the message the tab shows. Find in the message and the hint picks do nothing there, because they need the body script. A plain key with no binding is cancelled in that tab, so Thunderbird's single keys such as `j` (junk) cannot fire. The body script keeps the keys while the body has the focus.
- `j` and `k` scroll a focused list that has its own selection (the address book's books and cards) and do not move its selection.
- The key list (`g ?`) still shows the mail keys. A which-key panel of the page keys is a later step.

## Build order

0. Measure on the target Thunderbird ESR and on Betterbird, and write `thunderbird-behavior.md`. Capture plain keys in `about:3pane` from the Experiment, and cancel Thunderbird's own single-key shortcuts (`a`, `j`, `f` and others) in normal mode. Take keys in the message pane through `messageDisplayScripts`. Mount an extension page overlay in the chrome window. Time the round trip from the chrome runtime to the background and back. Check that each standard row in the table exists on the target ESR. Find the native host manifest folders for Thunderbird and Betterbird, which are unverified. Check that Betterbird is at 153.2.0 or later for `filter.set` and `search.threads`. Check that `tabs.create` works from a compose window, for `help.open`. This phase needs no shared core.
1. Move the shared core into `packages/core` in the DesertFox repo and point DesertBird at it. Then set up the skeleton: the manifest, the Experiment with `keys.*` and `view.*`, and the registry with the motions and message actions.
2. Port the standard commands, group by group, in table order. `step.*` is not part of this phase: it waits for the later Experiment rows piece (`view.rows`), which also serves `motion.left`, `motion.right` and `step.thread_root`. Commands that need a typed or picked value (`msg.tag`, `msg.move`, `folder.open` with `o`, `tab.switch`, `filter.set` with a tag, `search.threads` and `sort.set`) ship their handlers and validators in this phase. Their default keys arrive with the command line in phase 3.
3. Command line, which-key and hints.
4. Compose: insert mode, `<C-o>` and the external editor through the host. Built: insert mode while the body has focus, and `<C-o>` or Escape for one normal-mode key. In that key `e` edits and any other key passes. Normal mode is that one key only. Keys outside the body are not caught, since that needs the chrome runtime. All of it is off while the `external_editor` setting is off, `<C-e>` aside. The compose script draws a mode label as an adopted style sheet on `html::after`. The label is never a node, because a node reaches a saved draft, and it hides while the body has no focus. HTML compose converts in both directions in the add-on, in the background page. Only the part the user wrote converts. That part is the top-level nodes that are not stop nodes (`moz-cite-prefix`, `blockquote[type=cite]`, `moz-signature`, `moz-forward-container`). They sit above the quote in a top-posted reply and below it in a bottom-posted reply, which is the Thunderbird default. The edited text goes back in the same place. A reply with user text on both sides of the quote is refused with a message. `turndown` turns that part into Markdown for `editor_start`. `marked` turns the edited Markdown back into HTML. The quote and signature nodes go back untouched, so cite quoting and tables survive. Both directions escape HTML, so tag text in a quoted message never becomes a live tag. `setComposeDetails` runs only when the Markdown changed. Parse with `DOMParser` and never set `innerHTML`. Test the round trip on top-posted, bottom-posted, forwarded and no-quote replies. Built in `src/background/compose_markdown.ts`. With nothing written yet, the text replaces the blank line Thunderbird put the cursor on: the first node after the quote in a bottom-posted reply, else the first node of the first blank run. The HTML from `marked` is rebuilt node by node from an allowlist of elements and attributes, with links limited to `http`, `https` and `mailto` and images to `http`, `https` and raster `data:` URLs, so Markdown the user writes cannot add a script, an event handler or a stop node. The libraries load before `background.js` from the manifest, so they cost the startup of the background page about 80 KB of script even with the editor off.
5. Migration notes for users who load key files through an autoconfig file.
6. Listing on addons.thunderbird.net, with the Experiment code open to a by-hand review.

## Bundle size guards

The build fails when a bundle passes its guard (`tools/build.mjs`). Each guard has a ceiling that the build and `test/build.test.ts` also enforce. The rules are in `AGENTS.md`. This section keeps the history of each guard. Sizes are minified bytes.

| Bundle | Guard | Ceiling |
| --- | --- | --- |
| `experiment/keys.js` | 22844 | 40960 |
| `experiment/overlay.js` | 27212 | 40960 |
| `experiment/app.js` | 8549 | 12288 |
| `experiment/folderpane.js` | 5900 | 10240 |
| `content/message_display.js` | 18162 | 24576 |
| `experiment/hints.js` | 13050 | 20480 |
| `experiment/pages.js` | 22800 | 34816 |
| `content/page_keys.js` | 21400 | 32768 |
| `content/compose_keys.js` | 3500 | 8192 |

The ceilings are provisional, about 1.5 times the guard of the day they were set (2026-11-18). A guard rises in steps of 512 bytes. The guards above predate that step and are not multiples of it, so the step applies to later raises only.

### Chrome runtime (`keys.js`, and `overlay.js` to the point it parted)

The first measured size of `keys.js` as its own bundle was 15003 bytes. That plus 20 percent made 18004. Later raises:

- The reading-pane handoff to the body script added 372 bytes. The guard rose to 18004 plus 372 rounded up to 18400.
- The thread verbs of the view API took the build from 18358 on main to 20501. The guard rose to 18400 plus 2143 rounded up to 20600.
- Visual mode and the row flags took it from 20501 on main to 21451 (950 bytes). The guard rose to 20600 plus 950 rounded up to 21600.
- Ending visual mode when the list changes under it, and collapsing the range after a command (a stale range: the end row and view the mode last set), made it 21785. The guard was 20600 plus 1284 rounded up to 21900.
- Checking the message keys at both ends of the range made it 21996 (1495 bytes over main). The guard was 20600 plus 1495 rounded up to 22100.
- The report of the typed prefix for which-key added 305 bytes. The guard was 22100 plus 305 rounded up to 22500.
- The folder row, pane focus, command and page verbs made it 24085 (1784 over main's 22301). The guard was 22500 plus 1784 rounded up to 24300.
- The report of visual mode to the mode label made it 24374 (289 over main). The guard was 24300 plus 289 rounded up to 24600.
- Pane focus by chord and left or right, and the motions in the folder pane, made it 25492 (1118 over main's 24374). The guard was 24600 plus 1118 rounded up to 25800.
- Keys for the calendar, address book and settings tabs and a close chord on web page tabs made it 25936 (921 over main's 25015). The guard was that measured size rounded up to 26000.
- Skipping a leaf with args and holding plain keys after the command line opens made it 26040 (1025 over main). The guard was that measured size rounded up to 26100.
- The key list command (`help.whichkey`, with the report that ends its panel on the next key) made it 26238 (198 over main). The guard was that measured size rounded up to 26300.
- Running the conversation command through the controller of the page that shows the message (a message tab or window as well as the mail tab) made it 26992 (722 over main's 26270). The guard was that measured size rounded up to 27000.
- Backspace in an open which-key (the back step in `matcher_for_tree`, clause: decides what happens to a key) made it 27441 (449 over main's 26992). The guard rose by one 512-byte step to 27512. The body bundles grew by 449 and stay under their guard.
- The keys of the other tabs moved to `experiment/pages.js` (the branch on the tab kind, the list of page commands and the three-way tab check) and took it from 27451 on main to 26625 (826 under). The guard fell to that measured size rounded up to 26700. The room freed is not a reserve: growth fails the build.
- Dropping plain keys while the focus sits in the overlay browser before its page is ready (a key could reach the thread list after the hold timer ran out; clause: decides what happens to a key) made it 26987 (362 over main's 26625). The guard rose by one 512-byte step to 27212, under the 40960 ceiling.

### Backspace in an open which-key

Backspace drops the last key of a half-typed sequence, as in DesertFox (`key_flow.ts`: reset, type the kept keys again, report the shorter prefix, cancel the key). Departures:

- DesertFox does it in its key flow. DesertBird has three key flows (chrome runtime, message body script, own pages), so the step is in `matcher_for_tree` (`src/shared/keymap_tree.ts`), a wrapper around the pinned matcher. The vendored matcher is not edited.
- The wrapper keeps the last pending result and takes `keys` from it, as DesertFox does. It needs no list of its own.
- It answers with the pending result of the shorter prefix (an empty one when no key is left) and adds no `back` result kind. Callers already cancel a pending key and report its prefix, so no caller changes, which saves the bytes that a `back` branch in each caller costs in `keys.js`.
- Backspace with nothing pending is an ordinary key and goes to Thunderbird.

### Pages bundle

`experiment/pages.js` (the `pages` Experiment) holds the key runtime of every tab that is not the mail tab. Its first measured size was 18982 bytes. That plus 20 percent made 22779, rounded up to 22800. The bundle carries its own copy of the vendored matcher and key token code, which `keys.js` holds too, because Experiment scopes share no modules. The ceiling is 1.5 times the guard rounded up to 1024. The sizes of these two guards are bytes of the unminified bundle, as the build writes it. The planning estimate of 4.5 to 7 KB assumed a minified build.

### Own page script bundle

`content/page_keys.js` runs the message key script on the own pages (options, help). It had no guard. Its first guarded size was 17754 unminified bytes, measured on the rebased branch (PR 94 had grown the shared matcher). That plus 20 percent made 21305, rounded up to 21400. The ceiling is 1.5 times the guard rounded up to 1024.

### App bundle

`experiment/app.js` is the Experiment API `app`. It holds the thread list verbs (`viewRows`, `viewThread`, `viewAllThreads`, `viewScroll`) and the pane focus, command and page verbs (`paneFocus`, `appCommand`, `appOpenPage`). They had grown `keys.js` by about 6 KB of its 9 KB rise since the first guard, and the admission rule keeps them out: no key waits on them. Thunderbird loads the script on the first call, so the first verb after startup waits for one load, and the verbs that follow do not. Moving them took `keys.js` from 26987 on main to 22332 (4655 under) and gave `app.js` 8037 bytes. `keys.js` took its own guard, `KEYS_MAX_BYTES`, at its measured size plus one 512-byte step: 22844. `overlay.js` keeps `PARENT_MAX_BYTES` (27212), which `keys.js` shared until now. The `app.js` guard is its first measured size plus one 512-byte step: 8549, with a ceiling of 12288. `test/build.test.ts` fails when `app_verbs.ts`, `view_verbs.ts` or `parent_app.ts` enter the `keys.js` inputs, so a verb cannot grow the key script again without a test failing first.

### Folder pane bundle

`experiment/folderpane.js` is the Experiment API `folderpane`. It holds the verbs that read or change the folder tree. Thunderbird loads an Experiment script on the first call to its API, so these verbs cost the startup script nothing. Its first measured size was 4891 bytes. That plus 20 percent made 5869, rounded up to 5900. It has had no raise.

### Body script bundle

`content/message_display.js` is injected into every message document. Its first measured size was 8861 bytes. That plus 20 percent made 10633. Later raises:

- Find in the message and hint labels took it from 8984 to 14558 (5574 bytes). The guard was 14558 rounded up to 14600.
- The hint fixes (a visibility check, a shadow root for the labels, ending the labels on scroll and blur, and a focus pick with Enter left to Thunderbird) added 1321, making 15879. The guard rose to 15900.
- The injectable pick action, so the own pages can click a picked element by script, made it 15927. The guard was that rounded up to 15950.
- Drawing the labels in the theme made it 16028.
- Reading the published label colors as literal declarations, so a mail cannot recolor them, made it 16177. The guard was that rounded up to 16200.
- Reporting the typed prefix to the background for which-key in a message made it 16562 (385 over main's 16177). The guard was that rounded up to 16600.
- The `;` action step (a phase before the labels, the focus, activate and yank actions and the yank message to the background) made it 17601 (1039 over main). The guard rose to that rounded up to 17650.
- Dropping the phase before the labels (`; f`, `; c` and `; y` became keys of the tree) made it 17128 (473 under the guard). The guard stays at 17650.
- Backspace in an open which-key (the back step in `matcher_for_tree`, clause: decides what happens to a key) made it 17733 once merged with main (459 over main's 17274). The guard rose by one 512-byte step to 18162.

### Hints bundle

`experiment/hints.js` (the `hints` Experiment) is its own bundle, not chrome runtime code. It holds `sendEnter` and `pick` and nothing from the key runtime. The keys of a pick stay out of `experiment/keys.js` on purpose: the bundle takes them on the window root, ahead of the key runtime, so the runtime needed no change. Its first measured size was 3091 bytes. That plus 20 percent made 3709, rounded up to 3800. Later raises:

- The check that the focus still sits on the picked link made it 3863. The guard was 3800 plus 63 rounded up to 3900.
- The `pick` verb for the mail window (targets, labels in each chrome document, the typed label and the act) made it 11670. The guard was that rounded up to 11700.
- The `;` action step (the action phase, a focus and a text per target, and the clipboard write in the parent) made it 12994 (1324 over main's 11670). The guard was that rounded up to 13000.
- The card view subject lookup made it 13004 (4 over that). The guard rose to 13004 rounded up to 13050.
- Dropping the action phase made it 12507 (497 under the guard). The guard stays at 13050.

### Compose script bundle

`content/compose_keys.js` is registered with `composeScripts.register` into every compose body. It takes Ctrl+E, Ctrl+O and `e` after Ctrl+O or Escape, and nothing else. Escape itself passes to Thunderbird. Its first measured size was 717 bytes. That plus 20 percent made 861, rounded up to 900. Later raises:

- The modes (insert and normal, Ctrl+O, Escape and `e`) and the label drawn by the script made it 2516 (1799 over main).
- Hiding the label while the body has no focus made it 2571 (1854 over main). The guard was that rounded up to 2600.
- Reading the `external_editor` setting from storage and following its changes, so the modes and the label stay off while it is off, made it 3492 (921 over that). The guard is that rounded up to 3500.

## Risks

- An Experiment breaks when Thunderbird internals change between ESR releases. The fixed verb table keeps the breakage in one small file, and the key tests catch it.
- addons.thunderbird.net reviews Experiment code by hand, and the review can be slow. The no-eval rule removes the main ground for a refusal.
- Betterbird patches the thread pane (for example its multi-line view). `view.rows` needs a test on both apps.
- Thunderbird has single-key shortcuts of its own. A key the chrome runtime does not cancel runs both actions.
- If the round trip from chrome to background is slow, held `j` lags. That is why the motions run in the chrome runtime.

## Phase 0 findings

Phase 0 ran on Thunderbird 153.7.0 ESR and Betterbird 153.7.0, with the same result on both. The numbers and the method are in [`thunderbird-behavior.md`](thunderbird-behavior.md). The design decisions above stand. Where a measured fact differs from the text, the text carries a note and the fact is listed here.

- Overlay mount: the overlay is a remote `browser` element that the Experiment creates in a chrome document, in the main window or inside `about:3pane`. It loads the extension page with the extension APIs and takes keys. An extension-page iframe in `about:3pane` never loads. The chrome runtime must skip keys that the overlay has focus for.
- `step.unread` across folders: `messages.query({unread: true})` over all folders takes about 1.1 s on 5,000 messages, so it does not run per key. The command reads the unread counts with `folders.getFolderInfo` (about 21 ms for 50 folders), picks the next folder with unread mail, then queries that one folder for one result (`messagesPerPage: 1`). In the shown folder it reads `app.viewRows`, which needs no query and follows the sort. It stays in the background. The timings on a folder of 10,000 messages are in [`thunderbird-behavior.md`](thunderbird-behavior.md), Step keys and visual mode.
- Collapsed threads: `mailTabs.setSelectedMessages` on a message inside a collapsed thread selects it and opens the thread.
- `tabs.remove` on the primary mail tab is a no-op, also when it is the only tab. `tab.close` does not call it there: it moves the focus to the thread list, so `q` leaves a message in the reading pane. In a message window it removes the window.
- Mail keys in a message: the reading pane, a message tab and a message window run the mail keys of the message groups (`messages`, `compose`, `clipboard`, `followup`, `snooze`, `tabs`, `cmdline`) on the displayed message, through the body script and `body.invoke`. Keys that need the thread list or the mail tab stay out.
- `messages.tags.list` needs the `messagesTagsList` permission. `commands`, `menus` and `addressBooks` calls need their own permission or key too. There is no `messenger.clipboard`.
- Plain keys: a capture listener on the top window sees plain keys in the thread list, the message pane, a message tab and a message window, and cancels each Thunderbird single-key shortcut that acts there. In all four contexts that covers `m`, `s`, `j` and `a`. On the thread list only, `f`, `b`, `n`, `p`, `1` and `Enter` were measured and cancelled. `r` and `R` do nothing by default in any context. Chords were measured, see "Cancelling Thunderbird's chords" in [`thunderbird-behavior.md`](thunderbird-behavior.md). Key repeat and other tab types were not measured, see "Not measured" there. The first press after a focus change can be lost.
- Message pane: for local mail the message body browser is not remote, so a chrome listener sees its keys. This differs from the Architecture row for `messageDisplayScripts`. The decision stands until feed, IMAP and remote content are measured.
- Round trip: a key reaches the background in under 1 ms, so the chrome runtime can send finished invocations to the background. The motions stay in the chrome runtime by decision. Held keys were not timed.
- Native host manifests: both apps read only `~/.mozilla/native-messaging-hosts/` in the user folders. The system folders were not tested.
- Two traps: `compose.beginReply` crashes the app when the account has no identity, and `mailTabs.update` with a displayed folder throws on the first display of a folder though the folder displays.
- Betterbird at 153.7.0 passes the `filter.set` and `search.threads` checks.

Phase 0 answered both former open questions:

- The overlay mounts as a remote `browser` element in a chrome document, not as an iframe of an extension page in `about:3pane` and not as a sized panel.
- `step.unread` across all folders uses the folder counts and one single-result query, so a key press stays under half a second on 50 folders and a folder of 10,000 messages. It stays in the background.

The e2e startup ready signal (`wait_startup` in `tools/e2e/harness.mjs`) starts from the DesertFox key test (`wait_takes_keys` in `test/key/harness.mjs`) and departs from it in these ways. DesertFox probes with an unbound key (`F4`) that the page reports to its server. DesertBird takes no test hook in `src/`, so no page reports a key. The probe is a bound key, `w m`, and the helper add-on reads its effect on the message pane. A bound key has an effect, so the probe restores the pane and waits until it has held its first value for 1.5 s with no press in flight, because a slow key can land after a later press. DesertFox has no state to restore. Each probe try waits 1500 ms for the flip, where DesertFox waits 200 ms (`KEY_PROBE_TRY_MS`). The flip comes from a poll of the helper, which costs more than a page report, and a shorter wait presses a second toggle before the first lands. The probe shares the one ceiling `E2E_STARTUP_MS` with the helper wait, where DesertFox has its own probe timeout. There is no retry count. Escape goes before `w m` so a lone `w` cannot pair with the next try. A start with no helper add-on keeps the fixed wait, because there is nothing to ask.
