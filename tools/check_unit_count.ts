// Runs the unit tests and fails when a test file reports fewer tests than it declares.
// Usage: node tools/check_unit_count.ts   (what `npm run unit` runs)
// Why: under load a file's tail results were once lost with no failure shown, so a broken test could go unseen.
// The declared count is a floor: files that build tests in loops report more, and that is fine.
// Reported counts come from the junit reporter (one testcase element per test, with its file), written to a temp file beside the spec output on stdout.

import { spawnSync } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TEST_GLOB = "test/**/*.test.ts";

export type ShortFile = { readonly file: string; readonly expected: number; readonly reported: number };

/** Blank out comments and string contents, keeping newlines, so a `test(` inside either never counts. */
export function blank_comments_and_strings(source: string): string {
    let out = "";
    let i = 0;
    while (i < source.length) {
        const ch = source[i]!;
        const next = source[i + 1];
        if (ch === "/" && next === "/") {
            while (i < source.length && source[i] !== "\n") i++;
        } else if (ch === "/" && next === "*") {
            const end = source.indexOf("*/", i + 2);
            const stop = end === -1 ? source.length : end + 2;
            out += source.slice(i, stop).replace(/[^\n]/g, " ");
            i = stop;
        } else if (ch === '"' || ch === "'" || ch === "`") {
            out += ch;
            i++;
            while (i < source.length && source[i] !== ch) {
                if (source[i] === "\\") { out += " "; i++; }
                if (i < source.length) out += source[i] === "\n" ? "\n" : " ";
                i++;
            }
            out += ch;
            i++;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/** Count the `test(` and `it(` calls that start a line, including `.only`, `.skip` and `.todo` forms. */
export function static_test_count(source: string): number {
    return blank_comments_and_strings(source).match(/^[ \t]*(?:test|it)(?:\.\w+)?\(/gm)?.length ?? 0;
}

/** Count junit testcase elements per file path. A name attribute can hold a bare `>`, so quoted values are skipped whole. */
export function reported_counts(junit_xml: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [, attributes] of junit_xml.matchAll(/<testcase\b((?:[^>"]|"[^"]*")*)>/g)) {
        const file = /\bfile="([^"]*)"/.exec(attributes!)?.[1];
        if (file !== undefined) counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    return counts;
}

/** The files whose reported count is below the declared one, in file order. A file absent from the report counts as zero. */
export function short_files(expected: ReadonlyMap<string, number>, reported: ReadonlyMap<string, number>): ShortFile[] {
    return [...expected]
        .map(([file, count]) => ({ file, expected: count, reported: reported.get(file) ?? 0 }))
        .filter((entry) => entry.reported < entry.expected)
        .sort((a, b) => a.file.localeCompare(b.file));
}

export function describe_short_files(short: readonly ShortFile[]): string {
    const lines = short.map((entry) => `  ${entry.file}: expected at least ${entry.expected}, reported ${entry.reported}`);
    return `Unit run lost test results in ${short.length} file(s):\n${lines.join("\n")}`;
}

function run(): number {
    const root = resolve(import.meta.dirname, "..");
    const files = globSync(TEST_GLOB, { cwd: root }).map((file) => resolve(root, file)).sort();
    const scratch = mkdtempSync(join(tmpdir(), "unit-count-"));
    const junit_path = join(scratch, "junit.xml");
    try {
        const result = spawnSync(process.execPath, [
            "--test", "--test-timeout=30000", "--test-force-exit", "--no-warnings",
            "--test-reporter=spec", "--test-reporter-destination=stdout",
            "--test-reporter=junit", `--test-reporter-destination=${junit_path}`,
            TEST_GLOB,
        ], { cwd: root, stdio: "inherit" });
        if (result.status !== 0) return result.status ?? 1;
        const expected = new Map(files.map((file) => [file, static_test_count(readFileSync(file, "utf8"))]));
        const short = short_files(expected, reported_counts(readFileSync(junit_path, "utf8")));
        if (short.length === 0) return 0;
        console.error(describe_short_files(short));
        return 1;
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(run());
