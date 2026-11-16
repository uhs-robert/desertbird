# Vendored DesertFox code

This folder holds a pinned copy of part of DesertFox, the keyboard-first Firefox extension by the same author. DesertFox is the source of the key matcher, the key notation, the keymap compiler and the command registry validator. The copy exists so DesertBird can build from its own repository and the store reviewer can match every file against the pin.

- Source: the DesertFox repository, folder `src/shared/`
- Tag: `v1.0.0`
- Commit: `33a68a009791563e5ba57999e43b5c8d45c8ca6d` (use the commit, since a tag can move)
- License: MPL-2.0, the same as DesertBird (see `LICENSE` at the repository root). The copied files keep their text unchanged apart from the edits listed below.

The folder mirrors `src/shared/`. A file marked `copy` below is byte-identical to the pin. A file marked `edited` differs only by the edits under Local edits. A file marked `stub` is not a DesertFox file: it carries a `STUB` header and stands in for a DesertFox file that is not copied.

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

### Checked, not edited

- `MODES` already holds `normal`, `insert`, `visual` and `cmdline`. Narrowing it breaks `bundles.ts` and `command.ts`, which name the other DesertFox modes, so the list stays as it is.

## Not copied

`keys/prune_tree.ts`, `keys/firefox_shortcut.ts`, `keys/index.ts`, `registry/builtin.ts` (DesertBird writes its own registry), `registry/index.ts` (it re-exports the command-line files below), the command-line files (`command_line`, `usage`, `parse_binding`, `print_command`, `single_quote`, `commands_file`) and every DesertFox test. The command-line files wait for the phase that needs them.

DesertBird never imports `COMPILED_KEYMAP_STORAGE_KEY`. It stores its compiled keymap under its own key.

## Files

<!-- hash table begin -->
| File | Role | Pinned sha256 | Local sha256 |
| --- | --- | --- | --- |
| `bundles.ts` | copy | `501a602b76060a4af7c06ffd3c470babf3dc38cbb258718cd0063db847a400a6` | `501a602b76060a4af7c06ffd3c470babf3dc38cbb258718cd0063db847a400a6` |
| `command.ts` | edited | `413d108780e94db8094856820a36ebc0a00105c3aa00b530a5348b66ef90eca3` | `e44c1fc11de62c27b31044b2a36bf9be8e38eb2ca5ef78376bf21d535529c641` |
| `config.ts` | stub | `-` | `d7ef6258d1c3b1f8d791212f4af4875c5a48f538c4b8ae42fccec57c8fe2497a` |
| `default_settings.ts` | stub | `-` | `c053a2a8cf518e95b72f0cccd60102c25909eccd5c6729f74e634351e6967827` |
| `invocation.ts` | copy | `ed9da0647ee02b4bba5193458662a666402e28ee2cd6626ecfbe0201a4d8aeb9` | `ed9da0647ee02b4bba5193458662a666402e28ee2cd6626ecfbe0201a4d8aeb9` |
| `keymap.ts` | copy | `ff1bf49115316cbd304862586a00cad756c6ebcfa9fc60b71e06b84dfd8f26d4` | `ff1bf49115316cbd304862586a00cad756c6ebcfa9fc60b71e06b84dfd8f26d4` |
| `keys/compiler.ts` | copy | `24f0f77dda27af768b8f9f5b7788bd22281f454888565ba1ba1f397f91fbb601` | `24f0f77dda27af768b8f9f5b7788bd22281f454888565ba1ba1f397f91fbb601` |
| `keys/matcher.ts` | copy | `34a8b0604d452e484c0bbf1cc5b49878f24d119a95866a0fbede5d5935cb31eb` | `34a8b0604d452e484c0bbf1cc5b49878f24d119a95866a0fbede5d5935cb31eb` |
| `keys/notation.ts` | copy | `09556b643ff85cd62cf5839084b6e3117c699084ca6bee0efe70084a030dac4d` | `09556b643ff85cd62cf5839084b6e3117c699084ca6bee0efe70084a030dac4d` |
| `keys/token.ts` | copy | `51e51b0a508e26fa80d3ec3d44eb34ff87c756f1032c6d981546c18bb48f34c3` | `51e51b0a508e26fa80d3ec3d44eb34ff87c756f1032c6d981546c18bb48f34c3` |
| `match_pattern.ts` | stub | `-` | `07dfefff8f454c2c68ccc221801694719155147d0fd22e25737df1d00af2d39c` |
| `messages.ts` | stub | `-` | `ac9b5b4f605f061373d26378fb14c0bed479699bfcb05d371a9e34d05e57b1e5` |
| `prefix_tree.ts` | copy | `8db7f148583e3f371635a6830536ba8d52c0079e070ea51867f22af69926f4c9` | `8db7f148583e3f371635a6830536ba8d52c0079e070ea51867f22af69926f4c9` |
| `register_names.ts` | copy | `1d75546949b7bab964fde8c482921058b95cbab007d8d244c0bda187721bed01` | `1d75546949b7bab964fde8c482921058b95cbab007d8d244c0bda187721bed01` |
| `registry/check_args.ts` | copy | `a9656151caf562f85a3ef7c3d6c639cb5f97b9fe6cd3a9e80cb8cc6aa14dcbf0` | `a9656151caf562f85a3ef7c3d6c639cb5f97b9fe6cd3a9e80cb8cc6aa14dcbf0` |
| `registry/check_shape.ts` | copy | `ceffccc1d5a69ba605b89f0853fccc30924c8451ba231d276ab8e0adf0e0aca4` | `ceffccc1d5a69ba605b89f0853fccc30924c8451ba231d276ab8e0adf0e0aca4` |
| `registry/define.ts` | edited | `fef06161fec4c009b6f028fc1348e4de74eec4581cf1adab61b1ec8d655c5a5c` | `4e4f4c71de93e59eb8ec8b369d8b93004c6db2d52bdd30d5d0fb5b2b4e8972b9` |
| `registry/params.ts` | copy | `62137e99703e3ab8ec7cb7a04933a78b92fbeeb47bb8908808092d0c728bd9b8` | `62137e99703e3ab8ec7cb7a04933a78b92fbeeb47bb8908808092d0c728bd9b8` |
| `registry/summary.ts` | copy | `3ec30b815417c7f27c2b1dd685f48b033870f21ef2504c505be2606899acb78e` | `3ec30b815417c7f27c2b1dd685f48b033870f21ef2504c505be2606899acb78e` |
| `settings_schema.ts` | stub | `-` | `376fcfdfe3c389f1451d5b291db23effc5ef77d6445ddae3627a4ee92d2a93aa` |
| `settings_table.ts` | stub | `-` | `ec920ec05c37ed29c3c8729043f5eb836558516529207620e7771025444d44a6` |
| `table_constants.ts` | stub | `-` | `3bd44266a9390a65304a86b502e6d7ecd257dd68115cd2e2303ab8e3ffb4c2a2` |
<!-- hash table end -->
