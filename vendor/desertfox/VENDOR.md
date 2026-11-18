# Vendored DesertFox code

This folder holds a pinned copy of part of DesertFox, the keyboard-first Firefox extension. DesertFox is the source of the key matcher, the key notation, the keymap compiler, the command registry validator, the command line parser and printer, the completion tokenizer and scorer, and the search query compiler and match stepper. The copy exists so DesertBird can build from its own repository and the store reviewer can match every file against the pin.

- Source: the DesertFox repository, folder `src/shared/` plus the three style files named below
- Commit: `b0e41305a64ee347f7c6fb2ded5c5c3af70a12e7`, a commit on DesertFox `main` after `v1.0.0` (use the commit, since a tag can move)
- License: MPL-2.0, the same as DesertBird (see `LICENSE` at the repository root). The copied files keep their text unchanged apart from the edits listed below.

The folder mirrors `src/shared/` (the theme files are `themes.ts`, `theme_names.ts` and `theme/{roles,tokens,contrast,derive,theme_file,load}.ts`, all copies at the same pin), except `completion/tokenize.ts` and `history_cursor.ts`, which come from `src/cmdline/`, and `find_match.ts`, which comes from `src/content/caret/`. The three style modules keep their sheets as pure text and have distinct names here, since two upstream files are called `style.ts`: `whichkey_style.ts` and `whichkey_layout.ts` come from `src/content/whichkey/` (`style.ts`, `layout.ts`), and `cmdline_style.ts` comes from `src/cmdline/style.ts`. A file marked `copy` below is byte-identical to the pin. A file marked `edited` differs only by the edits under Local edits. A file marked `stub` is not a DesertFox file: it carries a `STUB` header and stands in for a DesertFox file that is not copied.

## Commands

- `tools/vendor_desertfox.sh <desertfox-checkout>` writes the pinned files, applies `local_edits.patch` and rewrites the table below.
- `tools/vendor_desertfox.sh --verify <desertfox-checkout>` diffs this folder against the pin plus the patch. It reads the checkout with `git show`, never its working tree.
- `npm test` runs `test/vendor.test.ts`. It re-hashes each file against the table and fails on a change that has no new row, or an edit with no entry below.

## Local edits

All edits live in `local_edits.patch`. They widen the Firefox-only values of `command.ts` and `registry/define.ts` for the chrome, message and compose sides of Thunderbird.

### `command.ts`

- `RunsIn` is `"background" | "chrome" | "message" | "compose"` instead of `"background" | "content"`. `ContentCommandDef.runs_in` follows as `Exclude<RunsIn, "background">`, so its shape is unchanged.
- `Need` is `string`: an Experiment verb that must be loaded (`view.rows`), or an optional permission name. The Firefox value `"content"` has no meaning here.
- `DynamicValues.from` gains `"tags"` (`"folders"` is already in the list).

### `registry/define.ts`

- The unknown-source check (line 265) accepts `"tags"`, matching the `DynamicValues` edit.
- `check_count_and_modes` accepts the four `RunsIn` values. The rule that a bundle belongs to a command outside the background now reads `(input.runs_in as string) === "background"` instead of `!== "content"`. The cast is there because the type already rules the case out. The rule that a content command has no `run` now applies to every side except `background`, since chrome, message and compose code does not live in the registry. This is the validator half of the `RunsIn` edit.

### `completion/tokenize.ts`

- The three imports of `../../shared/...` read `../...`, because the file sits beside the shared files here and in a `cmdline/completion/` folder upstream.

### `find_match.ts`

- The two imports (`RuntimeRefusal` from `command.ts`, `FindScanAnswer` from `messages.ts`) are gone, with the page-side scan they served: `Slicing`, `ScanRegex`, `describe_timeout` and `collect_matches`. DesertBird scans no page text here. What stays is the pure part: `compile_query` (smart case, the costly pattern check, the literal fallback), `nearest_match`, `step_match`, `opposite` and `describe_match`.

### Checked, not edited

- `MODES` already holds `normal`, `insert`, `visual` and `cmdline`. Narrowing it breaks `bundles.ts` and `command.ts`, which name the other DesertFox modes, so the list stays as it is.

## Not copied

