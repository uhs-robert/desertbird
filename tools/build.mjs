// Builds dist/: background.js, the vendored library files, experiment/{keys,overlay,app}.{schema.json,js}, overlay/ (the command line and hud pages), help/, manifest.json and an unsigned desertbird.xpi.
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

// Size guards, in bytes of the bundle as written (the build does not minify). The build fails above a guard. A guard never rises past its ceiling, and every guard needs a ceiling. The raise history and the rules are in docs/design.md, "Bundle size guards", and AGENTS.md. test/build.test.ts reads each `NAME_MAX_BYTES = number;` line.
// `experiment/overlay.js`, the parent bundle that has no guard of its own.
const PARENT_MAX_BYTES = 27212;
const PARENT_CEILING_BYTES = 40960;

// `experiment/keys.js`, the key runtime that loads at startup. A verb module may not enter it (test/build.test.ts), so it stays near its measured size.
const KEYS_MAX_BYTES = 23356;
const KEYS_CEILING_BYTES = 40960;

// `experiment/app.js`, loaded on the first thread list, pane focus or app call.
const APP_MAX_BYTES = 10597;
const APP_CEILING_BYTES = 12800;

// `experiment/folderpane.js`, loaded on the first folder pane call.
const FOLDERPANE_MAX_BYTES = 5900;
const FOLDERPANE_CEILING_BYTES = 10240;

// `experiment/zoom.js`, loaded on the first zoom call.
const ZOOM_MAX_BYTES = 3544;
const ZOOM_CEILING_BYTES = 6144;

// `content/message_display.js`, the body script that runs in every message document.
const CONTENT_MAX_BYTES = 18162;
const CONTENT_CEILING_BYTES = 24576;

// `experiment/hints.js`, its own bundle and not chrome runtime code.
const HINTS_MAX_BYTES = 15098;
const HINTS_CEILING_BYTES = 20480;

// `content/compose_keys.js`, registered into every compose body.
const COMPOSE_MAX_BYTES = 3500;
const COMPOSE_CEILING_BYTES = 8192;

// `experiment/pages.js`, the key runtime of the tabs that are not the mail tab.
const PAGES_MAX_BYTES = 26896;
const PAGES_CEILING_BYTES = 34816;

// `content/page_keys.js`, the message key script that runs on the own pages (options, help).
const PAGE_KEYS_MAX_BYTES = 21400;
const PAGE_KEYS_CEILING_BYTES = 32768;

// `experiment/page_actor_child.sys.mjs`, the page actor's child, which runs in the process of every web page and other add-on's page a tab shows.
const ACTOR_CHILD_MAX_BYTES = 8704;
const ACTOR_CHILD_CEILING_BYTES = 11264;

// `experiment/page_actor_parent.sys.mjs`, the page actor's parent, loaded with the pages bundle.
const ACTOR_PARENT_MAX_BYTES = 5632;
const ACTOR_PARENT_CEILING_BYTES = 9216;

// `experiment/page_hints_child.sys.mjs`, the page actor's hint labels, which a child loads on the first hint pick in its process.
const ACTOR_HINTS_MAX_BYTES = 7680;
const ACTOR_HINTS_CEILING_BYTES = 10240;

// Reads this file for every `*_MAX_BYTES` const, so a new guard without a `*_CEILING_BYTES` fails the build.
const own_source = readFileSync(fileURLToPath(import.meta.url), "utf8");
for (const [, prefix, guard] of own_source.matchAll(/^const (\w+)_MAX_BYTES = (\d+);/gm)) {
    const ceiling = own_source.match(new RegExp(`^const ${prefix}_CEILING_BYTES = (\\d+);`, "m"))?.[1];
    if (!ceiling) {
        console.error(`build: ${prefix}_MAX_BYTES has no ${prefix}_CEILING_BYTES`);
        process.exit(1);
    }
    if (Number(guard) > Number(ceiling)) {
        console.error(`build: ${prefix}_MAX_BYTES of ${guard} bytes is over its ${ceiling} byte ceiling`);
        process.exit(1);
    }
}

