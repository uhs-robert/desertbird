#!/bin/sh
# Downloads the pinned Thunderbird ESR tarball into its own new directory and checks its published SHA-256.
# The checksum is the linux-x86_64/en-US line of https://archive.mozilla.org/pub/thunderbird/releases/153.7.0esr/SHA256SUMS.
set -eu
version=153.7.0esr
sha256=dbdda16e00f09c5a61ddad607517014b9e3364bef3499a1a2f64f0a3e575bcb6
dir="${MEASURE_DIR:-/tmp/desertbird-measure}/thunderbird-$version"
[ ! -e "$dir" ] || { echo "$dir exists; remove it first" >&2; exit 1; }
mkdir -p "$dir"
cd "$dir"
curl -fsSO "https://archive.mozilla.org/pub/thunderbird/releases/$version/linux-x86_64/en-US/thunderbird-$version.tar.xz"
echo "$sha256  thunderbird-$version.tar.xz" | sha256sum -c -
tar xf "thunderbird-$version.tar.xz"
