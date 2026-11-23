import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PARENT_MAX_BYTES = Number(/PARENT_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const KEYS_MAX_BYTES = Number(/KEYS_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const APP_MAX_BYTES = Number(/APP_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const HINTS_MAX_BYTES = Number(/HINTS_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const FOLDERPANE_MAX_BYTES = Number(/FOLDERPANE_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const CONTENT_MAX_BYTES = Number(/CONTENT_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const PAGES_MAX_BYTES = Number(/PAGES_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const PAGE_KEYS_MAX_BYTES = Number(/PAGE_KEYS_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const ZOOM_MAX_BYTES = Number(/ZOOM_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
const COMPOSEWIN_MAX_BYTES = Number(/COMPOSEWIN_MAX_BYTES = (\d+);/.exec(readFileSync(join(root, "tools/build.mjs"), "utf8"))?.[1]);
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
// `swallow.ts` is the one helper the body script takes from the dropped-error lint rule.
const CONTENT_ALLOWED_INPUTS = [...PARENT_ALLOWED_INPUTS, /^src\/content\/[a-z_]+\.ts$/, /^src\/shared\/swallow\.ts$/];

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
    // Two computed urls are allowed: the page actor's parent under the `resource://` root that `parent_pages.ts` names from a fixed prefix and the load time, and the hint module beside the actor's child.
    ["importESModule with a computed url", /importESModule\(\s*(?!`resource:\/\/\$\{root\}\/experiment\/page_actor_parent\.sys\.mjs`|new URL\("page_hints_child\.sys\.mjs", import\.meta\.url\)\.href\))[^"'\s]/],
];

let out_dir = "";
const PARENT_NAMES = ["keys", "overlay", "hints", "pages", "folderpane", "app", "zoom", "composewin"];
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

const build_source = () => readFileSync(join(root, "tools/build.mjs"), "utf8");
const guard_prefixes = () => [...build_source().matchAll(/^const (\w+)_MAX_BYTES = \d+;/gm)].map((match) => match[1]!);
const number_of = (name: string) => Number(new RegExp(`^const ${name} = (\\d+);`, "m").exec(build_source())?.[1]);

test("each size guard has a ceiling and is within it", () => {
    assert.ok(guard_prefixes().length >= 7);
    for (const prefix of guard_prefixes()) {
        const guard = number_of(`${prefix}_MAX_BYTES`);
        const ceiling = number_of(`${prefix}_CEILING_BYTES`);
        assert.ok(ceiling > 0, `${prefix}_MAX_BYTES has no ${prefix}_CEILING_BYTES`);
        assert.ok(guard <= ceiling, `${prefix} guard ${guard} is over its ceiling ${ceiling}`);
    }
});

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
        const max_bytes = { app: APP_MAX_BYTES, keys: KEYS_MAX_BYTES, folderpane: FOLDERPANE_MAX_BYTES, hints: HINTS_MAX_BYTES, pages: PAGES_MAX_BYTES, zoom: ZOOM_MAX_BYTES, composewin: COMPOSEWIN_MAX_BYTES }[name] ?? PARENT_MAX_BYTES;
        assert.ok(size <= max_bytes, `${name}.js is ${size} bytes, over ${max_bytes}`);
    }
});

// The verb modules load on the first `app` call. In the key script they would load at startup again, which is the growth this test stops.
test("the key script takes no verb module", () => {
    assert.deepEqual(inputs["keys"]!.filter((input) => /^src\/chrome\/(app_verbs|view_verbs|parent_app)\.ts$/.test(input)), []);
    assert.ok(inputs["app"]!.some((input) => input === "src/chrome/app_verbs.ts") && inputs["app"]!.some((input) => input === "src/chrome/view_verbs.ts"));
});

test("each manifest entry names its own script and schema", () => {
    const manifest = JSON.parse(readFileSync(join(out_dir, "manifest.json"), "utf8")) as { experiment_apis: Record<string, { schema: string; parent: { script: string } }> };
    for (const name of PARENT_NAMES) {
        assert.equal(manifest.experiment_apis[name]!.schema, `experiment/${name}.schema.json`);
        assert.equal(manifest.experiment_apis[name]!.parent.script, `experiment/${name}.js`);
    }
});

test("AGENTS.md records each size guard with its ceiling", () => {
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    for (const prefix of guard_prefixes()) {
        const line = `guard ${number_of(`${prefix}_MAX_BYTES`)}, ceiling ${number_of(`${prefix}_CEILING_BYTES`)} (\`${prefix}_MAX_BYTES\`)`;
        assert.ok(agents.includes(line), `AGENTS.md lacks ${prefix}: ${line}`);
    }
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

test("the pages bundle holds no code of the mail tab's key runtime, the hints or the folder pane", () => {
    assert.deepEqual(inputs["pages"]!.filter((input) => /^src\/chrome\/(runtime|motions|hint_[a-z]+|app_verbs|view_verbs|parent_(keys|hints|folderpane|app|overlay))\.ts$/.test(input)), []);
});

test("the own page script stays within its size guard", () => {
    assert.ok(PAGE_KEYS_MAX_BYTES > 0 && PAGE_KEYS_MAX_BYTES < 100000);
    const size = readFileSync(join(out_dir, "content/page_keys.js")).length;
    assert.ok(size <= PAGE_KEYS_MAX_BYTES, `page_keys.js is ${size} bytes, over ${PAGE_KEYS_MAX_BYTES}`);
});

test("the compose script bundle takes only its own files, the shared protocol and the swallow helpers (which names the matcher file for a type, shaken out of the bundle), and stays within its guard", () => {
    const bundle_inputs = Object.keys((JSON.parse(readFileSync(join(out_dir, "meta/compose_keys.json"), "utf8")) as { inputs: object }).inputs);
    assert.ok(bundle_inputs.length > 0);
    for (const input of bundle_inputs) assert.match(input, /^(src\/(content\/compose_[a-z_]+|shared\/(protocol|swallow))|vendor\/desertfox\/prefix_tree)\.ts$/);
    // The shared protocol names the matcher file for a type. A later value import of it would add bytes here.
    const outputs = (JSON.parse(readFileSync(join(out_dir, "meta/compose_keys.json"), "utf8")) as { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> }).outputs;
    const matcher_bytes = Object.values(outputs).flatMap((output) => Object.entries(output.inputs)).filter(([input]) => input === "vendor/desertfox/prefix_tree.ts").map(([, entry]) => entry.bytesInOutput);
    assert.deepEqual(matcher_bytes.filter((bytes) => bytes !== 0), []);
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
    for (const file of ["manifest.json", "background.js", "experiment/keys.schema.json", "experiment/keys.js", "experiment/overlay.schema.json", "experiment/overlay.js", "experiment/folderpane.schema.json", "experiment/folderpane.js", "experiment/app.schema.json", "experiment/app.js", "experiment/hints.schema.json", "experiment/hints.js", "experiment/pages.schema.json", "experiment/pages.js", "experiment/zoom.schema.json", "experiment/zoom.js", "experiment/composewin.schema.json", "experiment/composewin.js", "overlay/cmdline.html", "overlay/cmdline.js", "overlay/cmdline.css", "overlay/hud.html", "overlay/hud.js", "overlay/hud.css", "help/help.html", "help/help.js", "help/help.css", "popup/popup.html", "popup/popup.js", "popup/popup.css", "icons/desertbird.svg"]) assert.ok(listing.includes(file), file);
    assert.ok(!listing.some((file) => file.startsWith("meta/")));
});

// The child runs in every web page's process. It may hold the token reader and the scroll table and nothing else: no matcher, no focus reader of the chrome, no platform globals.
const ACTOR_ALLOWED_INPUTS: Record<string, RegExp[]> = {
    page_actor_child: [/^src\/chrome\/page_actor_child\.ts$/, /^src\/chrome\/page_actions\.ts$/, /^vendor\/desertfox\/keys\/token\.ts$/],
    page_actor_parent: [/^src\/chrome\/page_actor_parent\.ts$/],
    // The hint module a child loads on the first pick: the pick, the page controls and the shared labels and on-screen check.
    page_hints_child: [/^src\/chrome\/(page_hints_child|hint_pick|hint_targets)\.ts$/, /^src\/shared\/hint_(labels|view)\.ts$/],
};

const bytes_by_input = (name: string) => {
    const outputs = (JSON.parse(readFileSync(join(out_dir, `meta/${name}.json`), "utf8")) as { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> }).outputs;
    return Object.values(outputs).flatMap((output) => Object.entries(output.inputs)).filter(([, entry]) => entry.bytesInOutput > 0).map(([input]) => input);
};

test("the page actor halves are ES modules that export their class, hold only allowlisted code, use no banned API and stay within their guards", () => {
    const listing = execFileSync("unzip", ["-Z1", join(out_dir, "desertbird.xpi")], { encoding: "utf8" }).split("\n");
    for (const [name, class_name, guard] of [["page_actor_child", "DesertBirdPageChild", "ACTOR_CHILD_MAX_BYTES"], ["page_actor_parent", "DesertBirdPageParent", "ACTOR_PARENT_MAX_BYTES"]] as const) {
        const file = `experiment/${name}.sys.mjs`;
        const source = readFileSync(join(out_dir, file), "utf8");
        assert.match(source, new RegExp(`^export \\{[^}]*\\b${class_name}\\b`, "m"), `${file} exports ${class_name}`);
        assert.doesNotMatch(source, /^\(\(\) => \{/m, `${file} is no IIFE`);
        for (const input of bytes_by_input(name)) assert.ok(ACTOR_ALLOWED_INPUTS[name]!.some((allowed) => allowed.test(input)), `${input} is not allowed in ${file}`);
        for (const [banned, pattern] of BANNED_IN_PARENT) assert.ok(!pattern.test(source), `${file} contains ${banned}`);
        assert.ok(source.length <= number_of(guard), `${file} is ${source.length} bytes, over ${number_of(guard)}`);
        assert.ok(listing.includes(file), `the xpi holds ${file}`);
    }
});

test("the hint module of the actor's child is an ES module that exports start, holds only allowlisted code, uses no banned API and stays within its guard", () => {
    const file = "experiment/page_hints_child.sys.mjs";
    const source = readFileSync(join(out_dir, file), "utf8");
    assert.match(source, /^export \{[^}]*\bstart\b/m);
    for (const input of bytes_by_input("page_hints_child")) assert.ok(ACTOR_ALLOWED_INPUTS["page_hints_child"]!.some((allowed) => allowed.test(input)), `${input} is not allowed in ${file}`);
    for (const [banned, pattern] of BANNED_IN_PARENT) assert.ok(!pattern.test(source), `${file} contains ${banned}`);
    assert.ok(source.length <= number_of("ACTOR_HINTS_MAX_BYTES"), `${file} is ${source.length} bytes, over ${number_of("ACTOR_HINTS_MAX_BYTES")}`);
    assert.ok(execFileSync("unzip", ["-Z1", join(out_dir, "desertbird.xpi")], { encoding: "utf8" }).split("\n").includes(file));
});

// The key child runs in every web page's process. The hint code loads only on a pick, so a page that never sees one never pays for it.
test("the actor's key child never bundles the hint pick, the labels or the targets", () => {
    assert.deepEqual(bytes_by_input("page_actor_child").filter((input) => /hint_/.test(input)), []);
    assert.match(readFileSync(join(out_dir, "experiment/page_actor_child.sys.mjs"), "utf8"), /importESModule\(new URL\("page_hints_child\.sys\.mjs", import\.meta\.url\)\.href\)/);
});

test("the pages bundle loads the actor parent by URL and never bundles either half", () => {
    assert.doesNotMatch(sources["pages"]!, /DesertBirdPage(Child|Parent)/);
    assert.deepEqual(inputs["pages"]!.filter((input) => /page_actor_/.test(input)), []);
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