// The release files of `turndown` and `marked` and their licenses. Each folder's VENDOR.md holds the pin.
const VENDORED_LIBRARY_FILES = ["vendor/turndown/turndown.js", "vendor/turndown/LICENSE", "vendor/marked/marked.umd.js", "vendor/marked/LICENSE"];

// Thunderbird finds an Experiment API as a top-level `var` named after its manifest key. The IIFE hides the module exports, so the footer reaches them through its global.
// Each API needs its own script and schema: two entries that shared one script left the second API unloaded.
const PARENTS = [
    { name: "keys", entry: "src/chrome/parent_keys.ts", max_bytes: KEYS_MAX_BYTES },
    { name: "overlay", entry: "src/chrome/parent_overlay.ts" },
    { name: "hints", entry: "src/chrome/parent_hints.ts", max_bytes: HINTS_MAX_BYTES },
    { name: "pages", entry: "src/chrome/parent_pages.ts", max_bytes: PAGES_MAX_BYTES },
    { name: "app", entry: "src/chrome/parent_app.ts", max_bytes: APP_MAX_BYTES },
    { name: "folderpane", entry: "src/chrome/parent_folderpane.ts", max_bytes: FOLDERPANE_MAX_BYTES },
    { name: "zoom", entry: "src/chrome/parent_zoom.ts", max_bytes: ZOOM_MAX_BYTES },
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

// The page actor's two halves. The actor system loads each by URL as an ES module and finds its class by name, so they build as ES modules with no IIFE and no footer.
const ACTORS = [
    { name: "page_actor_child", entry: "src/chrome/page_actor_child.ts", max_bytes: ACTOR_CHILD_MAX_BYTES },
    { name: "page_actor_parent", entry: "src/chrome/page_actor_parent.ts", max_bytes: ACTOR_PARENT_MAX_BYTES },
    { name: "page_hints_child", entry: "src/chrome/page_hints_child.ts", max_bytes: ACTOR_HINTS_MAX_BYTES },
];

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
const actor_sizes = [];
for (const actor of ACTORS) {
    const outfile = join(out_dir, "experiment", `${actor.name}.sys.mjs`);
    const result = await build({ ...shared_options, format: "esm", entryPoints: [actor.entry], outfile });
    writeFileSync(join(out_dir, "meta", `${actor.name}.json`), JSON.stringify(result.metafile));
    actor_sizes.push([actor, statSync(outfile).size]);
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

for (const [actor, bytes] of actor_sizes) {
    if (bytes > actor.max_bytes) {
        console.error(`build: experiment/${actor.name}.sys.mjs is ${bytes} bytes, over the ${actor.max_bytes} byte budget`);
        process.exit(1);
    }
}

if (message_display_bytes > CONTENT_MAX_BYTES) {
    console.error(`build: content/message_display.js is ${message_display_bytes} bytes, over the ${CONTENT_MAX_BYTES} byte message script budget`);
    process.exit(1);
}

if (page_keys_bytes > PAGE_KEYS_MAX_BYTES) {
    console.error(`build: content/page_keys.js is ${page_keys_bytes} bytes, over the ${PAGE_KEYS_MAX_BYTES} byte own page script budget`);
    process.exit(1);
}

if (compose_keys_bytes > COMPOSE_MAX_BYTES) {
    console.error(`build: content/compose_keys.js is ${compose_keys_bytes} bytes, over the ${COMPOSE_MAX_BYTES} byte compose script budget`);
    process.exit(1);
}

execFileSync("zip", ["-q", "-X", "-D", "-r", "desertbird.xpi", "manifest.json", "background.js", "experiment", "content", "options", "overlay", "help", "vendor"], { cwd: out_dir });
console.log(`build: ${out_dir} (${[...parent_sizes.map(([name, bytes]) => `${name}.js ${bytes} bytes`), ...actor_sizes.map(([actor, bytes]) => `${actor.name}.sys.mjs ${bytes} bytes`), `message_display.js ${message_display_bytes} bytes`, `page_keys.js ${page_keys_bytes} bytes`, `compose_keys.js ${compose_keys_bytes} bytes`].join(", ")})`);
