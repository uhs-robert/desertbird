# Bridge, add-on side

The add-on's end of the native bridge host. A program outside Thunderbird, such as a desktop bar or a CLI, talks to the host over its socket. The host talks to the add-on over one `connectNative` port named `desertbird_bridge`. The add-on is the trust boundary: it holds the setting, the never-list and the validator. The host only forwards.

| File | Role |
| --- | --- |
| `run.ts` | The one path a `run` takes: the first word against the bridge rules, then the parse, the rules again, `check_args`, and `router.route` in the last focused main window. Also `list_bridge_commands`, the commands `run` accepts |
| `reads.ts` | The four read frames, each behind its own share setting: `folders`, `messages`, `message` and `attachments`. It cleans every string a sender controls and refuses an encrypted body |
| `confirm.ts` | The y or n prompt a write waits on: `request_confirm` resolves `yes`, `no`, `timeout` or `busy`. One request at a time, in memory only. It mounts the command line surface in the last focused main window, and only that page's `confirm.answer` with the prompt's token counts |
| `drafts.ts` | The `draft` frame behind `bridge_allow_drafts`: checks every field, picks the identity, opens a plain-text compose, saves it to Drafts and closes that window. It never sends |
| `acts.ts` | The `act` frame behind `bridge_allow_actions`: archive, trash or move after a yes on the confirm prompt, through the same handlers as the keys, so `u` reverses it. It never deletes |
| `port.ts` | The port: connect while `bridge` is on, the `ready` handshake, the backoff, the answers to `list`, `run` and `state`, and the `mode` frames |

## Setup

The bridge needs the DesertFox host and its `desertbird_bridge.json` manifest. A new host install writes it. An existing DesertFox user gets it only by running `host/install.sh` again or by running `:native.update` in Firefox. The automatic host update does not add it. Then turn `bridge` on in the options page. The `desertfox` CLI talks to Thunderbird only with `--app thunderbird`, for example `desertfox --app thunderbird run step.unread`.

## Rules

- `bridge` (default `false`) gates everything. While it is off, `connectNative` is never called. Turning it off closes the port and stops the retry timer. A `run` reads the stored setting again before it runs, so a frame that lands between the write and `storage.onChanged` is refused.
- A command runs only when its `bridge` field is `true`, it is not on the never-list, and it runs in the background. Chrome and message commands (`motion.down`, `message.scroll_down`) run on a key in the window. The background has no verb to start them, so the bridge refuses them.
- The never-list wins over the `bridge` field. Groups `config`, `settings`, `native`, `permissions`, `clipboard` and `hint` (as an id prefix or a group file). `repeat.last` is on it because it replays any command a key ran. So are `mark.set`, `msg.undo`, every command that sends, deletes or moves mail, and every command that opens an address (`hint.pick`, `msg.open`, `msg.unsubscribe`, `app.open_page`, `help.open`).
- A refused command is refused on its first word, before its args are parsed. The parse and the validator read no dynamic value list. `list` gives a folder, tag or tab param only its `{ from }` source, so no folder name or tag leaves.
- A handler failure answers `<id> failed` and nothing more: its text can name a folder or a subject.
- The ok or failed answer itself tells whether a typed text matched mail, alone or through a step that reads the filtered list. So no caller text reaches a match against mail: `search.message` and `search.threads` are on the never-list, `filter.set` takes no tag, `tab.switch` takes only a tab number, and `folder.open` takes only a special folder with no account.
- `test/registry.test.ts` holds the audited `bridge: true` set. A command newly marked `true` fails it until it is reviewed.

## Confirm prompt

- One pending request. A second resolves `busy` at once and leaves the first alone. The entry holds the token, the window and the display list, never a message body.
- The list shows the action, the count, up to 10 subjects and senders through the reads' cleaner, cut to 80 characters, `and N more`, the target folder name and the line "Requested by a program outside Thunderbird".
- 30 s without an answer is `timeout`. No main window, no Experiment or a failed mount is `no`.
- An answer counts only from the command line page of the prompt's window (its address, compared as text), with the token made for the prompt, and at least 300 ms after the mount. No frame, registry command or other script has a way to answer.
- Every exit (an answer, the timeout, Escape in the chrome, a tab change, a closed window, a command line opening or closing in that window) settles the promise once, clears the timer and frees the slot. The surface is unmounted unless it is gone or being replaced. A background restart drops the prompt: the host call times out, and the old page closes on its next key.

## Backoff

