// Builds dist/: background.js, experiment/{keys,overlay}.{schema.json,js}, overlay/ (the command line page), manifest.json and an unsigned desertbird.xpi.
//   node tools/build.mjs [--out <dir>]
// The esbuild metafiles go to <out>/meta/ and stay out of the xpi. test/build.test.ts reads them.

import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out_index = process.argv.indexOf("--out");
const out_value = out_index === -1 ? join(root, "dist") : process.argv[out_index + 1];
if (!out_value) {
    console.error("build: --out needs a directory");
    process.exit(1);
}
const out_dir = resolve(out_value);
// The build empties the output directory first, so it must never be the checkout or a folder that holds it.
if (relative(out_dir, root).split(sep)[0] !== "..") {
    console.error(`build: refusing to empty ${out_dir}, which holds the checkout`);
    process.exit(1);
}

// The chrome runtime size guard, applied to each parent bundle: the first measured size of `keys.js` as its own bundle (15003 bytes) plus 20 percent. The reading-pane handoff added 372 bytes, so the guard was 18004 plus 372 rounded up to 18400. The thread verbs of the view API took it from 18358 on main to 20501 bytes, so it was 18400 plus 2143 rounded up to 20600. Visual mode and the row flags took the build from 20501 on main to 21451 (950 bytes). The guard for a stale range (the end row and view the mode last set, and the collapse after a command) made it 21785. The message keys at both ends of the range made it 21996 (1495 bytes over main), so it is 20600 plus 1495 rounded up to the next 100. AGENTS.md records the same number.
const PARENT_MAX_BYTES = 22100;

// The size guard of the body script bundle, which runs in every message document: its first measured size (8861 bytes) plus 20 percent made 10633. Find in the message and hint labels added 5574 bytes (8984 to 14558), so the guard was 14558 rounded up to 14600. The hint fixes (a visibility check, a shadow root for the labels, ending the labels on scroll and blur, and a focus pick with Enter left to Thunderbird) added 1321 more (15879), and the guard is 15879 rounded up to 15900. AGENTS.md records the same number.
const CONTENT_MAX_BYTES = 15900;

// Thunderbird finds an Experiment API as a top-level `var` named after its manifest key. The IIFE hides the module exports, so the footer reaches them through its global.
// Each API needs its own script and schema: two entries that shared one script left the second API unloaded.
const PARENTS = [
    { name: "keys", entry: "src/chrome/parent_keys.ts" },
    { name: "overlay", entry: "src/chrome/parent_overlay.ts" },
].map((parent) => ({
    ...parent,
    global_name: `desertbird_${parent.name}`,
    footer: `
var ${parent.name} = class extends ExtensionAPI {
    getAPI(context) { return desertbird_${parent.name}.get_${parent.name}_api(context); }
    onShutdown() { desertbird_${parent.name}.shutdown(); }
};
`,
}));

const shared_options = {
    bundle: true,
    format: "iife",
    target: "firefox128",
    metafile: true,
    logLevel: "warning",
    absWorkingDir: root,
};

rmSync(out_dir, { recursive: true, force: true });
mkdirSync(join(out_dir, "experiment"), { recursive: true });
mkdirSync(join(out_dir, "overlay"), { recursive: true });
mkdirSync(join(out_dir, "content"), { recursive: true });
mkdirSync(join(out_dir, "meta"), { recursive: true });

const background = await build({ ...shared_options, entryPoints: ["src/background/main.ts"], outfile: join(out_dir, "background.js") });
const parent_sizes = [];
for (const parent of PARENTS) {
    const outfile = join(out_dir, "experiment", `${parent.name}.js`);
    const result = await build({ ...shared_options, entryPoints: [parent.entry], outfile, globalName: parent.global_name, footer: { js: parent.footer } });
    writeFileSync(join(out_dir, "meta", `parent_${parent.name}.json`), JSON.stringify(result.metafile));
    copyFileSync(join(root, "src", "experiment", `${parent.name}.schema.json`), join(out_dir, "experiment", `${parent.name}.schema.json`));
    parent_sizes.push([parent.name, statSync(outfile).size]);
}
writeFileSync(join(out_dir, "meta", "background.json"), JSON.stringify(background.metafile));
const message_display_file = join(out_dir, "content", "message_display.js");
const message_display = await build({ ...shared_options, entryPoints: ["src/content/message_display.ts"], outfile: message_display_file });
writeFileSync(join(out_dir, "meta", "message_display.json"), JSON.stringify(message_display.metafile));
const message_display_bytes = statSync(message_display_file).size;

// The options page is an extension page: it bundles the settings code and the command table, and stays out of the parent bundle.
mkdirSync(join(out_dir, "options"), { recursive: true });
await build({ ...shared_options, entryPoints: ["src/options/options.ts"], outfile: join(out_dir, "options", "options.js") });
for (const name of ["options.html", "options.css"]) copyFileSync(join(root, "src", "options", name), join(out_dir, "options", name));

// The command line page is an ordinary extension page. The overlay parent loads it into the window.
await build({ ...shared_options, entryPoints: ["src/overlay/cmdline.ts"], outfile: join(out_dir, "overlay", "cmdline.js") });
for (const file of ["cmdline.html", "cmdline.css"]) copyFileSync(join(root, "src", "overlay", file), join(out_dir, "overlay", file));

copyFileSync(join(root, "src", "manifest.json"), join(out_dir, "manifest.json"));

for (const [name, bytes] of parent_sizes) {
    if (bytes > PARENT_MAX_BYTES) {
        console.error(`build: experiment/${name}.js is ${bytes} bytes, over the ${PARENT_MAX_BYTES} byte chrome runtime budget`);
        process.exit(1);
    }
}

if (message_display_bytes > CONTENT_MAX_BYTES) {
    console.error(`build: content/message_display.js is ${message_display_bytes} bytes, over the ${CONTENT_MAX_BYTES} byte message script budget`);
    process.exit(1);
}

execFileSync("zip", ["-q", "-X", "-D", "-r", "desertbird.xpi", "manifest.json", "background.js", "experiment", "content", "options", "overlay"], { cwd: out_dir });
console.log(`build: ${out_dir} (${[...parent_sizes.map(([name, bytes]) => `${name}.js ${bytes} bytes`), `message_display.js ${message_display_bytes} bytes`].join(", ")})`);
