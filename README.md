# DesertBird

A keyboard-first add-on for Thunderbird and Betterbird. Every command is defined once in a registry. Keys, the command line, completion and help all read that definition.

DesertBird follows the design of DesertFox, its Firefox sibling.

## Status

Pre-alpha. The design is in progress and there is no code yet. Read [`docs/design.md`](docs/design.md).

## Unsubscribe

`g u` reads the `List-Unsubscribe` header of the selected message. The first press shows a notification with the target: the host of an https link, or the address a mailto draft goes to. A second press of `g u` on the same message within 15 seconds acts. An https link opens in the default browser. A mailto opens a prefilled compose window, and you send it yourself. When the header has both, the mailto wins. The add-on never sends mail, fetches or posts a URL, or archives the message. It accepts https and mailto only.
## Saving attachments

`g a` saves the attachments of the selected messages to `Downloads/DesertBird/<date>-<subject>/`. The command needs the `downloads` permission. File names and the subject are cleaned first, and a saved file is never opened. `msg.save_attachments {where: ask}` shows the save dialog for each file. A message with no attachments is refused.

## New-mail notifications

Off by default. Thunderbird shows its own new-mail alert, so this one is opt-in. Turn it on with the `notify_new_mail` setting on the options page, or run `:notify.toggle`. While it is on, each new unread, non-junk Inbox message shows a desktop notification with the sender and the subject. More than three at once give one notification with a count. Clicking a notification opens the message in a tab. Notifications have no action buttons, because Thunderbird 153 does not support them. The subject and sender show on the lock screen and in the desktop's notification history. The add-on needs no new permission.

## Bridge

Off by default. The `bridge` setting lets the DesertFox bridge host connect, so a desktop bar can show the mode and a script can run a few safe commands, such as `pane.toggle folder` or `step.unread`. The add-on needs the `nativeMessaging` permission for this. Thunderbird shows it on install as "Exchange messages with programs other than Thunderbird". An add-on with an Experiment cannot ask for an optional permission, so the permission is always granted. Nothing connects while `bridge` is off, which is the default. While it is on, the add-on sends the mode of the focused window and the ids of that window and its active tab, plus the list of commands the bridge allows. Commands that send, delete or move mail, and commands that open a link, never run through the bridge.

Four more settings, each off by default and each inert while `bridge` is off, let a script read mail:

| Setting | What leaves Thunderbird |
| --- | --- |
| `bridge_share_folders` | Folder names, paths, account names and unread and total counts |
| `bridge_share_headers` | Sender, subject, date and read and flagged state of the messages in one folder, at most 200 at a time. Needs `bridge_share_folders` on too |
| `bridge_share_bodies` | The text of one message, with `bridge_share_headers` on too. HTML turns into plain text, the text is cut at 64 KiB, and an encrypted message is never sent |
| `bridge_share_attachments` | Attachment names, sizes and types. Never the files |

With all four off, the bridge sends no mail, no folder names and no tags.

Two settings let a script write, each off by default and inert while `bridge` is off:

| Setting | What it allows |
| --- | --- |
| `bridge_allow_drafts` | Save a plain-text draft in the Drafts folder: up to 10 To and 10 Cc addresses, a subject and a body of at most 64 KiB, from one of your identities. No Bcc and no attachments. The answer is only ok or a refusal, never mail data |
| `bridge_allow_actions` | Archive, move to Trash or move to a folder (with `bridge_share_folders` on) up to 50 messages, only after you press `y` on a prompt in Thunderbird. The prompt lists the subjects and senders and says the request came from outside. `n`, Escape or 30 s refuses. Nothing is deleted for good, and `u` moves the messages back. The answer is only a count or a refusal |

Saving a draft needs the `compose.save` permission, which Thunderbird shows on install. The add-on never sends mail: it does not hold the `compose.send` permission. Thunderbird saves a draft only from a compose window, so the window opens for a moment, and the add-on closes it once the draft is saved. You review the draft and press Send yourself. Setup of the host and the CLI is in [`src/background/bridge/README.md`](src/background/bridge/README.md#setup).

## License

MPL-2.0. See [`LICENSE`](LICENSE).
