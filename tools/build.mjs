// Builds dist/: background.js, the vendored library files, experiment/{keys,overlay}.{schema.json,js}, overlay/ (the command line and hud pages), help/, manifest.json and an unsigned desertbird.xpi.
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

// The chrome runtime size guard, applied to each parent bundle: the first measured size of `keys.js` as its own bundle (15003 bytes) plus 20 percent. The reading-pane handoff added 372 bytes, so the guard was 18004 plus 372 rounded up to 18400. The thread verbs of the view API took it from 18358 on main to 20501 bytes, so it was 18400 plus 2143 rounded up to 20600. Visual mode and the row flags took the build from 20501 on main to 21451 (950 bytes). The guard for a stale range (the end row and view the mode last set, and the collapse after a command) made it 21785. The message keys at both ends of the range made it 21996 (1495 bytes over main), so it was 20600 plus 1495 rounded up to 22100. The which-key report of the typed prefix added 305 bytes, so it was 22100 plus 305 rounded up to 22500. The folder row, pane focus, command and page verbs made it 24085 (1784 bytes over main's 22301), so it was 22500 plus 1784 rounded up to 24300. The report of visual mode to the mode label made it 24374 (289 bytes over main), so it was 24300 plus 289 rounded up to 24600. Pane focus by chord and left or right, and the motions in the folder pane, made it 25492 (1118 bytes over main's 24374), so it was 24600 plus 1118 rounded up to 25800. Keys for the calendar, address book and settings tabs and a close chord on web page tabs made it 25936 (921 bytes over main's 25015), so it was that measured size rounded up to 26000. Skipping a leaf with args and holding plain keys after the command line opens made it 26040 (1025 bytes over main), so it was that measured size rounded up to 26100. The key list command (`help.whichkey`, with the report that ends its panel on the next key) made it 26238 (198 bytes over main), so it is that measured size rounded up to 26300. AGENTS.md records the same number.
const PARENT_MAX_BYTES = 26300;

// The size guard of the folder pane bundle (`experiment/folderpane.js`), which Thunderbird loads on the first folder pane call and not at startup: its first measured size (4891 bytes) plus 20 percent made 5869, rounded up to 5900. AGENTS.md records the same number.
const FOLDERPANE_MAX_BYTES = 5900;

// The size guard of the body script bundle, which runs in every message document: its first measured size (8861 bytes) plus 20 percent made 10633. Find in the message and hint labels added 5574 bytes (8984 to 14558), so the guard was 14558 rounded up to 14600. The hint fixes (a visibility check, a shadow root for the labels, ending the labels on scroll and blur, and a focus pick with Enter left to Thunderbird) added 1321 more (15879), and the guard rose to 15900. The injectable pick action for the own pages made it 15927, and the guard was 15927 rounded up to 15950. Drawing the labels in the theme made it 16028. Reading the published label colors as literal declarations, so a mail cannot recolor them, made it 16177, and the guard was 16177 rounded up to 16200. Reporting the typed prefix to the background for which-key in a message made it 16562, which is 385 over main's 16177, and the guard was 16562 rounded up to 16600. The `;` action step (a phase before the labels, the focus, activate and yank actions and the yank message to the background) made it 17601 (1039 bytes over main), so the guard is that measured size rounded up to 17650. AGENTS.md records the same number.
const CONTENT_MAX_BYTES = 17650;

// The `hints` API has a guard of its own, since it is a separate bundle and not chrome runtime code. Its first measured size was 3091 bytes, and the guard is that plus 20 percent (3709) rounded up to 3800. The check that the focus still sits on the picked link made it 3863, so the guard was 3800 plus 63 rounded up to 3900. The `pick` verb for the mail window (targets, labels per chrome document, typed label, act) made it 11670, so the guard was 11670 rounded up to 11700. The `;` action step (the action phase, a focus and a text per target, and the clipboard write in the parent) made it 12994 (1324 bytes over main), so the guard was that measured size rounded up to 13000. The card view subject lookup made it 13004 (4 bytes over that), so the guard is 13004 rounded up to 13050.
const HINTS_MAX_BYTES = 13050;

// The size guard of the compose script bundle (`content/compose_keys.js`), which runs in every compose body: its first measured size (717 bytes) plus 20 percent made 861, rounded up to 900. AGENTS.md records the same number.
const COMPOSE_MAX_BYTES = 900;

// The release files of `turndown` and `marked` and their licenses. Each folder's VENDOR.md holds the pin.
const VENDORED_LIBRARY_FILES = ["vendor/turndown/turndown.js", "vendor/turndown/LICENSE", "vendor/marked/marked.umd.js", "vendor/marked/LICENSE"];

