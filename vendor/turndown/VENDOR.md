# Vendored turndown

`turndown` turns the user's part of an HTML message into Markdown for the external editor (`src/background/compose_markdown.ts`). This folder holds the exact release file, unchanged, so the store reviewer can match it against the release. The manifest loads it beside `background.js` and the build copies it as it is. It never goes into the esbuild bundle.

- Package: `turndown` on npm, version `7.2.5`
- Release: `https://registry.npmjs.org/turndown/-/turndown-7.2.5.tgz`, npm integrity `sha512-EKZvCCFHh8sWttpAMs10U6niZFJ2cpz8LkCPlylxoG4JcHF50J7EHnnBW3AY1qXtUMu7kDjCp7dnggB1sIbqEQ==`
- License: MIT, in `LICENSE` from the same release

To update, download the tarball into a new empty folder, check its sha512 against the integrity npm publishes (`npm view turndown@<version> dist.integrity`), copy `package/dist/turndown.js` and `package/LICENSE` here, and update this file. `npm test` (`test/vendor_libraries.test.ts`) fails until the rows below match.

| File | Release path | sha256 |
| --- | --- | --- |
| `turndown.js` | `package/dist/turndown.js` | `f46330e27d6009ecc3b001237e735cf58293772d2a465436a61de6f536b59a81` |
| `LICENSE` | `package/LICENSE` | `a055e3a15db4b4cbb5af381230eba085603126d7d5d8c4dae45ee85b877a9729` |
