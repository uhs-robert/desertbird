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
| Overlay page in the chrome window | `cmdline.html` iframe and the `ui` bundle | Command line, completion, which-key, badge and toasts |
| Native host | Native host | Config read (`read_config`) and the external editor (`editor_start`, `editor_collect`) |

Registry changes from DesertFox:

- `runs_in` takes `background`, `chrome`, `message` or `compose`. A command runs on one side only.
- `chrome` holds only commands that must answer a held key at once: the motions, page moves, counts and mode changes. The DesertFox admission rule for `content.js` applies to the chrome runtime as written, with its own size guard.
- `needs` lists the chrome verbs a background handler calls (`needs: ["view.rows", "view.select"]`). The router refuses with a message when the Experiment is missing or failed to load, never a silent no-op.
- A build step writes the split table below from the registry, the way DesertFox generates `docs/keymap.md`. A test fails when a handler calls a chrome verb its `needs` does not list.

## Chrome verbs

This list is the whole privileged surface. Each verb takes typed args and is checked against the Experiment schema.

- `keys.install {tree, settings}`, `keys.set_mode {mode}` and the `keys.onInvocation` event: the chrome runtime matches keys locally and sends only finished invocations.
- `view.rows {first, last}`: the visible thread rows with index, message id, depth, collapsed and unread. `view.select {anchor, end}`, `view.scroll {row, position}`, `view.thread {row, open}` and `view.all_threads {open}`.
- `folder_tree.expand {folder, open}` and `folder_tree.select {folder}`.
- `pane.focus {pane}`, where pane is `folders`, `threads` or `message`.
- `app.command {name}`: one name from a fixed allowlist of Thunderbird commands (`cmd_undo`, `cmd_openConversation` and the few others the table names). Never a free string.
- `app.open_page {page}`: one key of a fixed table (`addons`, `themes`, `config`), never a URL. The counterpart of the DesertFox host verb `open_firefox_page`.
- `hints.collect {docs}` and `hints.act {id, action}`: hint targets in the chrome documents. The message and compose content scripts hold their own hints.
- `overlay.mount` and `overlay.unmount`: the extension page that draws the command line, which-key, badge and toasts in the chrome window.

## Split table

"Standard" means the command runs in the background (or a content script) on MailExtension APIs only. "Experiment" means it needs the chrome runtime or a chrome verb. Each standard row is checked against the target ESR.

