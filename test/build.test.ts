import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PARENT_MAX_BYTES = Number(/PARENT_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);

// The matcher side of the vendored tree and the chrome runtime. Nothing else may reach the privileged bundle.
const PARENT_ALLOWED_INPUTS = [
    /^vendor\/desertfox\/keys\/matcher\.ts$/,
    /^vendor\/desertfox\/keys\/token\.ts$/,
    /^vendor\/desertfox\/prefix_tree\.ts$/,
    /^vendor\/desertfox\/register_names\.ts$/,
    /^src\/chrome\/[a-z_]+\.ts$/,
];

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
const PARENT_NAMES = ["keys"];
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

test("the parent bundle defines its API class", () => {
    assert.match(sources["keys"]!, /^var keys = class extends ExtensionAPI/m);
});

test("each parent bundle stays within the size guard", () => {
    assert.ok(PARENT_MAX_BYTES > 0);
    for (const name of PARENT_NAMES) {
        const size = readFileSync(join(out_dir, `experiment/${name}.js`)).length;
        assert.ok(size <= PARENT_MAX_BYTES, `${name}.js is ${size} bytes, over ${PARENT_MAX_BYTES}`);
    }
});

test("each manifest entry names its own script and schema", () => {
    const manifest = JSON.parse(readFileSync(join(out_dir, "manifest.json"), "utf8")) as { experiment_apis: Record<string, { schema: string; parent: { script: string } }> };
    for (const name of PARENT_NAMES) {
        assert.equal(manifest.experiment_apis[name]!.schema, `experiment/${name}.schema.json`);
        assert.equal(manifest.experiment_apis[name]!.parent.script, `experiment/${name}.js`);
    }
});

test("AGENTS.md records the size guard", () => {
    assert.ok(readFileSync(join(root, "AGENTS.md"), "utf8").includes(`${PARENT_MAX_BYTES} bytes`));
});

test("the xpi holds the manifest and every file it names", () => {
    const listing = execFileSync("unzip", ["-Z1", join(out_dir, "desertbird.xpi")], { encoding: "utf8" }).split("\n");
    for (const file of ["manifest.json", "background.js", "experiment/keys.schema.json", "experiment/keys.js"]) assert.ok(listing.includes(file), file);
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