`keys/prune_tree.ts`, `keys/firefox_shortcut.ts`, `keys/index.ts`, `registry/builtin.ts` (DesertBird writes its own registry), `registry/index.ts`, the binding and file files of the command line (`parse_binding`, `commands_file`) and every DesertFox test. The rest of the DesertFox command line page (`src/cmdline/`) is Firefox specific: its row sources read tabs, bookmarks and history. DesertBird writes its own completer in `src/background/cmdline/` on top of `completion/tokenize.ts` and `score.ts`.

DesertBird never imports `COMPILED_KEYMAP_STORAGE_KEY`. It stores its compiled keymap under its own key.

## Files

<!-- hash table begin -->
| File | Role | Pinned sha256 | Local sha256 |
| --- | --- | --- | --- |
| `bundles.ts` | copy | `3ff270a378b283a0c6a619ca1f0e6a1d8ecc3d67926c14c28ceec69d97063059` | `3ff270a378b283a0c6a619ca1f0e6a1d8ecc3d67926c14c28ceec69d97063059` |
| `cmdline_style.ts` | copy | `c9cadd4ff16f2bf8a4e558617025b2e3e3fb48be40525e611275ad8e1e007d36` | `c9cadd4ff16f2bf8a4e558617025b2e3e3fb48be40525e611275ad8e1e007d36` |
| `command.ts` | edited | `413d108780e94db8094856820a36ebc0a00105c3aa00b530a5348b66ef90eca3` | `e44c1fc11de62c27b31044b2a36bf9be8e38eb2ca5ef78376bf21d535529c641` |
| `completion/tokenize.ts` | edited | `6f2b789a3f91222a2a2b681ee42cd45609c919eea15b47daf3c6b06a9665d3a2` | `34e96e891167a023890e2b1f09477c7edcc11a733605f2b1563e1fc7fea4819d` |
| `config.ts` | stub | `-` | `782044001ffb548804beac17fbae8f01eafa4c800181b555729418a27cb7f41e` |
| `default_settings.ts` | stub | `-` | `eca9d79725e87c58fba673060fcd28eff23b601e840b5da0bbb84aab1fb3ec9f` |
| `find_match.ts` | edited | `67f4bd84db09a3d924dd436b261f6fee0f644156dad2a0bf5b6f95394165712d` | `f320289d274b638326562913c43ad2c9a83087df77de5952b4ab486fd2c8e31a` |
| `history_cursor.ts` | copy | `281922828ff8ce21aa527ce550f439f990102ba9ff3b4667ab6c2aff481d3f84` | `281922828ff8ce21aa527ce550f439f990102ba9ff3b4667ab6c2aff481d3f84` |
| `invocation.ts` | copy | `9866e98bfa321db619ef51dc59cda1d65e7d35f04e43bf27c7e69ac582f0916b` | `9866e98bfa321db619ef51dc59cda1d65e7d35f04e43bf27c7e69ac582f0916b` |
| `keymap.ts` | copy | `ff1bf49115316cbd304862586a00cad756c6ebcfa9fc60b71e06b84dfd8f26d4` | `ff1bf49115316cbd304862586a00cad756c6ebcfa9fc60b71e06b84dfd8f26d4` |
| `keys/compiler.ts` | copy | `5286e95b975aa18410963ce37af8fc620e297c3a9e73225de5d4f90100b7817c` | `5286e95b975aa18410963ce37af8fc620e297c3a9e73225de5d4f90100b7817c` |
| `keys/matcher.ts` | copy | `34a8b0604d452e484c0bbf1cc5b49878f24d119a95866a0fbede5d5935cb31eb` | `34a8b0604d452e484c0bbf1cc5b49878f24d119a95866a0fbede5d5935cb31eb` |
| `keys/notation.ts` | copy | `09556b643ff85cd62cf5839084b6e3117c699084ca6bee0efe70084a030dac4d` | `09556b643ff85cd62cf5839084b6e3117c699084ca6bee0efe70084a030dac4d` |
| `keys/token.ts` | copy | `51e51b0a508e26fa80d3ec3d44eb34ff87c756f1032c6d981546c18bb48f34c3` | `51e51b0a508e26fa80d3ec3d44eb34ff87c756f1032c6d981546c18bb48f34c3` |
| `match_pattern.ts` | stub | `-` | `d29cde2dbc27f7eb57f8aefefd4b670259355b4e36403e99cfa3fcc4ecf8a3e7` |
| `messages.ts` | stub | `-` | `ac9b5b4f605f061373d26378fb14c0bed479699bfcb05d371a9e34d05e57b1e5` |
| `prefix_tree.ts` | copy | `e933fef6d0d7fe28189b7f1d941d12a6231cf14860f67938fabaca5a413b5ff4` | `e933fef6d0d7fe28189b7f1d941d12a6231cf14860f67938fabaca5a413b5ff4` |
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
| `score.ts` | copy | `cd1b001fa2fb71ee8ff6e9cdacf710a400fe62b5a570f8df67a18d21dd75961b` | `cd1b001fa2fb71ee8ff6e9cdacf710a400fe62b5a570f8df67a18d21dd75961b` |
| `settings_schema.ts` | stub | `-` | `376fcfdfe3c389f1451d5b291db23effc5ef77d6445ddae3627a4ee92d2a93aa` |
| `settings_table.ts` | stub | `-` | `226647ddb8619857494875c8267ca8c2f0e0bac52930c8e150de172608e28986` |
| `table_constants.ts` | stub | `-` | `8e953d6ed720a6477e3c3ff9b76fe8627b177dad5c978ac7336046d2c197ffc2` |
| `theme/contrast.ts` | copy | `1456a9a3746efac46dc9f19e47c13c06896b4d52cc1349fbd0aab679e99838ce` | `1456a9a3746efac46dc9f19e47c13c06896b4d52cc1349fbd0aab679e99838ce` |
| `theme/derive.ts` | copy | `c2a70b2c3c2de7ebb7c0737d255e4e32a5d58edc48337a6d1f8ee725bfa15ce5` | `c2a70b2c3c2de7ebb7c0737d255e4e32a5d58edc48337a6d1f8ee725bfa15ce5` |
| `theme/load.ts` | copy | `87516a677b658f67f81d0dfc8ddc7ec2301e212577f2a867c706e5172855c88c` | `87516a677b658f67f81d0dfc8ddc7ec2301e212577f2a867c706e5172855c88c` |
| `theme_names.ts` | copy | `6ba4364ee4593f357c9b735e05add0d4844b45610dbfdb4d741e79d232d42a0e` | `6ba4364ee4593f357c9b735e05add0d4844b45610dbfdb4d741e79d232d42a0e` |
| `theme/roles.ts` | copy | `fcc88cf9c8483ac53c0f7346fb8e2ad595c5404d90a637d33ce7b5452cc5bab7` | `fcc88cf9c8483ac53c0f7346fb8e2ad595c5404d90a637d33ce7b5452cc5bab7` |
| `themes.ts` | copy | `19f7f05dc839f3f74d9bc16a3fefef0e60d74773489d08cbef81ecd9094b048f` | `19f7f05dc839f3f74d9bc16a3fefef0e60d74773489d08cbef81ecd9094b048f` |
| `theme/theme_file.ts` | copy | `260f325a675df05e4f513056f4dc495e8fb4c901aba0b7e1c92b19927a69ab94` | `260f325a675df05e4f513056f4dc495e8fb4c901aba0b7e1c92b19927a69ab94` |
| `theme/tokens.ts` | copy | `96d1fa86ac7fac8a4a60ccc0c34a8af8de0afaf927a4067783c043d0bd365c30` | `96d1fa86ac7fac8a4a60ccc0c34a8af8de0afaf927a4067783c043d0bd365c30` |
| `whichkey_layout.ts` | copy | `e5e187e5fdacedda2cd1f281af2b88e2dbd44d249fb3aa9c6bbf07afd7b8b3fe` | `e5e187e5fdacedda2cd1f281af2b88e2dbd44d249fb3aa9c6bbf07afd7b8b3fe` |
| `whichkey_style.ts` | copy | `9359ce66323340995330e101e01fd3a0714f4280a544cacad28174723a06240f` | `9359ce66323340995330e101e01fd3a0714f4280a544cacad28174723a06240f` |
<!-- hash table end -->
