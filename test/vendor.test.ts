import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COMPILED_KEYMAP_VERSION } from "../vendor/desertfox/prefix_tree.ts";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { create_registry, DefineError, type CommandInput } from "../vendor/desertfox/registry/define.ts";
import { create_matcher } from "../vendor/desertfox/keys/matcher.ts";
import { compile_keymap } from "../vendor/desertfox/keys/compiler.ts";

const vendor_dir = join(import.meta.dirname, "..", "vendor", "desertfox");
const vendor_notes = readFileSync(join(vendor_dir, "VENDOR.md"), "utf8");

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

function vendored_ts_files(dir = vendor_dir): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return vendored_ts_files(path);
        return entry.name.endsWith(".ts") ? [path.slice(vendor_dir.length + 1)] : [];
    });
}

type HashRow = { file: string; role: string; pinned: string; local: string };

const hash_rows: HashRow[] = [...vendor_notes.matchAll(/^\| `([^`]+)` \| (copy|edited|stub) \| `([^`]+)` \| `([^`]+)` \|$/gm)].map(([, file, role, pinned, local]) => ({
    file: file as string,
    role: role as string,
    pinned: pinned as string,
    local: local as string,
}));

test("VENDOR.md lists every vendored file and no other", () => {
    assert.deepEqual(hash_rows.map((row) => row.file).sort(), vendored_ts_files().sort());
});

test("every vendored file hashes to the local sha256 in VENDOR.md", () => {
    for (const row of hash_rows) assert.equal(sha256(join(vendor_dir, row.file)), row.local, `${row.file} changed without a new row in VENDOR.md`);
});

test("a file that differs from the pin is a listed edit or a stand-in", () => {
    for (const row of hash_rows) {
        if (row.role === "copy") assert.equal(row.local, row.pinned, `${row.file} is marked copy but differs from the pin`);
        if (row.role === "edited") assert.ok(vendor_notes.includes(`### \`${row.file}\``), `${row.file} differs from the pin and has no entry under Local edits`);
        if (row.role === "stub") assert.match(readFileSync(join(vendor_dir, row.file), "utf8"), /^\/\/ STUB:/, `${row.file} is a stand-in without a STUB header`);
    }
});

// The imports below also put the whole vendored tree under `tsc`.
const chrome_command: CommandInput = { runs_in: "chrome", label: "Down", intent: "Move the selection down." };

test("the registry accepts the three non-background sides and rejects the old content side", () => {
    for (const runs_in of ["chrome", "message", "compose"] as const) {
        assert.equal(create_registry().define("motion.down", { ...chrome_command, runs_in }).runs_in, runs_in);
    }
    assert.throws(() => create_registry().define("motion.down", { ...chrome_command, runs_in: "content" as "chrome" }), DefineError);
    assert.throws(() => create_registry().define("motion.down", { ...chrome_command, run: () => {} } as unknown as CommandInput), DefineError);
});

test("the registry accepts the tags value list", () => {
    const command: CommandInput = { ...chrome_command, params: [{ name: "tag", type: "string", values: { from: "tags" } }] };
    assert.equal(create_registry().define("tag.apply", command).id, "tag.apply");
});

test("compiled keys walk through the matcher", () => {
    const registry = create_registry();
    registry.define("motion.down", { ...chrome_command, count: "repeat" });
    const resolve = (id: string) => {
        const command = registry.get(id);
        return command && { runs_in: command.runs_in, label: command.label, count: command.count ?? ("ignore" as const) };
    };
    const { compiled, warnings } = compile_keymap({ normal: { j: { id: "motion.down" } } }, {}, resolve);
    assert.deepEqual(warnings, []);
    assert.equal(compiled.format_version, COMPILED_KEYMAP_VERSION);
    const matcher = create_matcher(compiled);
    const result = matcher.feed("normal", "j");
    assert.equal(result.kind_, "match");
    assert.equal(matcher.feed("normal", "x").kind_, "no_match");
});

test("the setting-value rule never fires", () => {
    const command = { id: "x.y", params: [{ name: "name", type: "string" as const }, { name: "value", type: "string" as const, value_of: "name" }] };
    assert.equal(check_args(command, { name: "anything", value: "1" }).ok, true);
});
