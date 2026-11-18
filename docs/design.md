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
| `composeScripts` | `content.js` in a field | Insert mode, `<C-o>` and hints inside the compose body |
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
- `view.rows {first, last}`: built as `keys.viewRows`, with `keys.viewThread`, `keys.viewAllThreads` and `keys.viewScroll` for the three below, so no second Experiment bundle is needed. `viewRows` also returns the current row. The visible thread rows with index, message id, depth, collapsed, unread and the message flags word. `view.select {anchor, end}`, `view.scroll {row, position}`, `view.thread {row, open}` and `view.all_threads {open}`.
- `folder_tree.expand {open, extent}`: built as `folderpane.fold`, in the on-demand `folderpane` API. `extent` is `row` (the selected row, for `h` and `l`), `all` (`z M`, `z R`) or `parent` (`H`). It answers false, doing nothing, unless the folder pane has the focus, which is how `h`, `l`, `z M`, `z R` and `H` tell the two panes apart. A failed load of its script leaves `h`, `l`, `z M` and `z R` acting on the thread list. It takes no folder because the selected row is the cursor. `folder_tree.select {folder}` waits for `search.folders`.
- `pane.focus {pane}`: built as `keys.paneFocus`, where pane is `folders`, `threads`, `message`, or `left` and `right` for the pane beside the focused one. It answers false, leaving the focus where it was, when the target is a collapsed pane, a message pane with no live body script, or past an end.
- `app.command {name}`: built as `keys.appCommand`. One name from a fixed allowlist of Thunderbird commands, now only `cmd_openConversation`. It answers false when Thunderbird has the command disabled. Never a free string.
- `app.open_page {page}`: built as `keys.appOpenPage`. One key of a fixed table (`addons`, `themes`, `config`), never a URL. The counterpart of the DesertFox host verb `open_firefox_page`.
- `hints.sendEnter {windowId}`: built, in its own bundle. A trusted Enter key press (the key is fixed, no text) in the window, for the link a hint pick in a message focused. A script `click()` skips Thunderbird's check for a link that lies about its address, so the body script asks for a real key instead.
- `hints.collect {docs}` and `hints.act {id, action}`: hint targets in the chrome documents, not built yet. The message and compose content scripts hold their own hints.
- `overlay.mount` and `overlay.unmount`: the extension page that draws the command line, which-key and toasts in the chrome window.
- `overlay.setModeLabel`: the mode label at the start of the status bar. The args are a window id, three enums (the mode, the `mode_indicator` setting and the `mode_indicator_style` setting) and the label colors as `#rrggbb` for both color schemes. The parent owns the text and picks the scheme Thunderbird shows in the window. The Experiment draws it because a page cannot sit inside the status bar. It reads the focus itself for insert mode, since the key runtime does not track insert.

## Split table

"Standard" means the command runs in the background (or a content script) on MailExtension APIs only. "Experiment" means it needs the chrome runtime or a chrome verb. Each standard row is checked against the target ESR.

