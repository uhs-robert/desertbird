# atn

What the addons.thunderbird.net listing needs from this repository. DesertBird has no release script yet, so the first submit is by hand on the developer hub.

- `metadata.json`: the listing fields in the shape of the add-on API that DesertFox's listing file uses: name, summary (at most 250 characters), description, support URL, the version license (`MPL-2.0`), the release notes line and the notes for the store's reviewers. Its `categories` are Message and News Reading and Folders and Filters, slugs from the live Thunderbird category list (the add-on API at `/api/v4/addons/categories/`). The reviewer notes carry the permission reasons, the answers about remote code and the native host, and the justification of the Experiment and the page actor. Keep them true when a permission, a verb or the host changes.
- `icon.png`: the 128 px listing icon. It was rendered from `src/icons/desertbird.svg` with `rsvg-convert -w 128 -h 128` (librsvg 2.63). The manifest icon stays the SVG.

Three things stay outside the file and are set on the listing page:

- The privacy policy: paste `docs/privacy.md` into the privacy policy field.
- The previews: the shots in `docs/images/` listed below. They are stills, not a clip: previews are static images. The hero image is 1280x800 and the others 1280x720.
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
5. Set the privacy policy from `docs/privacy.md`, upload `icon.png` and add the previews. Set the categories (Message and News Reading, Folders and Filters), the Thunderbird version range (minimum 153.0, no maximum) and no Android.
6. The store reviews the version, which takes days or weeks. Betterbird users install the same file from the same listing, and the listing text says so without claiming store support for Betterbird.
7. After approval, point the README at the listing (the install section and the comparison row) and add the signed file to a GitHub release.

Captions for the previews, in the order to upload them. The first is the 1280x800 listing image and the rest are 1280x720 stills of the same fictional Inbox:

- `docs/images/listing-hero.png`: DesertBird: Vim keys for Thunderbird. The keys teach themselves.
- `docs/images/which-key.png`: Press g and wait. The which-key popup lists every key that can follow and what it does.
- `docs/images/hints.png`: Press f. Every row and control gets a label. Type it to click.
- `docs/images/body-hints.png`: Press f in a message. Every link gets a label too.
- `docs/images/command-line.png`: Press : to run any command by name, with completion as you type.
- `docs/images/filter.png`: Press b m l to keep only the mail of one mailing list.
- `docs/images/followup.png`: Press m f for a reminder on a message: in a day, three days or a week.
- `docs/images/visual-mode.png`: Press v and move to select a range of threads. The label shows VISUAL.
- `docs/images/compose-normal-mode.png`: Compose keeps Vim modes. Escape for normal mode, i for insert, and the status bar says which.
- `docs/images/which-key-message.png`: The popup after m lists the message keys.
- `docs/images/which-key-betterbird.png`: The same popup in Betterbird.
- `docs/images/help-page.png`: A help page that DesertBird builds from your keymap, so it is always current.
- `docs/images/options-page.png`: The options page: settings, and below them the key editor.

Retake them with the `shots/main` piece of the e2e tool (see `tools/e2e/README.md`). Its fixture mail is `tools/e2e/shots_fixture.mjs`. The hero image is `which-key.png` scaled to 880 px on a sand background with the logo and the tagline, rendered with `rsvg-convert` and `magick`.

## Open items for the owner

- Support email: none is set on purpose. The support URL (GitHub issues) is the support channel.
- `data_collection_permissions`: the manifest says `required: ["none"]`, as DesertFox does. `addons-linter` 10.16.0 checks the field against its schema and accepts it, and rejects a bad value. The linter runs in Firefox mode, so it also flags the Experiment and the Thunderbird permissions, which Firefox does not know. Only the live upload shows the store's own verdict.
- `TODO-CHROME-VERBS` in the reviewer notes: the list of chrome verbs is not filled in yet. Search for it in `metadata.json` before the submit.
