import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PARENT_MAX_BYTES = Number(/PARENT_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const HINTS_MAX_BYTES = Number(/HINTS_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const FOLDERPANE_MAX_BYTES = Number(/FOLDERPANE_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const CONTENT_MAX_BYTES = Number(/CONTENT_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const COMPOSE_MAX_BYTES = Number(/COMPOSE_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);

// The matcher side of the vendored tree and the chrome runtime. Nothing else may reach the privileged bundle.
const PARENT_ALLOWED_INPUTS = [
    /^vendor\/desertfox\/keys\/matcher\.ts$/,
    /^vendor\/desertfox\/keys\/token\.ts$/,
    /^vendor\/desertfox\/prefix_tree\.ts$/,
    /^vendor\/desertfox\/register_names\.ts$/,
    /^src\/chrome\/[a-z_]+\.ts$/,
    // The tree reader both sides share, and the handoff names. Neither reaches the registry.
    /^src\/shared\/(keymap_tree|protocol)\.ts$/,
    // The hint labels and the on-screen check, which the body script and the hints bundle share.
    /^src\/shared\/hint_(labels|view)\.ts$/,
];

// The body script bundle may take the same matcher side and the shared files, plus its own folder and the typing check of the chrome runtime. It never takes the registry or the background.
const CONTENT_ALLOWED_INPUTS = [...PARENT_ALLOWED_INPUTS, /^src\/content\/[a-z_]+\.ts$/];

const BANNED_IN_PARENT: [string, RegExp][] = [
    ["eval", /\beval\b/],
    ["new Function", /new\s+Function\b/],
    ["Function called without new", /(?<![\w.])Function\s*\(/],
    ["evalInSandbox", /evalInSandbox/],
    ["Cu.import", /\bCu\.import\(/],
    ["Components.utils", /Components\.utils/],
    ["loadSubScript", /loadSubScript/],
    ["compileScript", /compileScript/],
    ["innerHTML", /innerHTML/],
    ["ChromeUtils.import", /ChromeUtils\.import\(/],
    ["importESModule with a computed url", /importESModule\(\s*[^"'\s]/],
];

let out_dir = "";
const PARENT_NAMES = ["keys", "overlay", "hints", "folderpane"];
const sources: Record<string, string> = {};
const inputs: Record<string, string[]> = {};

before(() => {
    out_dir = mkdtempSync(join(tmpdir(), "desertbird-build-"));
    execFileSync("node", ["tools/build.mjs", "--out", out_dir], { cwd: root, stdio: "pipe" });
    for (const name of PARENT_NAMES) {
        sources[name] = readFileSync(join(out_dir, `experiment/${name}.js`), "utf8");
        inputs[name] = Object.keys((JSON.parse(readFileSync(join(out_dir, `meta/parent_${name}.json`), "utf8")) as { inputs: object }).inputs);
    }
});

after(() => rmSync(out_dir, { recursive: true, force: true }));

test("each parent bundle takes only allowlisted inputs", () => {
    for (const name of PARENT_NAMES) {
        assert.ok(inputs[name]!.length > 0);
        for (const input of inputs[name]!) assert.ok(PARENT_ALLOWED_INPUTS.some((allowed) => allowed.test(input)), `${input} is not allowed in the ${name} bundle`);
    }
});

test("no parent bundle takes the registry or the background", () => {
    for (const name of PARENT_NAMES) assert.deepEqual(inputs[name]!.filter((input) => /registry/.test(input) || input.startsWith("src/background/")), [], name);
});

test("no parent bundle uses a banned API", () => {
    for (const name of PARENT_NAMES) for (const [banned, pattern] of BANNED_IN_PARENT) assert.ok(!pattern.test(sources[name]!), `the ${name} bundle contains ${banned}`);
});

test("each parent bundle defines its API class", () => {
    for (const name of PARENT_NAMES) assert.match(sources[name]!, new RegExp(`^var ${name} = class extends ExtensionAPI`, "m"));
});

test("each parent bundle stays within the size guard", () => {
    assert.ok(PARENT_MAX_BYTES > 0);
    for (const name of PARENT_NAMES) {
        const size = readFileSync(join(out_dir, `experiment/${name}.js`)).length;
        const max_bytes = { folderpane: FOLDERPANE_MAX_BYTES, hints: HINTS_MAX_BYTES }[name] ?? PARENT_MAX_BYTES;
        assert.ok(size <= max_bytes, `${name}.js is ${size} bytes, over ${max_bytes}`);
    }
});

test("each manifest entry names its own script and schema", () => {
    const manifest = JSON.parse(readFileSync(join(out_dir, "manifest.json"), "utf8")) as { experiment_apis: Record<string, { schema: string; parent: { script: string } }> };
    for (const name of PARENT_NAMES) {
        assert.equal(manifest.experiment_apis[name]!.schema, `experiment/${name}.schema.json`);
        assert.equal(manifest.experiment_apis[name]!.parent.script, `experiment/${name}.js`);
    }
});

test("AGENTS.md records the size guards", () => {
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    assert.ok(agents.includes(`${PARENT_MAX_BYTES} bytes`));
    assert.ok(agents.includes(`${FOLDERPANE_MAX_BYTES} bytes`));
    assert.ok(agents.includes(`${HINTS_MAX_BYTES} bytes`));
    assert.ok(agents.includes(`${COMPOSE_MAX_BYTES} bytes`));
});

test("the body script bundle takes only the matcher side, the shared files and its own folder", () => {
    const bundle_inputs = Object.keys((JSON.parse(readFileSync(join(out_dir, "meta/message_display.json"), "utf8")) as { inputs: object }).inputs);
    assert.ok(bundle_inputs.length > 0);
    for (const input of bundle_inputs) assert.ok(CONTENT_ALLOWED_INPUTS.some((allowed) => allowed.test(input)), `${input} is not allowed in the body script bundle`);
    assert.deepEqual(bundle_inputs.filter((input) => /registry/.test(input) || input.startsWith("src/background/")), []);
});

test("the body script bundle stays within its size guard", () => {
    assert.ok(CONTENT_MAX_BYTES > 0 && CONTENT_MAX_BYTES < 100000);
    const size = readFileSync(join(out_dir, "content/message_display.js")).length;
    assert.ok(size <= CONTENT_MAX_BYTES, `message_display.js is ${size} bytes, over ${CONTENT_MAX_BYTES}`);
});

test("the compose script bundle takes only its own files and the shared protocol, and stays within its guard", () => {
    const bundle_inputs = Object.keys((JSON.parse(readFileSync(join(out_dir, "meta/compose_keys.json"), "utf8")) as { inputs: object }).inputs);
    assert.ok(bundle_inputs.length > 0);
    for (const input of bundle_inputs) assert.match(input, /^src\/(content\/compose_[a-z_]+|shared\/protocol)\.ts$/);
    assert.ok(COMPOSE_MAX_BYTES > 0 && COMPOSE_MAX_BYTES < 10000);
    const size = readFileSync(join(out_dir, "content/compose_keys.js")).length;
    assert.ok(size <= COMPOSE_MAX_BYTES, `compose_keys.js is ${size} bytes, over ${COMPOSE_MAX_BYTES}`);
    const listing = execFileSync("unzip", ["-Z1", join(out_dir, "desertbird.xpi")], { encoding: "utf8" }).split("\n");
    assert.ok(listing.includes("content/compose_keys.js"));
});

test("the manifest injects the body script into message documents and the xpi holds it", () => {
    const manifest = JSON.parse(readFileSync(join(out_dir, "manifest.json"), "utf8")) as { message_display_scripts: { js: string[] }[] };
    const files = manifest.message_display_scripts.flatMap((entry) => entry.js);
    assert.deepEqual(files, ["content/message_display.js"]);
    const listing = execFileSync("unzip", ["-Z1", join(out_dir, "desertbird.xpi")], { encoding: "utf8" }).split("\n");
    for (const file of files) assert.ok(listing.includes(file), file);
});

test("the xpi holds the manifest and every file it names", () => {
    const listing = execFileSync("unzip", ["-Z1", join(out_dir, "desertbird.xpi")], { encoding: "utf8" }).split("\n");
    for (const file of ["manifest.json", "background.js", "experiment/keys.schema.json", "experiment/keys.js", "experiment/overlay.schema.json", "experiment/overlay.js", "experiment/folderpane.schema.json", "experiment/folderpane.js", "experiment/hints.schema.json", "experiment/hints.js", "overlay/cmdline.html", "overlay/cmdline.js", "overlay/cmdline.css", "overlay/hud.html", "overlay/hud.js", "overlay/hud.css", "help/help.html", "help/help.js", "help/help.css"]) assert.ok(listing.includes(file), file);
    assert.ok(!listing.some((file) => file.startsWith("meta/")));
});

test("--out with no value fails and empties nothing", () => {
    // Run from a scratch directory: the bug this guards against emptied the working directory.
    const scratch = mkdtempSync(join(tmpdir(), "desertbird-out-"));
    try {
        assert.throws(() => execFileSync("node", [join(root, "tools/build.mjs"), "--out"], { cwd: scratch, stdio: "pipe" }), /--out needs a directory/);
        assert.ok(existsSync(scratch));
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});