| Command (proposed id) | Default keys | Side | How |
| --- | --- | --- | --- |
| `msg.read {state: read, unread, toggle}` | `m r`, `m u` | Standard | `messages.update` |
| `folder.read_all` | `m R` | Standard | `folders.markAsRead` |
| `msg.flag` | `m s` | Standard | `messages.update` |
| `msg.junk` | `m j` | Standard | `messages.update` |
| `msg.tag {tag}` | `m t`, `:tag` | Standard | `messages.update`, `messages.tags.list`. It toggles: the first selected message decides whether the tag goes on or off every message, as for the star. `u` undoes it: the entry holds, per message that changed, the one tag key and whether the message had it, so the undo touches only that tag. |
| `msg.move {folder, account}` | `m m`, `m p`, `:move` | Standard | `messages.move`, `folders.query`, `accounts.list`. The folder is looked up in the account `--account` names, else in the one account the selection shares |
| `msg.copy {folder, account}` | `m c`, `:copy` | Standard | `messages.copy`, `folders.query`, `accounts.list`. The same lookup as `msg.move`. The originals stay, so it records no undo item |
| `msg.remind {after: one_day, three_days, one_week}`, `msg.remind_cancel` | `m f d`, `m f t`, `m f w`, `m f c` | Standard | `messages.get`, `messages.query`, `messages.getHeaders`, `messages.update`, `messages.tags.list`, `messages.tags.create`, `folders.query`, `notifications`, `messageDisplay.open`, `alarms`. A reminder on a message, checked when due: a later Inbox or Archives message (subfolders included) that names the anchor in `References` or `In-Reply-To` cancels it. Otherwise the anchor gets the `Follow up` tag and a notification that opens it on click. Items live in `storage.local`. |
| `msg.snooze {until: later_today, tomorrow, weekend, monday}` | `m z l`, `m z t`, `m z w`, `m z m` | Standard | `messages.get`, `folders.query`, `folders.create`, `accounts.list`, `messages.move`, `messages.query`, `messages.update`, `alarms`. The message waits in a `Snoozed` folder of its own account (Local Folders when the account cannot hold subfolders) and the snoozed items live in `storage.local`. |
| `msg.archive` | `x`, `:archive` | Standard | `messages.archive`. A count archives that many rows from the current one (`keys.viewRows`), and `.` repeats it. `u` undoes it. |
| `msg.delete` | `d d`, `:delete` | Standard | `messages.delete`. A count deletes that many rows from the current one (`keys.viewRows`), and `.` repeats it. A count refuses when the current row is no longer one the key selected, or when the rows it reaches hold a closed thread. `u` undoes it. |
| `msg.reply {to: sender, all, list}` | `r`, `R` | Standard | `compose.beginReply` |
| `msg.reply_with {slot: 1 to 9}` | `g r 1` to `g r 9` | Standard | `compose.beginReply`, `compose.getComposeDetails`, `compose.setComposeDetails` |
| `msg.forward` | `g F` | Standard | `compose.beginForward` |
| `msg.new` | `c` | Standard | `compose.beginNew` |
| `msg.unsubscribe` | `g u` | Standard | `messages.getFull`, `windows.openDefaultBrowser`, `compose.beginNew`, `storage.local`. Two presses: a preview notification, then the action within 15 seconds. https opens in the browser, mailto opens a draft. It sends nothing and has no new permission |
| `msg.open` | `<C-l>` | Standard | `messageDisplay.open` |
| `msg.yank {field: content, subject, sender, address, message_id}` | `y y`, `y s`, `y f`, `y a`, `y i` | Standard | `messages.get`, `messages.getFull`, `navigator.clipboard.writeText` with the `clipboardWrite` permission. The `browser.clipboard` API only sets images. |
| `msg.save_attachments {where: downloads, ask}` | `g a` | Standard | `messages.get`, `messages.listAttachments`, `messages.getAttachmentFile`, `downloads.download` with the `downloads` permission. Files land in `Downloads/DesertBird/<date>-<subject>/`, because `filename` is relative to the Downloads directory and a free path needs a native host. Names and the subject are cleaned by `safe_filename`, a clash is renamed by `conflictAction: uniquify`, and a saved file is never opened. `ask` sets `saveAs` for each file. |
| `notify.toggle` | `:notify.toggle` | Standard | `storage.local`, `notifications.create`. Flips the `notify_new_mail` setting. While it is on, `messages.onNewMailReceived` shows a desktop notification per unread, non-junk Inbox message, or one batch for more than three. A click runs `messageDisplay.open`. No new permission |
| `folder.open {folder, special}` | `o`, `g o`, `g i`, `g t`, `g d`, `g s`, `g p`, `:open`, `:inbox` | Standard | `folders.query` with `specialUse`, `mailTabs.update`. Built: `g i`, `g t`, `g d`, `g s` and the handler for `folder` (the typed form: `o` and `g o` open the command line on `open `). `g p` stays unbound because Projects is a personal folder name, so a user binding is the way to get it. `--account` names the account to look a path up in, for a path two accounts hold. A special folder is looked up in the shown folder's account first, then in any account. The first-display error is a success when the tab shows the folder or is still loading it. |
| `filter.set {state: unread, all, starred, toggle_starred, tag, attachment}` | `F u`, `F a`, `F s` (toggle), `F f` (picker), `F A`, `:filter` | Standard | `mailTabs.setQuickFilter` |
| `sort.set {by, order: ascending, descending, toggle}` | `, d`, `, s`, `, f`, `, z`, `, t`, `, a`, `, u`, `, r`, `, p`, `, o`, `, ,` (picker), `:sort` | Standard | `mailTabs.update` |
| `pane.toggle {pane: message, folder}` | `t m`, `t f` | Standard | `mailTabs.update` |
| `tab.switch`, `tab.next`, `tab.prev`, `tab.close` | `T`, `:tab`, `<C-j>`, `<C-k>`, `<C-x>`, `<C-c>`, `q`, `<C-h>` | Standard | `tabs.*`. `tab.switch` takes a number or a title (a whole title first) and its command line list shows this window's tabs. Phase 0 checks that `tabs.remove` closes the primary mail tab. If it does not, `tab.close` refuses there. Measured: it does not, so `tab.close` refuses there. |
| `mark.set {slot}`, `mark.jump {slot}` | `M <key>`, `' <key>` | Standard | Folder marks in `storage.local`, `mailTabs.update`. Built as 21 bound leaves per command (slots a b c e h i j k l n o p q r s t u v w x y) with a fixed `slot` arg, so no chrome change is needed. A mark holds the account id and path. `mark.set` is not bridge safe (it writes state). |
| `jump.back`, `jump.forward` | `<C-o>`, `<C-i>` | Standard | Folder history in `storage.local`, `mailTabs.onDisplayedFolderChanged`. Built: one history for all windows, 100 entries, a cursor into it. A jump marks its own display event, which the listener drops, so a jump adds no entry. The folder shown at start is recorded first. With two windows on different folders, `<C-o>` in a window can target the folder that window already shows and then changes nothing. A held chord repeats. Storage key `desertbird_folder_state` (marks and history, versioned, with a migration table). |
| `step.unread {direction, scope: folder, all_folders}` | `] u`, `[ u`, `] U`, `[ U` | Standard | Built. A step in the shown folder reads `keys.viewRows` (the list in the order the user sees, unread from the row) and selects the row with `mailTabs.setSelectedMessages`. With `all_folders` and no match left, it reads `folders.getFolderInfo` unread counts (skipping Trash, Junk and virtual folders), takes the next folder that has any, wrapping once, then runs `messages.query` for one unread message with `messagesPerPage: 1`, shows the folder and selects it. A row holds its own message's flags, so an unread reply inside a closed thread is found when the thread opens. See [`thunderbird-behavior.md`](thunderbird-behavior.md), Step keys, for the timings. |
| `step.starred {direction}`, `step.attachment {direction}` | `] s`, `[ s`, `] a`, `[ a` | Standard | Built. The same row walk as `step.unread` with the flags word of `keys.viewRows` (starred is bit 0x4, attachment 0x10000000). A count steps that many matches in one pass. |
| `search.threads {query}` | `:search` | Standard | `mailTabs.setQuickFilter` with text |
| `search.open {direction}`, `search.next`, `search.prev` | `/`, `?`, `n`, `N` in the mail tab | Standard | The command line in search mode. `mailTabs.setQuickFilter` per keystroke (debounced, stale answers dropped, the last filter kept in session storage), `keys.viewRows` for the count and the stepping. The `/` register is in `storage.local`. Built. The API cannot read the quick filter, so Escape restores the last filter the add-on set (a hidden empty bar when none). |
| `search.message {query}` | `/` in the message pane, `n`, `N` | Standard | `messageDisplayScripts` find in the body |
| `compose.edit_external` | `e`, `<C-e>`, `:edit` | Standard | `compose.getComposeDetails` and `setComposeDetails`, host `editor_start` and `editor_collect` |
| `config.reload`, `help.open` | `:reload`, `:help` | Standard | Background, extension page |
| `help.whichkey` | `g?` | Standard | Background. The root keys in the which-key panel of the window, until the next key. In a message document `g?` opens the help page. |
| `motion.down`, `motion.up` | `j`, `k` | Experiment | Chrome runtime, `view.rows` and `view.select`. The thread list order, with collapsed threads, is only in the view. With the folder pane focused, `j`, `k`, `g g` and `G` move the folder selection instead. |
| `motion.left`, `motion.right` | `h`, `l` | Experiment | `view.thread`, `folder_tree.expand`. Built for the thread list: `h` goes from a reply to its root or closes the thread, `l` opens a closed thread or goes to the first reply. In the folder pane they close and open the selected folder row through `folder_tree.expand`: the handler asks it first and goes on to the thread logic only when the folder pane does not have the focus. |
| `motion.top`, `motion.bottom` | `g g`, `G` | Experiment | Chrome runtime |
| `view.half_page {direction: next, previous}` | `<C-d>`, `<C-u>` | Experiment | `view.rows`. Built in the background: it moves a fixed ten rows from the current row, clamped to the list. A true half page needs the list height, which the key script has no bytes for, and is tracked separately. |
| `view.reposition {position: center, top, bottom}` | `z z`, `z t`, `z b` | Experiment | `view.scroll`. Built. |
| `thread.fold_all {open}` | `z M`, `z R` | Experiment | `view.all_threads`. Built. With the folder pane focused it opens or closes every folder through `folder_tree.expand` with `extent: all`, and tries that first, as `h` and `l` do. |
| `step.thread_root {direction: next, previous}` | `] t`, `[ t` | Experiment | `view.rows` depth. The API gives no thread tree. Built: the background reads rows in blocks of 50 and selects the root with `mailTabs.setSelectedMessages`. |
| `visual.toggle` | `v` | Experiment | Built in the chrome runtime as modal key state: the anchor row. `j`, `k`, `g g` and `G` extend the selection from it. A background command (`x`, `d d`, `m s`) reads the range as its selection and ends the mode. `v` again or Escape ends it and keeps the current row. Escape is taken only while the mode is on. The actions stay standard. `msg.move` and `msg.snooze` keep `repeatable: false`. |
| `folder.collapse` | `<S-h>` | Experiment | `folder_tree.expand` with `extent: parent`, then `pane.focus`. Built. In the folder pane it closes the selected folder, or else closes its parent and selects that. From any other pane it focuses the folder pane, so the chord below keeps its meaning. It focuses the pane too when the folder script is missing or fails. |
| `pane.focus {pane}` | `g f`, `g e`, `g m`, `<S-h>` (message document only), `<A-h>`, `<S-l>`, `<A-l>` | Experiment | `pane.focus`. Built. The chords name a pane, not a direction: `<S-h>` the folder pane, `<A-h>` and `<S-l>` the thread list, `<A-l>` the message pane. `g f`, `g e` and the four chords also bind in the message document, because the body script takes every key while the message pane has the focus. A hidden pane, or a message pane with no message, is refused with a toast. |
| `pane.left`, `pane.right` | none | Experiment | `pane.focus` with `left` or `right`. Built: the pane beside the focused one in the order folders, threads, message. It stops at the ends with no toast, and a hidden pane counts as an end. No default key: the chords above name panes. |
| `search.folders {query}` | `/` in the folder pane | Experiment | `folder_tree.select`. Matching is standard. Not built: `/` is bound in the thread list and the key map has no per-pane binding. |
| `msg.undo` | `u`, `:undo` | Standard | DesertBird's own undo log: `messages.query` by Message-ID, `messages.move`, `messages.update`. Built, `repeatable: false` and `bridge: false`. Thunderbird records no undo step for an API change (see [`thunderbird-behavior.md`](thunderbird-behavior.md), Panes, undo and pages), so `msg.delete`, `msg.archive` and `msg.move` record the Message-ID, the origin folder and the destination of each message, and `msg.read`, `msg.flag` and `msg.junk` record the old value, and `msg.tag` records the toggled tag key and whether each message had it. `u` takes the newest entry and moves each message back, or writes the old value back. One stack serves every window, keeps the newest 20 entries and lives in `storage.local` under `desertbird_undo`. Undo only moves a message back and never deletes. It searches only the destination (Trash, every Archives folder with its subfolders, or the folder of the move), and tells copies that share a Message-ID apart by the Date header and the size it recorded. A message it cannot find is looked up again three times over three seconds, for an IMAP server that has not synced the copy yet. This wait does not hold the log, so `x` and `d d` run meanwhile. Then `u` refuses with a toast, moves nothing and marks the entry. The next `u` on a marked entry looks once more, moves back what it finds, drops the rest with a toast, and leaves the older entries free. A message with no Message-ID, and a delete from Trash, which is for good, record nothing and warn. Snooze, `folder.read_all` and changes made in Thunderbird itself are not undone. A tag undo writes back only the toggled tag, from the tags the message has now. It puts back a tag only while the tag still exists, else the step keeps that message and says why. There is no redo. |
| `thread.open_conversation` | `g C` | Experiment | `app.command cmd_openConversation`. Built. Thunderbird enables the command only for a message in its search index. Otherwise it refuses with a message. |
| `app.open_page {page}` | `g x`, `g T`, `g c` | Experiment | `app.open_page`. Built. |
| `hint.pick {action}` | `f`, `;` | Experiment in chrome, standard in the message body | `hints.collect` and `hints.act`, content script hints |
| Key capture, counts, `.`, modes, `<Esc>` | `0`-`9`, `.`, `esc` | Experiment | Chrome runtime. `.` replays the last motion or background command from runtime memory. A command with `repeatable: false` (`msg.move`, `msg.snooze`, `msg.remind`, `msg.remind_cancel`, `msg.undo` and `cmdline.open`, among others) clears it instead |
| Command line, which-key, toasts | `:` | Experiment for the mount only | `overlay.mount`. The page itself is a normal extension page. |
| Mode label | none | Experiment | `overlay.setModeLabel`. The background tells it the mode and the settings. It is an element of the status bar and no page. |

