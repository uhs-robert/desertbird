// Runs the unit tests and fails when a test file reports fewer tests than it declares.
// Usage: node tools/check_unit_count.ts   (what `npm run unit` runs)
// Why: under load a file's tail results were once lost with no failure shown, so a broken test could go unseen.
// The declared count is a floor: files that build tests in loops report more, and that is fine.
// Known false failure: a line-start test( inside an if block counts but may not run. Build such tests another way.
// The node flags mirror `unit:file` in package.json. Change both together.
// No --test-force-exit: it exits a file's child while that child's last results still wait in its stdout queue, so the run loses them when the parent reads slowly.
// Without it, a test that leaks a timer or a server keeps its child alive, so the whole run has a time limit and is killed past it.
// Extra arguments go to node --test after the glob and switch the guard off, because a name filter or a file list drops tests on purpose.
// Reported counts come from the junit reporter (one testcase element per test, with its file), written to a temp file beside the spec output on stdout.

import { spawn } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TEST_GLOB = "test/**/*.test.ts";
/** A full run takes about 30 s. */
export const RUN_LIMIT_MS = 5 * 60_000;

export type ShortFile = { readonly file: string; readonly expected: number; readonly reported: number };

/** Count the `test(` and `it(` calls that start a line, including `.only`, `.skip` and `.todo` forms. Raw source: a blanker that tracks strings misreads a regex literal holding a quote and lowers the count. */
export function static_test_count(source: string): number {
    return source.match(/^[ \t]*(?:test|it)(?:\.\w+)?\(/gm)?.length ?? 0;
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

export type LimitedRun = { readonly status: number; readonly timed_out: boolean };

/** Run a command with inherited stdio and kill it with all its children when it passes `limit_ms`. The command leads its own process group so one kill reaches the test file children too. */
export function run_with_limit(command: string, args: readonly string[], cwd: string, limit_ms: number): Promise<LimitedRun> {
    const child = spawn(command, args, { cwd, stdio: "inherit", detached: true });
    const kill_group = (signal: NodeJS.Signals) => {
        try {
            process.kill(-child.pid!, signal);
        } catch {
            // The group is already gone.
        }
    };
    // A detached group misses the terminal's Ctrl+C, so pass interrupts on.
    const forward = (signal: NodeJS.Signals) => kill_group(signal);
    process.on("SIGINT", forward).on("SIGTERM", forward);
    let timed_out = false;
    const timer = setTimeout(() => {
        timed_out = true;
        kill_group("SIGKILL");
    }, limit_ms);
    return new Promise((done) => {
        child.on("close", (code) => {
            clearTimeout(timer);
            process.off("SIGINT", forward).off("SIGTERM", forward);
            done({ status: timed_out ? 1 : (code ?? 1), timed_out });
        });
    });
}

export function describe_timeout(limit_ms: number): string {
    return `Unit run passed its ${limit_ms / 1000} s limit and was killed. A test likely leaked a timer or a server that kept its file running.`;
}

async function run(extra_args: readonly string[]): Promise<number> {
    const root = resolve(import.meta.dirname, "..");
    const files = globSync(TEST_GLOB, { cwd: root }).map((file) => resolve(root, file)).sort();
    const scratch = mkdtempSync(join(tmpdir(), "unit-count-"));
    const junit_path = join(scratch, "junit.xml");
    try {
        const result = await run_with_limit(process.execPath, [
            "--test", "--test-timeout=30000", "--no-warnings",
            "--test-reporter=spec", "--test-reporter-destination=stdout",
            "--test-reporter=junit", `--test-reporter-destination=${junit_path}`,
            TEST_GLOB, ...extra_args,
        ], root, RUN_LIMIT_MS);
        if (result.timed_out) console.error(describe_timeout(RUN_LIMIT_MS));
        if (result.status !== 0) return result.status;
        if (extra_args.length > 0) return 0;
        const expected = new Map(files.map((file) => [file, static_test_count(readFileSync(file, "utf8"))]));
        const short = short_files(expected, reported_counts(readFileSync(junit_path, "utf8")));
        if (short.length === 0) return 0;
        console.error(describe_short_files(short));
        return 1;
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await run(process.argv.slice(2)));
