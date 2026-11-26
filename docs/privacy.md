# Privacy policy

DesertBird collects no data. It has no account, no telemetry, no analytics and no ads. The developer receives nothing from your mail program.

This file is the privacy policy of the DesertBird add-on. The same text is the privacy policy on its addons.thunderbird.net page. It uses plain paragraphs and lists so it reads the same in both places.

## Nothing leaves your computer by itself

DesertBird makes no request to a remote server. It has no update server of its own, no fetch of its own and no hosts it contacts. All its scripts and pages are in the package. The two optional parts below talk only to programs on your own computer.

## What stays on your device

DesertBird keeps its settings, keymap, marks, quick replies, undo log, snoozes and reminders in Thunderbird storage on your device. It reads your folders, messages, tags and clipboard only to run a key you pressed or a command you typed. It sends none of that to a server.

## Requests you cause

- Opening a link from a message, or pressing `gu` to unsubscribe, opens the link in your default browser. That browser then loads the page, as for any link. DesertBird shows you the target first and never fetches or posts it itself.
- `gu` with a mailto link opens a prefilled compose window. You send it yourself.
- Saving attachments writes files to `Downloads/DesertBird/` on your disk. DesertBird never opens a saved file.
- Yank commands write to your clipboard.
- Notifications for reminders, snoozes and new mail show on your desktop. A subject and a sender can show on the lock screen and in the notification history of your desktop.

## The optional native host (Linux)

The native host is a helper program that you download and install yourself. It is the DesertFox host, a separate project, and is not part of this add-on. DesertBird holds the `nativeMessaging` permission as an optional permission. Thunderbird asks for it when you turn on the settings `external_editor` or `bridge` and press Save on the options page. Without it, nothing connects to the host.

The external editor sends the text of the message you are composing to the program you named in `editor.toml`, when you press `Ctrl+E`. The host writes that text to a scratch file (a temporary file the editor opens) in a folder that only you can write. It prefers `$XDG_RUNTIME_DIR/desertfox/editor`, which is usually memory-backed. When that folder is missing or not trusted, it uses `~/.cache/desertfox/editor`, which is on disk. The host deletes the scratch file when the editor closes and DesertBird has read the result. It deletes older files at the next editor start. Your editor keeps its own swap, backup and undo files where it puts them. The text stays on your computer.

## The optional bridge

The setting `bridge` is off by default. Nothing connects to the host while it is off. When it is on, programs on your own computer that connect to the bridge socket of the host (readable by your user only) can read the state of Thunderbird and run a short list of safe commands. Commands that send mail, delete it for good or open a link never run through the bridge. Archive, trash and move run only when `bridge_allow_actions` is on and you press `y` on a prompt in Thunderbird.

With `bridge` on and nothing else, a program sees the mode of the focused window, the ids of that window and its active tab and the list of allowed commands. Four more settings, each off by default, let a program read mail. Two more let a program write. The table lists what each one passes.

| Setting | What leaves Thunderbird for a program on your computer |
| --- | --- |
| `bridge_share_folders` | Folder names, paths, account names and unread and total counts |
| `bridge_share_headers` | Sender, subject, date and read and flagged state of up to 200 messages of one folder at a time. Needs `bridge_share_folders` on too |
| `bridge_share_bodies` | The text of one message, cut at 64 KiB. HTML turns into plain text. An encrypted message is never sent. Needs `bridge_share_headers` on too |
| `bridge_share_attachments` | Attachment names, sizes and types. Never the files |
| `bridge_allow_drafts` | A program can save a plain-text draft in your Drafts folder. You review it and press Send yourself. The answer holds no mail data |
| `bridge_allow_actions` | A program can ask to archive, trash or move up to 50 messages. Nothing happens until you press `y` on a prompt in Thunderbird that lists the messages. `u` undoes it |

The host passes each answer to the program that asked and keeps none of it. Nothing goes over the network. Turn a setting off and the data stops at once.

## Permissions

DesertBird asks Thunderbird for these permissions on install: read and change folders, messages, tags and drafts, run reminders (alarms), show notifications, store its own data, read the tab list, write the clipboard and save attachments to Downloads. It does not hold the permission to send mail. The key `gS` in a compose window sends the message only when you turn on the `compose_send` setting, and it uses Thunderbird's own send command with its checks. The bridge never sends mail. The `nativeMessaging` permission is optional and is asked for only as the section above says. Thunderbird also shows "Have full, unrestricted access to Thunderbird and your computer" for the Experiment, the privileged part of the add-on. The Experiment takes a fixed list of requests and sends nothing to a server.

## Changes and contact

This file lives in the project repository and its history is public. Report a problem or ask a question at https://github.com/uhs-robert/desertbird/issues.
