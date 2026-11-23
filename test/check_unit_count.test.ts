import assert from "node:assert/strict";
import { test } from "node:test";
import { describe_short_files, reported_counts, short_files, static_test_count } from "../tools/check_unit_count.ts";

test("the static count takes test and it calls, with modifiers, at the start of a line", () => {
    const source = ['test("a", () => {});', '  it("b", () => {});', 'test.skip("c", () => {});', 'it.only("d", () => {});'].join("\n");
    assert.equal(static_test_count(source), 4);
});

test("the static count skips comments, strings and template text, and calls that do not start a line", () => {
    const source = [
        '// test("line comment", () => {});',
        "/*",
        'test("block comment", () => {});',
        "*/",
        "const text = `",
        'test("in a template", () => {});',
        "`;",
        'const url = "http://x"; const later = 1;',
        'run(test("nested", () => {}));',
        '  t.test("subtest", () => {});',
        'test("real", () => {});',
    ].join("\n");
    assert.equal(static_test_count(source), 1);
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