A failed connect or a dropped port retries after 1 s. Each further failure doubles the wait, up to 60 s. A port that stayed up 10 s after `ready` starts the backoff over. At most one retry timer exists. A drop of a port that is no longer the current one does nothing. Each port's two listeners are removed when it closes, so a reconnect leaks none.

## Frames

Each frame is one JSON object. The host frames it with a 4-byte length on its stdin and stdout.

Host to add-on:

```json
{ "ready": true, "host_version": 1, "release_version": "..." }
{ "verb": "list", "request_id": 1 }
{ "verb": "run", "request_id": 2, "command": "pane.toggle folder" }
{ "verb": "state", "request_id": 3 }
```

The add-on ignores every frame before `ready`, every frame without an integer `request_id`, and every other verb. `command` is a command line of at most 4096 characters.

Add-on to host:

```json
{ "verb": "reply", "request_id": 1, "ok": true, "commands": [{ "id": "pane.toggle", "label": "Toggle a pane", "intent": "...", "params": [...] }] }
{ "verb": "reply", "request_id": 2, "ok": true }
{ "verb": "reply", "request_id": 2, "ok": false, "message": "msg.delete never runs through the bridge" }
{ "verb": "reply", "request_id": 3, "ok": true, "mode": { "id": "normal", "label": "NORMAL", "private": false, "tab_id": 7, "window_id": 3 } }
{ "verb": "reply", "request_id": 3, "ok": false, "message": "no mail window is open" }
{ "verb": "mode", "id": "visual", "label": "VISUAL", "private": false, "tab_id": 7, "window_id": 3 }
```

A `commands` row has `id` and `label`, and `name`, `aliases`, `intent`, `params` and `count` when the command has them. `mode` goes out after `ready`, on each mode change the key runtime reports, and when a main window takes the focus. It names the last focused main window and its active tab. Thunderbird has no private windows, so `private` is always `false`.

## Reads

Each read needs `bridge` and its own share setting, all off by default. The add-on reads the settings from storage at each request, never the host.

| Frame | Request fields | Setting | Reply |
| --- | --- | --- | --- |
| `folders` | none | `bridge_share_folders` | `folders: [{ id, name, path, account, unread, total }]`, `truncated` |
| `messages` | `folder` (an id from `folders`, at most 1024 characters), `limit` (1 to 200, default 50), `unread_only` | `bridge_share_headers` and `bridge_share_folders` | `messages: [{ id, from, subject, date, folder, read, flagged }]` newest first, `truncated`. `folder` is the opaque id, never the name |
| `message` | `id` (a positive integer) | `bridge_share_headers` and `bridge_share_bodies` | `message: { id, from, to, subject, date, content_type, body, untrusted: true, html_stripped, truncated }` |
| `attachments` | `id` | `bridge_share_attachments` | `attachments: [{ part, name, size, content_type }]`, `truncated`. Names and sizes only, never the bytes |

- Bad fields, an unknown folder and an unknown message get fixed refusal texts that never echo the request.
- Every string a sender controls (from, to, subject, folder and account names, attachment names) loses its control and format characters, zero-width and bidirectional marks among them, and is cut to 512 characters. Attachment names go through `safe_filename`.
- `messages` needs folder sharing too: a folder id is the folder's path, so its answer to a guessed id would confirm a folder name.
- `attachments` checks for encryption first, because `listAttachments` decrypts an encrypted message.
- A body is the plain text part, else the HTML part turned into text by Thunderbird's own converter, which loads and resolves nothing. It keeps line breaks and tabs, loses other controls and format characters, and is cut at 64 KiB of UTF-8 at a code point.
- `getFull` runs with `decrypt: false`. A message with any part of type `multipart/encrypted`, `application/pkcs7-mime` or `application/pgp-encrypted`, a decryption status, or an inline `-----BEGIN PGP MESSAGE-----` is refused. Its body never leaves.
- A list reply over 900 KiB drops rows from its end and says `truncated`, so it stays under the host's 1 MiB cap. `messages` reads every page of the folder and keeps only the newest `limit` rows so far, so it finds the newest mail of any folder with memory for one page plus `limit` rows.
- The CLI wraps a body in delimiters with a nonce it makes itself. The add-on makes no nonce.
- `list` never carries folder names or tags, whatever `bridge_share_folders` says: a dynamic param gives only its `{ from }` source.

## Drafts

