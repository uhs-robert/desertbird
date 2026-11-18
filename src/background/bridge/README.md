# Bridge, add-on side

The add-on's end of the native bridge host. A program outside Thunderbird, such as a desktop bar or a CLI, talks to the host over its socket. The host talks to the add-on over one `connectNative` port named `desertbird_bridge`. The add-on is the trust boundary: it holds the setting, the never-list and the validator. The host only forwards.

| File | Role |
| --- | --- |
| `run.ts` | The one path a `run` takes: the first word against the bridge rules, then the parse, the rules again, `check_args`, and `router.route` in the last focused main window. Also `list_bridge_commands`, the commands `run` accepts |
| `port.ts` | The port: connect while `bridge` is on, the `ready` handshake, the backoff, the answers to `list`, `run` and `state`, and the `mode` frames |

## Rules

- `bridge` (default `false`) gates everything. While it is off, `connectNative` is never called. Turning it off closes the port and stops the retry timer. A `run` reads the stored setting again before it runs, so a frame that lands between the write and `storage.onChanged` is refused.
- A command runs only when its `bridge` field is `true`, it is not on the never-list, and it runs in the background. Chrome and message commands (`motion.down`, `message.scroll_down`) run on a key in the window. The background has no verb to start them, so the bridge refuses them.
- The never-list wins over the `bridge` field. Groups `config`, `settings`, `native`, `permissions`, `clipboard` and `hint` (as an id prefix or a group file). `repeat.last` is on it because it replays any command a key ran. So are `mark.set`, `msg.undo`, every command that sends, deletes or moves mail, and every command that opens an address (`hint.pick`, `msg.open`, `msg.unsubscribe`, `app.open_page`, `help.open`).
- A refused command is refused on its first word, before its args are parsed. The parse and the validator read no dynamic value list. `list` gives a folder, tag or tab param only its `{ from }` source, so no folder name or tag leaves.
- A handler failure answers `<id> failed` and nothing more: its text can name a folder or a subject.
- The ok or failed answer itself tells whether a typed text matched mail, alone or through a step that reads the filtered list. So no caller text reaches a match against mail: `search.message` and `search.threads` are on the never-list, `filter.set` takes no tag, `tab.switch` takes only a tab number, and `folder.open` takes only a special folder with no account.
- `test/registry.test.ts` holds the audited `bridge: true` set. A command newly marked `true` fails it until it is reviewed.

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
