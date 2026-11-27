# Vendored DesertFox code

This folder holds a pinned copy of part of DesertFox, the keyboard-first Firefox extension. DesertFox is the source of the key matcher, the key notation, the keymap compiler, the command registry validator, the command line parser and printer, the completion tokenizer and scorer, and the search query compiler and match stepper. The copy exists so DesertBird can build from its own repository and the store reviewer can match every file against the pin.

- Source: the DesertFox repository, folder `src/shared/` plus the three style files named below
- Commit: `ef9c70a9425fcca90302be1ef1fd3a804b6b9647`, a commit on DesertFox `main` after `v1.0.0` (use the commit, since a tag can move)
- License: MPL-2.0, the same as DesertBird (see `LICENSE` at the repository root). The copied files keep their text unchanged apart from the edits listed below.

The folder mirrors `src/shared/` (the theme files are `themes.ts`, `theme_names.ts` and `theme/{roles,tokens,contrast,derive,theme_file,load}.ts`, all copies at the same pin), except `history_cursor.ts`, which comes from `src/cmdline/`, and `find_match.ts`, which comes from `src/content/caret/`. The three style modules keep their sheets as pure text and have distinct names here, since two upstream files are called `style.ts`: `whichkey_style.ts` and `whichkey_layout.ts` come from `src/content/whichkey/` (`style.ts`, `layout.ts`), and `cmdline_style.ts` comes from `src/cmdline/style.ts`. A file marked `copy` below is byte-identical to the pin. A file marked `edited` differs only by the edits under Local edits. A file marked `stub` is not a DesertFox file: it carries a `STUB` header and stands in for a DesertFox file that is not copied.

## Commands

- `tools/vendor_desertfox.sh <desertfox-checkout>` writes the pinned files, applies `local_edits.patch` and rewrites the table below.
- `tools/vendor_desertfox.sh --verify <desertfox-checkout>` diffs this folder against the pin plus the patch. It reads the checkout with `git show`, never its working tree.
- `npm run defaults:check [<desertfox-checkout>]` compares the setting defaults with the table at the pin (see Setting defaults). It skips with a warning when no checkout is given and `DESERTFOX_DIR` is unset.
- `npm test` runs `test/vendor.test.ts`. It re-hashes each file against the table and fails on a change that has no new row, or an edit with no entry below.

## Local edits

All edits live in `local_edits.patch`. They widen the Firefox-only values of `command.ts` and `registry/define.ts` for the chrome, message and compose sides of Thunderbird.

### `command.ts`

- `RunsIn` is `"background" | "chrome" | "message" | "compose"` instead of `"background" | "content"`. `ContentCommandDef.runs_in` follows as `Exclude<RunsIn, "background">`, so its shape is unchanged.
- `Need` is `string`: an Experiment verb that must be loaded (`view.rows`), or an optional permission name. The Firefox value `"content"` has no meaning here. DesertBird also writes four tab values in it (`list`, `message`, `body`, `tab`, see `src/background/commands/define.ts`), which the router skips because they name no Experiment verb.
- `DynamicValues.from` gains `"tags"` (`"folders"` is already in the list).

### `registry/define.ts`

- The unknown-source check (line 265) accepts `"tags"`, matching the `DynamicValues` edit.
- `check_count_and_modes` accepts the four `RunsIn` values. The rule that a bundle belongs to a command outside the background now reads `(input.runs_in as string) === "background"` instead of `!== "content"`. The cast is there because the type already rules the case out. The rule that a content command has no `run` now applies to every side except `background`, since chrome, message and compose code does not live in the registry. This is the validator half of the `RunsIn` edit.

### `find_match.ts`

- The two imports (`RuntimeRefusal` from `command.ts`, `FindScanAnswer` from `messages/content.ts`) are gone, with the page-side scan they served: `Slicing`, `ScanRegex`, `describe_timeout` and `collect_matches`. DesertBird scans no page text here. What stays is the pure part: `compile_query` (smart case, the costly pattern check, the literal fallback), `nearest_match`, `step_match`, `opposite` and `describe_match`.

### Checked, not edited

