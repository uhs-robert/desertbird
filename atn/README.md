# atn

What the addons.thunderbird.net listing needs from this repository. DesertBird has no release script yet, so the first submit is by hand on the developer hub.

- `metadata.json`: the listing fields in the shape of the add-on API that DesertFox's listing file uses: name, summary (at most 250 characters), description, support URL, the version license (`MPL-2.0`), the release notes line and the notes for the store's reviewers. It has no `categories` field on purpose, see Open items. The reviewer notes carry the permission reasons, the answers about remote code and the native host, and the justification of the Experiment and the page actor. Keep them true when a permission, a verb or the host changes.
- `icon.png`: the 128 px listing icon. It was rendered from `src/icons/desertbird.svg` with `rsvg-convert -w 128 -h 128` (librsvg 2.63). The manifest icon stays the SVG.

Three things stay outside the file and are set on the listing page:

- The privacy policy: paste `docs/privacy.md` into the privacy policy field.
- The previews: the shots in `docs/images/` listed below. They are 1280x720 stills, not a clip: previews are static images.
- The source archive: see below.

## Source archive

The reviewer rebuilds the package from a source archive. Make it from a clean checkout of the exact commit that is built and uploaded:

```bash
git archive --format=zip -o desertbird-1.0.0-source.zip HEAD
```

It holds every tracked file, including `BUILD.md`, `package-lock.json`, `vendor/` and `tools/build.mjs`. `BUILD.md` is the build instruction the reviewer follows.

## Order of a submission

1. Run `npm ci`, `npm run check` and `npm run build` on the commit to submit. The package is `dist/desertbird.xpi`.
2. Make the source archive from the same commit.
3. Open the developer hub, add a new add-on and upload `dist/desertbird.xpi`. Pick Thunderbird. The store signs the file, and the number 1.0.0 is used once.
4. Fill the listing from `metadata.json`: name, summary, description, support URL, homepage and license. Paste the reviewer notes into the notes for reviewers, and upload the source archive.
5. Set the privacy policy from `docs/privacy.md`, upload `icon.png` and add the previews. Set the categories (see Open items), the Thunderbird version range (minimum 153.0, no maximum) and no Android.
6. The store reviews the version, which takes days or weeks. Betterbird users install the same file from the same listing, and the listing text says so without claiming store support for Betterbird.
7. After approval, point the README at the listing (the install section and the comparison row) and add the signed file to a GitHub release.

Captions for the previews:

- `docs/images/which-key.png`: Press g and wait. The which-key popup lists every key that can follow and what it does.
- `docs/images/which-key-message.png`: The same popup after m, in the message group, in Betterbird.
- `docs/images/hints.png`: Press f. Every control gets a label. Type it to click.
- `docs/images/command-line.png`: Press : to run any command by name, with completion as you type.
- `docs/images/visual-mode.png`: Press v and move to select a range of threads. The label shows VISUAL.
- `docs/images/compose-normal-mode.png`: Compose keeps Vim modes. Escape for normal mode, i for insert, and the status bar says which.
- `docs/images/help-page.png`: A help page that DesertBird builds from your keymap, so it is always current.
- `docs/images/options-page.png`: Settings, a key editor and 16 themes on one page.

## Open items for the owner

- Categories: the listing has none in `metadata.json`. Pick two from the live list for Thunderbird, then add them.
- Support email: the listing takes an optional one. None is set.
- `data_collection_permissions`: the manifest says `required: ["none"]`, as DesertFox does. Confirm the live validator accepts it for a Thunderbird add-on.
- `TODO-CHROME-VERBS` in the reviewer notes: the list of chrome verbs is not filled in yet. Search for it in `metadata.json` before the submit.
- The shots come from fixture mail, so the senders and subjects are the test fixture's.