The table has 42 rows. 27 run without the Experiment (26 Standard and one Standard if fast enough). 15 need it (13 Experiment and two mixed rows, hints and the overlay mount). The Experiment carries key capture, the thread view and focus.

## Decisions

- ESR floor: 153 ESR, so `strict_min_version` is 153.0. ESR 128 is end of life, Betterbird retired its 140 line, and each extra base costs a test run on the chrome verbs. Revisit when a user on an older ESR asks.
- HTML compose conversion: a vendored `marked` (Markdown to HTML) and `turndown` (HTML to Markdown), both MIT. This needs no pandoc install and no host verb that spawns a process. The editor itself still needs the host. Revisit if the quote split (see build order 4) still loses structure.
- Bridge socket: after the first listing. The first release ships the config host only, because the bridge adds an audit of every command's `bridge` flag and a socket test on two apps. The bridge is the DesertFox bridge host and socket. It is off by default behind the `bridge` setting and gives the mode in the bar, `run` from outside and the CLI verbs. Revisit when the bar needs the Thunderbird mode. Every command states `bridge`. It is true only for a command that moves the view or the selection and does no harm doing so (`motion.*`). It is false for anything that changes mail, sends, discloses data or is hard to undo (`msg.*`).
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

## Build order

0. Measure on the target Thunderbird ESR and on Betterbird, and write `thunderbird-behavior.md`. Capture plain keys in `about:3pane` from the Experiment, and cancel Thunderbird's own single-key shortcuts (`a`, `j`, `f` and others) in normal mode. Take keys in the message pane through `messageDisplayScripts`. Mount an extension page overlay in the chrome window. Time the round trip from the chrome runtime to the background and back. Check that each standard row in the table exists on the target ESR. Find the native host manifest folders for Thunderbird and Betterbird, which are unverified. Check that Betterbird is at 153.2.0 or later for `filter.set` and `search.threads`. Check that `tabs.create` works from a compose window, for `help.open`. This phase needs no shared core.
1. Move the shared core into `packages/core` in the DesertFox repo and point DesertBird at it. Then set up the skeleton: the manifest, the Experiment with `keys.*` and `view.*`, and the registry with the motions and message actions.
2. Port the standard commands, group by group, in table order. `step.*` is not part of this phase: it waits for the later Experiment rows piece (`view.rows`), which also serves `motion.left`, `motion.right` and `step.thread_root`. Commands that need a typed or picked value (`msg.tag`, `msg.move`, `folder.open` with `o`, `tab.switch`, `filter.set` with a tag, `search.threads` and `sort.set`) ship their handlers and validators in this phase. Their default keys arrive with the command line in phase 3.
3. Command line, which-key and hints.
4. Compose: insert mode, `<C-o>` and the external editor through the host. HTML compose converts in both directions in the add-on, in the background page. Only the part the user wrote converts. That part is the top-level nodes that are not stop nodes (`moz-cite-prefix`, `blockquote[type=cite]`, `moz-signature`, `moz-forward-container`). They sit above the quote in a top-posted reply and below it in a bottom-posted reply, which is the Thunderbird default. The edited text goes back in the same place. A reply with user text on both sides of the quote is refused with a message. `turndown` turns that part into Markdown for `editor_start`. `marked` turns the edited Markdown back into HTML. The quote and signature nodes go back untouched, so cite quoting and tables survive. Both directions escape HTML, so tag text in a quoted message never becomes a live tag. `setComposeDetails` runs only when the Markdown changed. Parse with `DOMParser` and never set `innerHTML`. Test the round trip on top-posted, bottom-posted, forwarded and no-quote replies.
5. Migration notes for users who load key files through an autoconfig file.
6. Listing on addons.thunderbird.net, with the Experiment code open to a by-hand review.

