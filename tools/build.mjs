// Builds dist/: background.js, experiment/{keys,view}.{schema.json,js}, manifest.json and an unsigned desertbird.xpi.
//   node tools/build.mjs [--out <dir>]
// The esbuild metafiles go to <out>/meta/ and stay out of the xpi. test/build.test.ts reads them.

import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out_index = process.argv.indexOf("--out");
const out_dir = resolve(out_index === -1 ? join(root, "dist") : (process.argv[out_index + 1] ?? ""));

// The chrome runtime size guard, applied to each parent bundle: the first measured size of the larger one plus 20 percent. AGENTS.md records the same number.
const PARENT_MAX_BYTES = 19100;

// Thunderbird finds an Experiment API as a top-level `var` named after its manifest key. The IIFE hides the module exports, so the footer reaches them through its global.
// Each API has its own script and schema: two entries that shared one script left `view` unloaded.
const PARENTS = [
    { name: "keys", entry: "src/chrome/parent_keys.ts" },
    { name: "view", entry: "src/chrome/parent_view.ts" },
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

copyFileSync(join(root, "src", "manifest.json"), join(out_dir, "manifest.json"));

for (const [name, bytes] of parent_sizes) {
    if (bytes > PARENT_MAX_BYTES) {
        console.error(`build: experiment/${name}.js is ${bytes} bytes, over the ${PARENT_MAX_BYTES} byte chrome runtime budget`);
        process.exit(1);
    }
}

execFileSync("zip", ["-q", "-X", "-D", "-r", "desertbird.xpi", "manifest.json", "background.js", "experiment"], { cwd: out_dir });
console.log(`build: ${out_dir} (${parent_sizes.map(([name, bytes]) => `${name}.js ${bytes} bytes`).join(", ")})`);