- The setting kind `choice_list` in `src/background/config/settings.ts` (a list whose every item is one of `choices`) is the twin of the upstream kind `enum_list`, under a name DesertBird chose. The `statusbar_widgets` setting uses it, with the names `folder` and `position` where upstream has `url`, `scroll` and `tabs`.
- `MODES` already holds `normal`, `insert`, `visual` and `cmdline`. Narrowing it breaks `bundles.ts` and `command.ts`, which name the other DesertFox modes, so the list stays as it is.

## Setting defaults

`default_settings.ts` is a stub: the defaults of the settings DesertBird carries, with the DesertFox values. `tools/check_default_settings.ts` keeps it honest. It loads the table at the pin and fails when the stub or `SETTING_DEFAULTS` (the defaults DesertBird runs with) differs from it. Three lists in that file record the allowed differences, each with its reason:

- `DESERTBIRD_ONLY`: settings DesertBird has and DesertFox has not.
- `DEFAULT_OVERRIDES`: shared names with a deliberate DesertBird default. Today that is `statusbar_widgets`, since the widgets differ.
- `WEB_ONLY_REASONS`: DesertFox settings with a default that DesertBird does not carry, grouped by why. A new DesertFox setting must go on this list or into the stub.

The check reads the pin only. After a re-vendor to a newer pin, run it and fix what it reports.

## Not copied

`keys/prune_tree.ts`, `keys/firefox_shortcut.ts`, `keys/index.ts`, `registry/builtin.ts` (DesertBird writes its own registry), `registry/index.ts`, the binding and file files of the command line (`parse_binding`, `commands_file`) and every DesertFox test. The rest of the DesertFox command line page (`src/cmdline/`) is Firefox specific: its row sources read tabs, bookmarks and history. DesertBird writes its own completer in `src/background/cmdline/` on top of `completion/tokenize.ts` and `score.ts`.

DesertBird never imports `COMPILED_KEYMAP_STORAGE_KEY`. It stores its compiled keymap under its own key.

## Files

