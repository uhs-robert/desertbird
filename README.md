# DesertBird

A keyboard-first add-on for Thunderbird and Betterbird. Every command is defined once in a registry. Keys, the command line, completion and help all read that definition.

DesertBird follows the design of DesertFox, its Firefox sibling.

## Status

Pre-alpha. The design is in progress and there is no code yet. Read [`docs/design.md`](docs/design.md).

## Unsubscribe

`g u` reads the `List-Unsubscribe` header of the selected message. The first press shows a notification with the target: the host of an https link, or the address a mailto draft goes to. A second press of `g u` on the same message within 15 seconds acts. An https link opens in the default browser. A mailto opens a prefilled compose window, and you send it yourself. When the header has both, the mailto wins. The add-on never sends mail, fetches or posts a URL, or archives the message. It accepts https and mailto only.

## License

MPL-2.0. See [`LICENSE`](LICENSE).
