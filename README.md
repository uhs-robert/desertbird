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

## License

MPL-2.0. See [`LICENSE`](LICENSE).
