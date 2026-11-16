// Builds dist/: background.js, experiment/{schema.json,parent.js}, manifest.json and an unsigned desertbird.xpi.
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

// The chrome runtime size guard: the first measured parent bundle plus 20 percent. AGENTS.md records the same number.
const PARENT_MAX_BYTES = 19100;

const PARENT_GLOBAL = "desertbird_parent";

// Thunderbird finds each Experiment API as a top-level `var` named after its manifest key. The IIFE hides the module exports, so the footer reaches them through its global.
const PARENT_FOOTER = `
var keys = class extends ExtensionAPI {
    getAPI(context) { return ${PARENT_GLOBAL}.get_keys_api(context); }
    onShutdown() { ${PARENT_GLOBAL}.shutdown(); }
};
var view = class extends ExtensionAPI {
    getAPI(context) { return ${PARENT_GLOBAL}.get_view_api(context); }
    onShutdown() { ${PARENT_GLOBAL}.shutdown(); }
};
`;

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
const parent = await build({
    ...shared_options,
    entryPoints: ["src/chrome/parent.ts"],
    outfile: join(out_dir, "experiment", "parent.js"),
    globalName: PARENT_GLOBAL,
    footer: { js: PARENT_FOOTER },
});
writeFileSync(join(out_dir, "meta", "background.json"), JSON.stringify(background.metafile));
writeFileSync(join(out_dir, "meta", "parent.json"), JSON.stringify(parent.metafile));

copyFileSync(join(root, "src", "manifest.json"), join(out_dir, "manifest.json"));
copyFileSync(join(root, "src", "experiment", "schema.json"), join(out_dir, "experiment", "schema.json"));

const parent_bytes = statSync(join(out_dir, "experiment", "parent.js")).size;
if (parent_bytes > PARENT_MAX_BYTES) {
    console.error(`build: experiment/parent.js is ${parent_bytes} bytes, over the ${PARENT_MAX_BYTES} byte chrome runtime budget`);
    process.exit(1);
}

execFileSync("zip", ["-q", "-X", "-D", "-r", "desertbird.xpi", "manifest.json", "background.js", "experiment"], { cwd: out_dir });
console.log(`build: ${out_dir} (parent.js ${parent_bytes} bytes)`);
