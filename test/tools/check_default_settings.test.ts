import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_OVERRIDES, DESERTBIRD_ONLY, find_drift, load_pinned_defaults, pinned_sha, WEB_ONLY_REASONS } from "../../tools/check_default_settings.ts";

const web_only = Object.values(WEB_ONLY_REASONS).flat();
const pinned = { toast_ms: 3000, which_key_skip: [], statusbar_widgets: ["url"], ...Object.fromEntries(web_only.map((name) => [name, 1])) };
const matching = { toast_ms: 3000, which_key_skip: [], statusbar_widgets: DEFAULT_OVERRIDES.statusbar_widgets, [DESERTBIRD_ONLY[0]!]: 40 };

test("matching defaults, a recorded override and a DesertBird-only name pass", () => {
    assert.deepEqual(find_drift({ pinned, stub: { toast_ms: 3000 }, effective: matching }), []);
});

test("a changed effective default fails", () => {
    const problems = find_drift({ pinned, stub: {}, effective: { ...matching, toast_ms: 1 } });
    assert.deepEqual(problems, ["toast_ms is 1, DesertFox has 3000"]);
});

test("a changed stub default fails even when the effective value matches", () => {
    const problems = find_drift({ pinned, stub: { toast_ms: 2 }, effective: matching });
    assert.deepEqual(problems, ["stub toast_ms is 2, DesertFox has 3000"]);
});

test("a changed override fails", () => {
    const problems = find_drift({ pinned, stub: {}, effective: { ...matching, statusbar_widgets: ["x"] } });
    assert.equal(problems.length, 1);
});

test("a name unknown to DesertFox and to the DesertBird-only list fails", () => {
    assert.deepEqual(find_drift({ pinned, stub: {}, effective: { ...matching, made_up: true } }), ["made_up is not in the DesertFox table and not on the DesertBird-only list"]);
});

test("a DesertFox setting that is neither carried nor web-only fails, and a web-only one passes", () => {
    const problems = find_drift({ pinned: { ...pinned, brand_new: true }, stub: {}, effective: matching });
    assert.deepEqual(problems, ["DesertFox setting brand_new is neither carried nor on the web-only list"]);
});

test("the pin comes from the vendor script", () => {
    assert.equal(pinned_sha("x\nPIN_SHA=b0e41305a64ee347f7c6fb2ded5c5c3af70a12e7\n"), "b0e41305a64ee347f7c6fb2ded5c5c3af70a12e7");
    assert.throws(() => pinned_sha("nothing"));
});

test("the pinned table is read from the commit, not the working tree", async () => {
    const repo = mkdtempSync(join(tmpdir(), "defaults-fixture-"));
    try {
        const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
        mkdirSync(join(repo, "src/shared"), { recursive: true });
        git("init", "-q");
        writeFileSync(join(repo, "src/shared/settings_table.ts"), "export const SETTINGS_TABLE = { a: { kind: 'number', default: 1 }, b: { kind: 'text' } };\n");
        git("add", ".");
        git("commit", "-q", "-m", "pin");
        const pin = git("rev-parse", "HEAD").trim();
        writeFileSync(join(repo, "src/shared/settings_table.ts"), "export const SETTINGS_TABLE = { a: { kind: 'number', default: 2 } };\n");
        assert.deepEqual(await load_pinned_defaults(repo, pin), { a: 1 });
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test("without a checkout the script skips loudly and exits 0", () => {
    const script = join(import.meta.dirname, "../../tools/check_default_settings.ts");
    const env = { ...process.env };
    delete env.DESERTFOX_DIR;
    const result = execFileSync("node", ["--no-warnings", script], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(result, "");
});
