# Vendored marked

`marked` turns the Markdown of the external editor back into HTML for an HTML message (`src/background/compose_markdown.ts`). This folder holds the exact release file, unchanged, so the store reviewer can match it against the release. The manifest loads it beside `background.js` and the build copies it as it is. It never goes into the esbuild bundle.

- Package: `marked` on npm, version `18.2.1`
- Release: `https://registry.npmjs.org/marked/-/marked-18.2.1.tgz`, npm integrity `sha512-ii4bxCTCqqwpT86XZWgJNs+ZnAIZksmLGYMViWA7PDIXYIeNo1x6cDdX3JOip9NM/cI6p8z57FxliACboTruMA==`
- License: MIT, in `LICENSE` from the same release

To update, download the tarball into a new empty folder, check its sha512 against the integrity npm publishes (`npm view marked@<version> dist.integrity`), copy `package/lib/marked.umd.js` and `package/LICENSE` here, and update this file. `npm test` (`test/vendor_libraries.test.ts`) fails until the rows below match.

| File | Release path | sha256 |
| --- | --- | --- |
| `marked.umd.js` | `package/lib/marked.umd.js` | `bb95d4c15f1289f78486eaacebf3bb18688475ed58a040ef762ed49337090542` |
| `LICENSE` | `package/LICENSE` | `8e3a3f82f59a60958f56ca08f445647c32a4733dc7ca6c2c46f6eb898471ab9c` |
