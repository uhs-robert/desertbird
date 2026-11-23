import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe_short_files, describe_timeout, reported_counts, run_with_limit, short_files, static_test_count } from "../tools/check_unit_count.ts";

test("the static count takes test and it calls, with modifiers, at the start of a line", () => {
    const source = ['test("a", () => {});', '  it("b", () => {});', 'test.skip("c", () => {});', 'it.only("d", () => {});'].join("\n");
    assert.equal(static_test_count(source), 4);
});

test("a regex literal holding a quote does not hide the tests after it", () => {
    const source = ['const quote = /"/;', 'test("after the regex", () => {});', 'const text = "x";', 'test("and another", () => {});'].join("\n");
    assert.equal(static_test_count(source), 2);
});

test("the reported counts group junit testcases by file", () => {
    const xml = [
        '<testsuites>',
        '<testcase name="a &quot;q&quot;" time="0.1" classname="test" file="/r/test/a.test.ts"/>',
        '<testcase name="shows as &lt;Space>" time="0.1" classname="test" file="/r/test/a.test.ts"/>',
        '<testcase name="c" time="0.1" classname="test" file="/r/test/b.test.ts"><failure/></testcase>',
        '</testsuites>',
    ].join("\n");
    assert.deepEqual([...reported_counts(xml)], [["/r/test/a.test.ts", 2], ["/r/test/b.test.ts", 1]]);
});

test("a result set missing tests from one file names that file with both counts", () => {
    const expected = new Map([["/r/test/a.test.ts", 3], ["/r/test/b.test.ts", 2], ["/r/test/c.test.ts", 1]]);
    const reported = new Map([["/r/test/a.test.ts", 2], ["/r/test/b.test.ts", 2]]);
    const short = short_files(expected, reported);
    assert.deepEqual(short, [
        { file: "/r/test/a.test.ts", expected: 3, reported: 2 },
        { file: "/r/test/c.test.ts", expected: 1, reported: 0 },
    ]);
    const message = describe_short_files(short);
    assert.match(message, /a\.test\.ts: expected at least 3, reported 2/);
    assert.match(message, /c\.test\.ts: expected at least 1, reported 0/);
});

test("a file that reports more than its static count passes", () => {
    assert.deepEqual(short_files(new Map([["/r/test/a.test.ts", 2]]), new Map([["/r/test/a.test.ts", 9]])), []);
});

/** True while a process with this pid exists. */
function is_alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** A child script that starts a grandchild holding a timer, writes both pids, then holds a timer itself: a test file child kept alive by a leaked handle. */
function leaking_child_script(pids_path: string): string {
    return `
        const { spawn } = require("node:child_process");
        const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        require("node:fs").writeFileSync(${JSON.stringify(pids_path)}, process.pid + " " + grandchild.pid);
        setInterval(() => {}, 1000);
    `;
}

function written_pids(pids_path: string): number[] {
    return existsSync(pids_path) ? readFileSync(pids_path, "utf8").split(" ").filter(Boolean).map(Number) : [];
}

/** Kill what a failed test left behind, so a broken kill path does not leak processes past the test. */
function kill_leftovers(pids_path: string): void {
    for (const pid of written_pids(pids_path)) {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            // Killed with its group, as it should be.
        }
    }
}

test("a run that never exits is killed at its limit, with the child it started", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "unit-limit-"));
    const pids_path = join(scratch, "pids");
    try {
        const started = Date.now();
        const result = await run_with_limit(process.execPath, ["-e", leaking_child_script(pids_path)], scratch, 1500);
        assert.deepEqual(result, { status: 1, timed_out: true });
        assert.ok(Date.now() - started < 10_000);
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.deepEqual(written_pids(pids_path).filter(is_alive), []);
    } finally {
        kill_leftovers(pids_path);
        rmSync(scratch, { recursive: true, force: true });
    }
});

for (const signal of ["SIGTERM", "SIGHUP"] as const) {
    test(`a ${signal} to the script running the limit ends the run with its children`, async () => {
        const scratch = mkdtempSync(join(tmpdir(), "unit-signal-"));
        const pids_path = join(scratch, "pids");
        const tool_url = pathToFileURL(resolve(import.meta.dirname, "../tools/check_unit_count.ts")).href;
        const driver_source = `
            const { run_with_limit } = await import(${JSON.stringify(tool_url)});
            await run_with_limit(process.execPath, ["-e", ${JSON.stringify(leaking_child_script(pids_path))}], ${JSON.stringify(scratch)}, 60_000);
        `;
        const driver = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", driver_source], { stdio: "ignore" });
        const driver_exit = new Promise((done) => driver.on("exit", done));
        try {
            const deadline = Date.now() + 10_000;
            while (written_pids(pids_path).length < 2) {
                assert.ok(Date.now() < deadline, "the run never started its grandchild");
                await new Promise((done) => setTimeout(done, 20));
            }
            driver.kill(signal);
            await driver_exit;
            await new Promise((done) => setTimeout(done, 200));
            assert.deepEqual(written_pids(pids_path).filter(is_alive), []);
        } finally {
            driver.kill("SIGKILL");
            kill_leftovers(pids_path);
            rmSync(scratch, { recursive: true, force: true });
        }
    });
}

test("a run that ends inside its limit keeps its exit status", async () => {
    assert.deepEqual(await run_with_limit(process.execPath, ["-e", "process.exitCode = 3"], tmpdir(), 10_000), { status: 3, timed_out: false });
});

test("the timeout message names the limit and the likely leak", () => {
    assert.match(describe_timeout(300_000), /300 s limit.*leaked a timer or a server/);
});