A `draft` frame needs `bridge` and `bridge_allow_drafts`, both off by default and read from storage at each request. Either off answers `off`. A draft writes to the mailbox and syncs to an IMAP server, so it has its own setting apart from the reads.

```json
{ "verb": "draft", "request_id": 5, "to": ["ann@example.org"], "cc": [], "subject": "...", "body": "...", "from": "me@example.org", "reply_to_id": 42 }
{ "verb": "reply", "request_id": 5, "ok": true }
{ "verb": "reply", "request_id": 5, "ok": false, "message": "bad address" }
```

| Field | Rule |
| --- | --- |
| `to` | 1 to 10 addresses, or 0 to 10 with `reply_to_id`. An empty list on a reply keeps the recipients Thunderbird picks |
| `cc` | Optional, 0 to 10 addresses |
| `subject` | At most 998 characters, no control characters. Format characters (zero-width and bidirectional marks) are removed |
| `body` | At most 64 KiB of UTF-8. It goes in as plain text, never as HTML. Line breaks and tabs stay, other controls and format characters go |
| `from` | Optional. It must equal an identity's address exactly, else `no such identity`. Without it a new draft takes the default identity and a reply the identity the original was addressed to, as the keys do |
| `reply_to_id` | Optional message id. It must resolve, else `no such message`. The draft is a reply to the sender |

- Each address is a bare `local@domain` with a dotted domain. A display name, a comma or a group is `bad address`, so one entry never carries more recipients past the cap.
- Any other field is refused, Bcc and attachments among them.
- Every check runs before the first compose call. Each refusal is a fixed text and never echoes the request.
- The reply is `ok` or a refusal. It never carries the draft, its id or any mail data.
- The add-on never sends. It has no send call and holds no `compose.send` permission. `test/bridge_drafts.test.ts` checks both.
- Saving needs the `compose.save` permission. Thunderbird has no other way to save a draft that it builds itself (threading, identity, Drafts folder). An add-on with an Experiment cannot ask for it as optional, so it is always granted.
- Thunderbird saves only from a compose window. The add-on opens one, saves it with `compose.saveMessage` in `draft` mode, and closes that window, matched by the id the compose call returned, on every path, a failed save included. The window shows for that moment and takes the focus. Then the add-on gives the focus back to the Thunderbird window that had it. When another program had the focus, it raises no Thunderbird window.
- Drafts run one at a time, so a second compose window never opens while the first is still up.
- A draft that is not saved within 30 s answers `timed out` and frees the next draft. Its window stays open, because a save can wait on a Thunderbird prompt (a failed copy to an IMAP Drafts folder, a passphrase), and closing it could drop the draft. Check Drafts before you retry.

## Acts

An `act` frame needs `bridge` and `bridge_allow_actions`, both off by default and read from storage at each request. A move also needs `bridge_share_folders`, because a `no such folder` answer would confirm a guessed folder id. Any of them off answers `off`.

```json
{ "verb": "act", "request_id": 6, "action": "move", "ids": [101, 102], "folder": "imap://user@example.org/Archive" }
{ "verb": "reply", "request_id": 6, "ok": true, "count": 2 }
{ "verb": "reply", "request_id": 6, "ok": false, "message": "denied" }
```

| Field | Rule |
| --- | --- |
| `action` | `archive`, `trash` or `move` |
| `ids` | 1 to 50 message ids, no id twice |
| `folder` | An id from the `folders` read, at most 1024 characters. Required for `move` and refused with the others. An account root, a saved search or a unified folder is `no such folder` |

- The fields are checked first, then the settings. Every id and the folder are found before the prompt. One missing id refuses the whole act with `no such message`, and nothing moves.
- Nothing moves without a yes on the confirm prompt (see above). `n` or Escape answers `denied`, the 30 s limit `timed out`, and a prompt already showing `busy`.
- After the yes, the settings are read and the messages found again. A setting turned off during the prompt answers `off` and moves nothing. A message moved by hand meanwhile is left out, and the reply is `moved <n> of <m>`. So is a move that fails part way.
- `archive` runs the handler of the archive key. `move` runs the move handler of the move command. `trash` moves each message to the Trash of its own account and never calls `messages.delete`, which deletes a message already in Trash for good. A message already in Trash stays there.
- Each act writes the same undo entry as the key, so `u` (`msg.undo`) moves the messages back. `msg.delete`, `msg.archive`, `msg.move` and `msg.undo` stay on the never-list: the frame does not run a registry command.
- The reply is `ok` with the count, or a fixed refusal. It carries no subject, sender or folder name.
