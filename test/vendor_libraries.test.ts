import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const root = join(import.meta.dirname, "..");
const LIBRARIES = ["marked", "turndown"];

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

function pinned_rows(library: string): { file: string; sha256: string }[] {
    const notes = readFileSync(join(root, "vendor", library, "VENDOR.md"), "utf8");
    return [...notes.matchAll(/^\| `([^`]+)` \| `[^`]+` \| `([0-9a-f]{64})` \|$/gm)].map(([, file, hash]) => ({ file: file!, sha256: hash! }));
}

test("each vendored library file is the pinned release file and VENDOR.md lists every file", () => {
    for (const library of LIBRARIES) {
        const rows = pinned_rows(library);
        assert.deepEqual(rows.map((row) => row.file).sort(), readdirSync(join(root, "vendor", library)).filter((file) => file !== "VENDOR.md").sort(), library);
        for (const row of rows) assert.equal(sha256(join(root, "vendor", library, row.file)), row.sha256, `vendor/${library}/${row.file} differs from its pin`);
    }
});

let out_dir = "";
before(() => {
    out_dir = mkdtempSync(join(tmpdir(), "desertbird-vendor-"));
    execFileSync("node", ["tools/build.mjs", "--out", out_dir], { cwd: root, stdio: "pipe" });
});
after(() => rmSync(out_dir, { recursive: true, force: true }));

test("the build ships the libraries byte for byte beside the bundle and loads them first", () => {
    const manifest = JSON.parse(readFileSync(join(out_dir, "manifest.json"), "utf8")) as { background: { scripts: string[] } };
    assert.deepEqual(manifest.background.scripts, ["vendor/turndown/turndown.js", "vendor/marked/marked.umd.js", "background.js"]);
    const listing = execFileSync("unzip", ["-Z1", join(out_dir, "desertbird.xpi")], { encoding: "utf8" }).split("\n");
    for (const library of LIBRARIES) {
        for (const row of pinned_rows(library)) {
            const path = `vendor/${library}/${row.file}`;
            assert.ok(listing.includes(path), path);
            assert.equal(sha256(join(out_dir, path)), row.sha256, path);
        }
    }
});

test("the background bundle holds no code of the libraries", () => {
    const inputs = Object.keys((JSON.parse(readFileSync(join(out_dir, "meta/background.json"), "utf8")) as { inputs: object }).inputs);
    assert.deepEqual(inputs.filter((input) => /marked|turndown|node_modules/.test(input)), []);
    const bundle = readFileSync(join(out_dir, "background.js"), "utf8");
    assert.ok(!bundle.includes("function TurndownService") && !bundle.includes("MarkedJS"));
});
