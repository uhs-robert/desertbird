# Build instructions

These steps build the add-on package from this source archive. They need Node, npm and `zip`, and no other tool.

## Needs

- Node 24 and npm (npm 11 comes with it). The same source also built on Node 26.
- The `zip` command. The build calls it to write the package.
- Linux or macOS. The build was made on Linux.

## Steps

Run these in the folder that holds this file.

```bash
npm ci
npm run build
```

The built add-on is `dist/`. The submitted package is `dist/desertbird.xpi`.

## What each step does

- `npm ci` installs the exact dependencies of `package-lock.json`. They are build tools only (TypeScript and esbuild). No dependency enters the package.
- `npm run build` typechecks with TypeScript, then bundles each script with esbuild (`tools/build.mjs`). It copies the pages, the schemas, the icon, the manifest and the `vendor/` files as they are, and zips them into `dist/desertbird.xpi`. The build does not minify. The esbuild metafiles go to `dist/meta/` and stay out of the package.

## Compare with the submitted package

`zip` stores the modification time of each file and lists the files in the order of the disk, so two builds of the same source differ in the bytes of the `.xpi` file. The files inside are the same. To compare, unpack both packages into new empty folders and diff the folders:

```bash
mkdir mine theirs
unzip -q dist/desertbird.xpi -d mine
unzip -q /path/to/submitted.xpi -d theirs
diff -r mine theirs && echo same
```

A clean build of the 1.0.0 archive and a second build of the same commit gave no difference in this comparison.

## Source and bundled files

Every file in the package comes from `src/`, `vendor/` and `tools/build.mjs` in this archive. The bundles are the esbuild output of `src/`, with one pinned copy of DesertFox source (`vendor/desertfox/`, MPL-2.0, see its `VENDOR.md`) compiled into `background.js`.

Two libraries ship as their unchanged release files, loaded by the manifest beside `background.js` and never bundled: `vendor/marked/marked.umd.js` and `vendor/turndown/turndown.js`. `marked` is minified by its authors and `turndown` is readable. Each folder has a `VENDOR.md` with the npm release tarball, its integrity hash and the SHA-256 of each file. To check one, download the tarball named there into a new empty folder, unpack it, and compare the file named in the table:

```bash
sha256sum package/lib/marked.umd.js   # marked 18.2.1
sha256sum package/dist/turndown.js    # turndown 7.2.5
```

## The native host

The native host is not part of this source and not part of the package. It is the DesertFox host, a separate optional download that the user installs by hand.
