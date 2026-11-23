import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("a run that never exits is killed at its limit, with the child it started", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "unit-limit-"));
    const grandchild_pid_path = join(scratch, "grandchild.pid");
    // The child starts a grandchild that holds a timer, writes its pid, then holds a timer itself: a test file child kept alive by a leaked handle.
    const script = `
        const { spawn } = require("node:child_process");
        const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        require("node:fs").writeFileSync(${JSON.stringify(grandchild_pid_path)}, String(grandchild.pid));
        setInterval(() => {}, 1000);
    `;
    try {
        const started = Date.now();
        const result = await run_with_limit(process.execPath, ["-e", script], scratch, 1500);
        assert.deepEqual(result, { status: 1, timed_out: true });
        assert.ok(Date.now() - started < 10_000);
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(is_alive(Number(readFileSync(grandchild_pid_path, "utf8"))), false);
    } finally {
        try {
            process.kill(Number(readFileSync(grandchild_pid_path, "utf8")), "SIGKILL");
        } catch {
            // Killed with its group, as it should be.
        }
        rmSync(scratch, { recursive: true, force: true });
    }
});

test("a run that ends inside its limit keeps its exit status", async () => {
    assert.deepEqual(await run_with_limit(process.execPath, ["-e", "process.exitCode = 3"], tmpdir(), 10_000), { status: 3, timed_out: false });
});

test("the timeout message names the limit and the likely leak", () => {
    assert.match(describe_timeout(300_000), /300 s limit.*leaked a timer or a server/);
});