<!-- hash table begin -->
| File | Role | Pinned sha256 | Local sha256 |
| --- | --- | --- | --- |
| `bundles.ts` | copy | `4b54fea19cd39e1fd0d27453b223e3b48f54bddee7ef603dd041451518de8e00` | `4b54fea19cd39e1fd0d27453b223e3b48f54bddee7ef603dd041451518de8e00` |
| `cmdline_style.ts` | copy | `c9cadd4ff16f2bf8a4e558617025b2e3e3fb48be40525e611275ad8e1e007d36` | `c9cadd4ff16f2bf8a4e558617025b2e3e3fb48be40525e611275ad8e1e007d36` |
| `command.ts` | edited | `93c7517f42e548fa667c88cb19fc485876b24b736f55e029148a365094b5bed8` | `85fea67fdd60d875379b238403a4e7adf5226ef01acb0cb746e8fcf8b761579a` |
| `completion/keys.ts` | copy | `5844a5c177682bacb0966aa17064e7211739d3ff7ba0e6ef1207afde1021b4ff` | `5844a5c177682bacb0966aa17064e7211739d3ff7ba0e6ef1207afde1021b4ff` |
| `completion/tokenize.ts` | copy | `34e96e891167a023890e2b1f09477c7edcc11a733605f2b1563e1fc7fea4819d` | `34e96e891167a023890e2b1f09477c7edcc11a733605f2b1563e1fc7fea4819d` |
| `config.ts` | stub | `-` | `782044001ffb548804beac17fbae8f01eafa4c800181b555729418a27cb7f41e` |
| `default_settings.ts` | stub | `-` | `d52fae25d23c768b51e4d1d7409400b6dfa88a9886c6d11b8ec78f8848ea5f21` |
| `find_match.ts` | edited | `5498b1552b757414166e60ddf4144121922e73f0ae8df55f74e41899fb85c09e` | `f320289d274b638326562913c43ad2c9a83087df77de5952b4ab486fd2c8e31a` |
| `history_cursor.ts` | copy | `281922828ff8ce21aa527ce550f439f990102ba9ff3b4667ab6c2aff481d3f84` | `281922828ff8ce21aa527ce550f439f990102ba9ff3b4667ab6c2aff481d3f84` |
| `invocation.ts` | copy | `c7417bf1998040a648634014061d2be531670f09aafb1836c3549aca94fca0da` | `c7417bf1998040a648634014061d2be531670f09aafb1836c3549aca94fca0da` |
| `keymap.ts` | copy | `34fd5e1bf312f039a5f7dd5c377267c7e49670dc62c7ec71930135374d298d66` | `34fd5e1bf312f039a5f7dd5c377267c7e49670dc62c7ec71930135374d298d66` |
| `keys/compiler.ts` | copy | `8e45ea03f119020d8ebc1f08ce11b5f7008e57187af7b6c6bc587576ecc42857` | `8e45ea03f119020d8ebc1f08ce11b5f7008e57187af7b6c6bc587576ecc42857` |
| `keys/matcher.ts` | copy | `fae6222b3fe77c41bd590c746121e2d367ca8b3ea828463d93d26a8f414361aa` | `fae6222b3fe77c41bd590c746121e2d367ca8b3ea828463d93d26a8f414361aa` |
| `keys/notation.ts` | copy | `09556b643ff85cd62cf5839084b6e3117c699084ca6bee0efe70084a030dac4d` | `09556b643ff85cd62cf5839084b6e3117c699084ca6bee0efe70084a030dac4d` |
| `keys/token.ts` | copy | `51e51b0a508e26fa80d3ec3d44eb34ff87c756f1032c6d981546c18bb48f34c3` | `51e51b0a508e26fa80d3ec3d44eb34ff87c756f1032c6d981546c18bb48f34c3` |
| `match_pattern.ts` | stub | `-` | `d29cde2dbc27f7eb57f8aefefd4b670259355b4e36403e99cfa3fcc4ecf8a3e7` |
| `messages/content.ts` | stub | `-` | `240adea837d6a8c6f4d6fdb1e366bd813044856263d9ed37ba63f61618ce9350` |
| `prefix_tree.ts` | copy | `3b3c8a26ea0907dca28c5f5a1e7387144cb19dd610999c65a949b830f6b71479` | `3b3c8a26ea0907dca28c5f5a1e7387144cb19dd610999c65a949b830f6b71479` |
| `register_names.ts` | copy | `1d75546949b7bab964fde8c482921058b95cbab007d8d244c0bda187721bed01` | `1d75546949b7bab964fde8c482921058b95cbab007d8d244c0bda187721bed01` |
| `registry/check_args.ts` | copy | `a9656151caf562f85a3ef7c3d6c639cb5f97b9fe6cd3a9e80cb8cc6aa14dcbf0` | `a9656151caf562f85a3ef7c3d6c639cb5f97b9fe6cd3a9e80cb8cc6aa14dcbf0` |
| `registry/check_shape.ts` | copy | `6536efefafc6324169922b80de8dcec3317ec24c073e3225c9b2ba16839185c5` | `6536efefafc6324169922b80de8dcec3317ec24c073e3225c9b2ba16839185c5` |
| `registry/command_line.ts` | copy | `3f4a603c09673fdc53535b5147203031e1ef7a3b3b1242f08feccea8dfcbad3b` | `3f4a603c09673fdc53535b5147203031e1ef7a3b3b1242f08feccea8dfcbad3b` |
| `registry/define.ts` | edited | `373b5a4aa14297de780ce2ea6a68065c7b43175cebba94fbe2a97628cbbff7fb` | `12a652fb35fc445f73499854e510b545bc575b2964b7fc1cceb1dbdf9e5215d6` |
| `registry/params.ts` | copy | `62137e99703e3ab8ec7cb7a04933a78b92fbeeb47bb8908808092d0c728bd9b8` | `62137e99703e3ab8ec7cb7a04933a78b92fbeeb47bb8908808092d0c728bd9b8` |
| `registry/print_command.ts` | copy | `c79b5b6fe3eef65e9af781926dcd2ccb6d3ae08269c525a03cee903487aef627` | `c79b5b6fe3eef65e9af781926dcd2ccb6d3ae08269c525a03cee903487aef627` |
| `registry/single_quote.ts` | copy | `69108762c4226d0040ca8c53532b00013e1f7ca2ff9581d90da373ea90d233b9` | `69108762c4226d0040ca8c53532b00013e1f7ca2ff9581d90da373ea90d233b9` |
| `registry/summary.ts` | copy | `3ec30b815417c7f27c2b1dd685f48b033870f21ef2504c505be2606899acb78e` | `3ec30b815417c7f27c2b1dd685f48b033870f21ef2504c505be2606899acb78e` |
| `registry/usage.ts` | copy | `76ee0dab6e7ae055caa44bbd2a80f148ece2fc270ea59cbe8f1e273ec44156c5` | `76ee0dab6e7ae055caa44bbd2a80f148ece2fc270ea59cbe8f1e273ec44156c5` |
| `score.ts` | copy | `30841c73642a307befde7b4019b2df70d322d7b357155c4ffe092515c3afa1ef` | `30841c73642a307befde7b4019b2df70d322d7b357155c4ffe092515c3afa1ef` |
| `settings_schema.ts` | stub | `-` | `376fcfdfe3c389f1451d5b291db23effc5ef77d6445ddae3627a4ee92d2a93aa` |
| `settings_table.ts` | stub | `-` | `bae884acd649e00d5c46f549870c1130c314f94aa7fa1374c4d1c1fb3e640860` |
| `table_constants.ts` | stub | `-` | `8e953d6ed720a6477e3c3ff9b76fe8627b177dad5c978ac7336046d2c197ffc2` |
| `theme/contrast.ts` | copy | `1456a9a3746efac46dc9f19e47c13c06896b4d52cc1349fbd0aab679e99838ce` | `1456a9a3746efac46dc9f19e47c13c06896b4d52cc1349fbd0aab679e99838ce` |
| `theme/derive.ts` | copy | `43a49337b0c4b3e39ed003b82b7afb673774e55dcbe19881afe8d536225973e1` | `43a49337b0c4b3e39ed003b82b7afb673774e55dcbe19881afe8d536225973e1` |
| `theme/load.ts` | copy | `87516a677b658f67f81d0dfc8ddc7ec2301e212577f2a867c706e5172855c88c` | `87516a677b658f67f81d0dfc8ddc7ec2301e212577f2a867c706e5172855c88c` |
| `theme_names.ts` | copy | `6ba4364ee4593f357c9b735e05add0d4844b45610dbfdb4d741e79d232d42a0e` | `6ba4364ee4593f357c9b735e05add0d4844b45610dbfdb4d741e79d232d42a0e` |
| `theme/roles.ts` | copy | `7c89195245368e91fef2b6ba8c64f30a7c8400b7b4f318987b48cbf9e3484fbb` | `7c89195245368e91fef2b6ba8c64f30a7c8400b7b4f318987b48cbf9e3484fbb` |
| `themes.ts` | copy | `c994627b9a4016ed3ae2d8e650dae61715c3c03b8a39aac772feb923a45d6515` | `c994627b9a4016ed3ae2d8e650dae61715c3c03b8a39aac772feb923a45d6515` |
| `theme/theme_file.ts` | copy | `260f325a675df05e4f513056f4dc495e8fb4c901aba0b7e1c92b19927a69ab94` | `260f325a675df05e4f513056f4dc495e8fb4c901aba0b7e1c92b19927a69ab94` |
| `theme/tokens.ts` | copy | `96d1fa86ac7fac8a4a60ccc0c34a8af8de0afaf927a4067783c043d0bd365c30` | `96d1fa86ac7fac8a4a60ccc0c34a8af8de0afaf927a4067783c043d0bd365c30` |
| `whichkey_layout.ts` | copy | `e5e187e5fdacedda2cd1f281af2b88e2dbd44d249fb3aa9c6bbf07afd7b8b3fe` | `e5e187e5fdacedda2cd1f281af2b88e2dbd44d249fb3aa9c6bbf07afd7b8b3fe` |
| `whichkey_style.ts` | copy | `9359ce66323340995330e101e01fd3a0714f4280a544cacad28174723a06240f` | `9359ce66323340995330e101e01fd3a0714f4280a544cacad28174723a06240f` |
<!-- hash table end -->