| Command (proposed id) | Default keys | Side | How |
| --- | --- | --- | --- |
| `msg.read {state: read, unread, toggle}` | `m r`, `m u` | Standard | `messages.update` |
| `folder.read_all` | `m R` | Standard | `folders.markAsRead` |
| `msg.flag` | `m s` | Standard | `messages.update` |
| `msg.junk` | `m j` | Standard | `messages.update` |
| `msg.tag {tag}` | `m t`, `:tag` | Standard | `messages.update`, `messages.tags.list` |
| `msg.move {folder}` | `m m`, `m p`, `:move` | Standard | `messages.move`, `folders.query` |
| `msg.archive` | `x`, `:archive` | Standard | `messages.archive` |
| `msg.delete` | `d d`, `:delete` | Standard | `messages.delete` |
| `msg.reply {to: sender, all, list}` | `r`, `R` | Standard | `compose.beginReply` |
| `msg.forward` | `g F` | Standard | `compose.beginForward` |
| `msg.new` | `c` | Standard | `compose.beginNew` |
| `msg.open` | `<C-l>` | Standard | `messageDisplay.open` |
| `msg.yank {field: content, subject, sender, address, message_id}` | `y y`, `y s`, `y f`, `y a`, `y i` | Standard | `messages.get`, `messages.getFull`, `navigator.clipboard.writeText` with the `clipboardWrite` permission. The `browser.clipboard` API only sets images. |
| `folder.open {folder, special}` | `o`, `g o`, `g i`, `g t`, `g d`, `g s`, `g p`, `:open`, `:inbox` | Standard | `folders.query` with `specialUse`, `mailTabs.update` |
| `filter.set {state: unread, all, starred, tag, attachment}` | `F u`, `F a`, `F s`, `F f`, `:filter` | Standard | `mailTabs.setQuickFilter` |
| `sort.set {by, order}` | `:sort` | Standard | `mailTabs.update` |
| `pane.toggle {pane: message, folder}` | `t m`, `t f` | Standard | `mailTabs.update` |
| `tab.switch`, `tab.next`, `tab.prev`, `tab.close` | `T`, `:tab`, `<C-j>`, `<C-k>`, `<C-x>`, `<C-c>`, `q`, `<C-h>` | Standard | `tabs.*`. Phase 0 checks that `tabs.remove` closes the primary mail tab. If it does not, `tab.close` refuses there. Measured: it does not, so `tab.close` refuses there. |
| `mark.set {slot}`, `mark.jump {slot}` | `M <key>`, `' <key>` | Standard | Folder marks in `storage.local`, `mailTabs.update` |
| `jump.back`, `jump.forward` | `<C-o>`, `<C-i>` | Standard | Folder history in `storage.local`, `mailTabs.onDisplayedFolderChanged` |
| `step.unread {scope: folder, all_folders}` | `] u`, `[ u`, `] U`, `[ U` | Standard, if fast enough. Deferred out of phase 2 to the later Experiment rows piece. | `mailTabs.getListedMessages`, `messages.query`, `mailTabs.setSelectedMessages`. Measured slow: `messages.query` over 5,000 messages takes about 1.1 s and one folder of 10,000 about 2.2 s (see [`thunderbird-behavior.md`](thunderbird-behavior.md), Unread queries). |
| `step.starred`, `step.attachment` | `] s`, `[ s`, `] a`, `[ a` | Standard. Deferred out of phase 2 to the later Experiment rows piece. | Same as above. Measured: `setSelectedMessages` on a message inside a collapsed thread selects it and opens the thread (see the Phase 0 findings below). |
| `search.threads {query}` | `/` in the thread list | Standard | `mailTabs.setQuickFilter` with text |
| `search.message {query}` | `/` in the message pane, `n`, `N` | Standard | `messageDisplayScripts` find in the body |
| `compose.edit_external` | `e`, `<C-e>`, `:edit` | Standard | `compose.getComposeDetails` and `setComposeDetails`, host `editor_start` and `editor_collect` |
| `config.reload`, `help.open` | `:reload`, `:help` | Standard | Background, extension page |
| `motion.down`, `motion.up` | `j`, `k` | Experiment | Chrome runtime, `view.rows` and `view.select`. The thread list order, with collapsed threads, is only in the view. |
| `motion.left`, `motion.right` | `h`, `l` | Experiment | `view.thread`, `folder_tree.expand` |
| `motion.top`, `motion.bottom`, `page.down`, `page.up` | `g g`, `G`, `<C-d>`, `<C-u>` | Experiment | Chrome runtime |
| `view.reposition {position: center, top, bottom}` | `z z`, `z t`, `z b` | Experiment | `view.scroll` |
| `thread.fold_all {open}` | `z M`, `z R` | Experiment | `view.all_threads` |
| `step.thread_root` | `] t`, `[ t` | Experiment | `view.rows` depth. The API gives no thread tree. |
| `visual.toggle` and actions over the range | `v` | Experiment | `view.select`. The actions themselves stay standard. |
| `pane.focus {pane}` | `g f`, `g e`, `g m`, `<A-h>`, `<A-l>`, `<S-h>`, `<S-l>` | Experiment | `pane.focus` |
| `search.folders {query}` | `/` in the folder pane | Experiment | `folder_tree.select`. Matching is standard. |
| `msg.undo` | `u` | Experiment | `app.command cmd_undo` |
| `thread.open_conversation` | `g C` | Experiment | `app.command cmd_openConversation` |
| `app.open_page {page}` | `g x`, `g T`, `g c` | Experiment | `app.open_page` |
| `hint.pick {action}` | `f`, `;` | Experiment in chrome, standard in the message body | `hints.collect` and `hints.act`, content script hints |
| Key capture, counts, `.`, modes, `<Esc>` | `0`-`9`, `.`, `esc` | Experiment | Chrome runtime |
| Command line, which-key, badge, toasts | `:` | Experiment for the mount only | `overlay.mount`. The page itself is a normal extension page. |

