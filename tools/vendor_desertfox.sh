#!/usr/bin/env bash
# Copies the pinned DesertFox files into vendor/desertfox/ and checks that the copy matches the pin.
#
#   tools/vendor_desertfox.sh <desertfox-checkout>             copy, apply local_edits.patch, rewrite the hash table
#   tools/vendor_desertfox.sh --verify <desertfox-checkout>    diff the copy against the pin plus the patch
#
# Files come from `git show <sha>:<path>`, never from the checkout's working tree.
# Stand-ins (files with a STUB header) are written by hand and never touched here.
set -euo pipefail

PIN_SHA=33a68a009791563e5ba57999e43b5c8d45c8ca6d
UPSTREAM_DIR=src/shared
# A file under `completion/` comes from `src/cmdline/completion/` upstream, and so does `history_cursor.ts` (`src/cmdline/`). Every other file mirrors `src/shared/`.
COPIED_FILES=(
  keys/token.ts keys/notation.ts keys/matcher.ts keys/compiler.ts
  register_names.ts prefix_tree.ts command.ts invocation.ts keymap.ts bundles.ts score.ts
  registry/define.ts registry/check_args.ts registry/check_shape.ts registry/params.ts registry/summary.ts
  registry/command_line.ts registry/usage.ts registry/print_command.ts registry/single_quote.ts
  completion/tokenize.ts history_cursor.ts
  themes.ts theme_names.ts theme/roles.ts theme/tokens.ts theme/contrast.ts theme/derive.ts theme/theme_file.ts theme/load.ts
)

upstream_path_of() {
  local file=$1
  if [[ $file == completion/* || $file == history_cursor.ts ]]; then echo "src/cmdline/$file"; else echo "$UPSTREAM_DIR/$file"; fi
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
vendor_dir=$repo_root/vendor/desertfox
patch_file=$vendor_dir/local_edits.patch
table_begin='<!-- hash table begin -->'
table_end='<!-- hash table end -->'

verify=false
if [[ ${1:-} == --verify ]]; then
  verify=true
  shift
fi
checkout=${1:?usage: vendor_desertfox.sh [--verify] <desertfox-checkout>}
git -C "$checkout" cat-file -e "$PIN_SHA^{commit}"

# Writes the pinned files, then the local edits, into <target>/vendor/desertfox.
write_pinned_tree() {
  local target=$1 file
  for file in "${COPIED_FILES[@]}"; do
    mkdir -p "$target/vendor/desertfox/$(dirname "$file")"
    git -C "$checkout" show "$PIN_SHA:$(upstream_path_of "$file")" >"$target/vendor/desertfox/$file"
  done
  (cd "$target" && git apply "$patch_file")
}

if $verify; then
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' EXIT
  write_pinned_tree "$scratch"
  status=0
  for file in "${COPIED_FILES[@]}"; do
    diff -u "$scratch/vendor/desertfox/$file" "$vendor_dir/$file" || status=1
  done
  [[ $status == 0 ]] && echo "vendor/desertfox matches $PIN_SHA plus local_edits.patch"
  exit $status
fi

# The patch is applied to pinned files, so write them first without it.
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
for file in "${COPIED_FILES[@]}"; do
  mkdir -p "$scratch/$(dirname "$file")"
  git -C "$checkout" show "$PIN_SHA:$(upstream_path_of "$file")" >"$scratch/$file"
done
write_pinned_tree "$repo_root"

# One row per file: the sha256 of the pinned file ("-" for a stand-in) and of the file as it sits here.
rows=$(cd "$vendor_dir" && find . -type f -name '*.ts' | sed 's|^\./||' | sort | while read -r file; do
  local_hash=$(sha256sum "$file" | cut -d' ' -f1)
  if [[ -f $scratch/$file ]]; then
    upstream_hash=$(sha256sum "$scratch/$file" | cut -d' ' -f1)
    role=$([[ $upstream_hash == "$local_hash" ]] && echo copy || echo edited)
  else
    upstream_hash=-
    role=stub
  fi
  echo "| \`$file\` | $role | \`$upstream_hash\` | \`$local_hash\` |"
done)
table=$(printf '%s\n| File | Role | Pinned sha256 | Local sha256 |\n| --- | --- | --- | --- |\n%s\n%s' "$table_begin" "$rows" "$table_end")
TABLE=$table perl -0pi -e 'BEGIN { $t = $ENV{TABLE}; $b = quotemeta("<!-- hash table begin -->"); $e = quotemeta("<!-- hash table end -->") } s/$b.*?$e/$t/s' "$vendor_dir/VENDOR.md"
echo "copied ${#COPIED_FILES[@]} files from $PIN_SHA into vendor/desertfox"