// Thunderbird finds an Experiment API as a top-level `var` named after its manifest key. The IIFE hides the module exports, so the footer reaches them through its global.
// Each API needs its own script and schema: two entries that shared one script left the second API unloaded.
const PARENTS = [
    { name: "keys", entry: "src/chrome/parent_keys.ts" },
    { name: "overlay", entry: "src/chrome/parent_overlay.ts" },
    { name: "hints", entry: "src/chrome/parent_hints.ts", max_bytes: HINTS_MAX_BYTES },
    { name: "folderpane", entry: "src/chrome/parent_folderpane.ts", max_bytes: FOLDERPANE_MAX_BYTES },
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

// The own pages (options, help) run the message key script from one shared bundle, since a content tab gets no script from the manifest.
const page_keys_file = join(out_dir, "content", "page_keys.js");
await build({ ...shared_options, entryPoints: ["src/content/page_keys.ts"], outfile: page_keys_file });
const page_keys_bytes = statSync(page_keys_file).size;

// The compose script is registered by the background with `composeScripts.register`, so the manifest does not name it.
const compose_keys_file = join(out_dir, "content", "compose_keys.js");
const compose_keys = await build({ ...shared_options, entryPoints: ["src/content/compose_keys.ts"], outfile: compose_keys_file });
writeFileSync(join(out_dir, "meta", "compose_keys.json"), JSON.stringify(compose_keys.metafile));
const compose_keys_bytes = statSync(compose_keys_file).size;

// The options page is an extension page: it bundles the settings code and the command table, and stays out of the parent bundle.
mkdirSync(join(out_dir, "options"), { recursive: true });
await build({ ...shared_options, entryPoints: ["src/options/options.ts"], outfile: join(out_dir, "options", "options.js") });
for (const name of ["options.html", "options.css"]) copyFileSync(join(root, "src", "options", name), join(out_dir, "options", name));

// The command line page is an ordinary extension page. The overlay parent loads it into the window.
await build({ ...shared_options, entryPoints: ["src/overlay/cmdline.ts"], outfile: join(out_dir, "overlay", "cmdline.js") });
for (const file of ["cmdline.html", "cmdline.css"]) copyFileSync(join(root, "src", "overlay", file), join(out_dir, "overlay", file));

// The hud page draws the which-key panel, the toasts and the mode badge. The overlay parent loads it into the window.
await build({ ...shared_options, entryPoints: ["src/overlay/hud.ts"], outfile: join(out_dir, "overlay", "hud.js") });
for (const file of ["hud.html", "hud.css"]) copyFileSync(join(root, "src", "overlay", file), join(out_dir, "overlay", file));

// The help page is generated at run time from the command registry, so it bundles the registry as the options page does.
mkdirSync(join(out_dir, "help"), { recursive: true });
await build({ ...shared_options, entryPoints: ["src/help/help.ts"], outfile: join(out_dir, "help", "help.js") });
for (const file of ["help.html", "help.css"]) copyFileSync(join(root, "src", "help", file), join(out_dir, "help", file));

// The vendored libraries ship as their exact release files, beside the bundle and never in it, so the store can match them against the release. The manifest loads them before `background.js`.
for (const file of VENDORED_LIBRARY_FILES) {
    mkdirSync(dirname(join(out_dir, file)), { recursive: true });
    copyFileSync(join(root, file), join(out_dir, file));
}

copyFileSync(join(root, "src", "manifest.json"), join(out_dir, "manifest.json"));

for (const [name, bytes] of parent_sizes) {
    const max_bytes = PARENTS.find((parent) => parent.name === name)?.max_bytes ?? PARENT_MAX_BYTES;
    if (bytes > max_bytes) {
        console.error(`build: experiment/${name}.js is ${bytes} bytes, over the ${max_bytes} byte budget`);
        process.exit(1);
    }
}

if (message_display_bytes > CONTENT_MAX_BYTES) {
    console.error(`build: content/message_display.js is ${message_display_bytes} bytes, over the ${CONTENT_MAX_BYTES} byte message script budget`);
    process.exit(1);
}

if (compose_keys_bytes > COMPOSE_MAX_BYTES) {
    console.error(`build: content/compose_keys.js is ${compose_keys_bytes} bytes, over the ${COMPOSE_MAX_BYTES} byte compose script budget`);
    process.exit(1);
}

execFileSync("zip", ["-q", "-X", "-D", "-r", "desertbird.xpi", "manifest.json", "background.js", "experiment", "content", "options", "overlay", "help", "vendor"], { cwd: out_dir });
console.log(`build: ${out_dir} (${[...parent_sizes.map(([name, bytes]) => `${name}.js ${bytes} bytes`), `message_display.js ${message_display_bytes} bytes`, `page_keys.js ${page_keys_bytes} bytes`, `compose_keys.js ${compose_keys_bytes} bytes`].join(", ")})`);