The table has 41 rows. 26 run without the Experiment (25 Standard and one Standard if fast enough). 15 need it (13 Experiment and two mixed rows, hints and the overlay mount). The Experiment carries key capture, the thread view and focus.

## Decisions

- ESR floor: 153 ESR, so `strict_min_version` is 153.0. ESR 128 is end of life, Betterbird retired its 140 line, and each extra base costs a test run on the chrome verbs. Revisit when a user on an older ESR asks.
- HTML compose conversion: a vendored `marked` (Markdown to HTML) and `turndown` (HTML to Markdown), both MIT. This needs no pandoc install and no host verb that spawns a process. The editor itself still needs the host. Revisit if the quote split (see build order 4) still loses structure.
- Bridge socket: after the first listing. The first release ships the config host only, because the bridge adds an audit of every command's `bridge` flag and a socket test on two apps. The bridge is the DesertFox bridge host and socket. It is off by default behind the `bridge` setting and gives the mode in the bar, `run` from outside and the CLI verbs. Revisit when the bar needs the Thunderbird mode. Every command states `bridge`. It is true only for a command that moves the view or the selection and does no harm doing so (`motion.*`). It is false for anything that changes mail, sends, discloses data or is hard to undo (`msg.*`).
- Phase 2 scope: `step.*` is deferred, and the typed-value commands listed in build order 2 get default keys with the phase 3 command line. The keymap matches a chord only when it binds that chord. The alt chords (`<A-h>`, `<A-l>`) stay out of phase 2, because the motions that use them are out of it.
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
- The which-key panel, toasts, the badge and themes.
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
- `step.unread` across folders: `messages.query({unread: true})` over all folders takes about 1.1 s on 5,000 messages, so it does not run per key. A command reads the unread counts with `folders.getFolderInfo` (about 21 ms for 50 folders), then queries one folder. The counts only pick which folder to query. The current folder still needs its own query for unread after the selection. When unread mail lies only before the selection, the command moves to the next folder with unread. The exact selection rule is open for the later Experiment rows piece. A query on one folder of 10,000 messages takes about 2.2 s, and `mailTabs.getListedMessages` about 6.9 s. The row stays marked Standard, and a large folder misses a per-key budget. The decision to move it to the Experiment is open.
- Collapsed threads: `mailTabs.setSelectedMessages` on a message inside a collapsed thread selects it and opens the thread.
- `tabs.remove` on the primary mail tab is a no-op, also when it is the only tab. `tab.close` refuses there.
- `messages.tags.list` needs the `messagesTagsList` permission. `commands`, `menus` and `addressBooks` calls need their own permission or key too. There is no `messenger.clipboard`.
- Plain keys: a capture listener on the top window sees plain keys in the thread list, the message pane, a message tab and a message window, and cancels each Thunderbird single-key shortcut that acts there. In all four contexts that covers `m`, `s`, `j` and `a`. On the thread list only, `f`, `b`, `n`, `p`, `1` and `Enter` were measured and cancelled. `r` and `R` do nothing by default in any context. Chords, key repeat and other tab types were not measured, see "Not measured" in [`thunderbird-behavior.md`](thunderbird-behavior.md). The first press after a focus change can be lost.
- Message pane: for local mail the message body browser is not remote, so a chrome listener sees its keys. This differs from the Architecture row for `messageDisplayScripts`. The decision stands until feed, IMAP and remote content are measured.
- Round trip: a key reaches the background in under 1 ms, so the chrome runtime can send finished invocations to the background. The motions stay in the chrome runtime by decision. Held keys were not timed.
- Native host manifests: both apps read only `~/.mozilla/native-messaging-hosts/` in the user folders. The system folders were not tested.
- Two traps: `compose.beginReply` crashes the app when the account has no identity, and `mailTabs.update` with a displayed folder throws on the first display of a folder though the folder displays.
- Betterbird at 153.7.0 passes the `filter.set` and `search.threads` checks.

Phase 0 answered both former open questions:

- The overlay mounts as a remote `browser` element in a chrome document, not as an iframe of an extension page in `about:3pane` and not as a sized panel.
- `step.unread` across all folders is not fast enough with `messages.query` alone. It reads `getFolderInfo` counts first and queries one folder. Whether a large folder moves to the Experiment is open.