## Risks

- An Experiment breaks when Thunderbird internals change between ESR releases. The fixed verb table keeps the breakage in one small file, and the key tests catch it.
- addons.thunderbird.net reviews Experiment code by hand, and the review can be slow. The no-eval rule removes the main ground for a refusal.
- Betterbird patches the thread pane (for example its multi-line view). `view.rows` needs a test on both apps.
- Thunderbird has single-key shortcuts of its own. A key the chrome runtime does not cancel runs both actions.
- If the round trip from chrome to background is slow, held `j` lags. That is why the motions run in the chrome runtime.

## Phase 0 findings

Phase 0 ran on Thunderbird 153.7.0 ESR and Betterbird 153.7.0, with the same result on both. The numbers and the method are in [`thunderbird-behavior.md`](thunderbird-behavior.md). The design decisions above stand. Where a measured fact differs from the text, the text carries a note and the fact is listed here.

- Overlay mount: the overlay is a remote `browser` element that the Experiment creates in a chrome document, in the main window or inside `about:3pane`. It loads the extension page with the extension APIs and takes keys. An extension-page iframe in `about:3pane` never loads. The chrome runtime must skip keys that the overlay has focus for.
- `step.unread` across folders: `messages.query({unread: true})` over all folders takes about 1.1 s on 5,000 messages, so it does not run per key. The command reads the unread counts with `folders.getFolderInfo` (about 21 ms for 50 folders), picks the next folder with unread mail, then queries that one folder for one result (`messagesPerPage: 1`). In the shown folder it reads `keys.viewRows`, which needs no query and follows the sort. It stays in the background. The timings on a folder of 10,000 messages are in [`thunderbird-behavior.md`](thunderbird-behavior.md), Step keys and visual mode.
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
