import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
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
    ["loadSubScript", /loadSubScript/],
    ["compileScript", /compileScript/],
    ["innerHTML", /innerHTML/],
    ["ChromeUtils.import", /ChromeUtils\.import\(/],
    ["importESModule with a computed url", /importESModule\(\s*[^"'\s]/],
];

let out_dir = "";
let parent_source = "";
let parent_inputs: string[] = [];

before(() => {
    out_dir = mkdtempSync(join(tmpdir(), "desertbird-build-"));
    execFileSync("node", ["tools/build.mjs", "--out", out_dir], { cwd: root, stdio: "pipe" });
    parent_source = readFileSync(join(out_dir, "experiment/parent.js"), "utf8");
    parent_inputs = Object.keys((JSON.parse(readFileSync(join(out_dir, "meta/parent.json"), "utf8")) as { inputs: object }).inputs);
});

after(() => rmSync(out_dir, { recursive: true, force: true }));

test("the parent bundle takes only allowlisted inputs", () => {
    assert.ok(parent_inputs.length > 0);
    for (const input of parent_inputs) assert.ok(PARENT_ALLOWED_INPUTS.some((allowed) => allowed.test(input)), `${input} is not allowed in the parent bundle`);
});

test("the parent bundle excludes the registry", () => {
    assert.deepEqual(parent_inputs.filter((input) => /registry/.test(input) || input.startsWith("src/background/")), []);
});

test("the parent bundle uses no banned API", () => {
    for (const [name, pattern] of BANNED_IN_PARENT) assert.ok(!pattern.test(parent_source), `the parent bundle contains ${name}`);
});

test("the parent bundle defines both API classes", () => {
    assert.match(parent_source, /^var keys = class extends ExtensionAPI/m);
    assert.match(parent_source, /^var view = class extends ExtensionAPI/m);
});

test("the parent bundle stays within the size guard", () => {
    const size = readFileSync(join(out_dir, "experiment/parent.js")).length;
    assert.ok(PARENT_MAX_BYTES > 0);
    assert.ok(size <= PARENT_MAX_BYTES, `parent.js is ${size} bytes, over ${PARENT_MAX_BYTES}`);
});

test("AGENTS.md records the size guard", () => {
    assert.ok(readFileSync(join(root, "AGENTS.md"), "utf8").includes(`${PARENT_MAX_BYTES} bytes`));
});

test("the xpi holds the manifest and every file it names", () => {
    const listing = execFileSync("unzip", ["-Z1", join(out_dir, "desertbird.xpi")], { encoding: "utf8" }).split("\n");
    for (const file of ["manifest.json", "background.js", "experiment/schema.json", "experiment/parent.js"]) assert.ok(listing.includes(file), file);
    assert.ok(!listing.some((file) => file.startsWith("meta/")));
});
