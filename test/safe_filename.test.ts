import assert from "node:assert/strict";
import { test } from "node:test";
import { safe_filename } from "../src/background/safe_filename.ts";

const safe = (raw: string) => safe_filename(raw, "fallback");

test("path separators and traversal never survive", () => {
    assert.equal(safe("../../etc/passwd"), "_.._etc_passwd");
    assert.equal(safe("..\\..\\boot.ini"), "_.._boot.ini");
    assert.equal(safe(".."), "fallback");
    assert.equal(safe("."), "fallback");
    for (const name of ["a/b", "a\\b", "C:\\x", "/abs"]) assert.doesNotMatch(safe(name), /[/\\:]/);
});

test("leading dots, trailing dots and spaces go", () => {
    assert.equal(safe(".bashrc"), "bashrc");
    assert.equal(safe("report.pdf. . "), "report.pdf");
});

test("control and direction characters are replaced", () => {
    assert.equal(safe("a\u0000b\nc\u0007d"), "a_b_c_d");
    assert.equal(safe("photo\u202Egpj.exe"), "photo_gpj.exe");
    assert.equal(safe("a\u00ADb\u2060c\u{E0041}d"), "a_b_c_d");
});

test("reserved device names get a prefix", () => {
    assert.equal(safe("CON"), "_CON");
    assert.equal(safe("nul.txt"), "_nul.txt");
    assert.equal(safe("com1"), "_com1");
    assert.equal(safe("console.txt"), "console.txt");
});

test("a long name is cut and keeps its extension", () => {
    const result = safe(`${"a".repeat(300)}.pdf`);
    assert.equal(result.length, 100);
    assert.ok(result.endsWith(".pdf"));
});

test("the cap counts UTF-8 bytes and never splits a code point", () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const subject = safe("\u9577".repeat(200));
    assert.ok(bytes(subject) <= 100 && subject === "\u9577".repeat(subject.length));
    const name = safe(`${"\u540d".repeat(200)}.pdf`);
    assert.ok(bytes(name) <= 100 && name.endsWith(".pdf"));
    const astral = safe("\u{1F600}".repeat(100));
    assert.ok(bytes(astral) <= 100 && astral === "\u{1F600}".repeat([...astral].length));
});

test("an empty or blank name takes the fallback", () => {
    assert.equal(safe(""), "fallback");
    assert.equal(safe("   "), "fallback");
    assert.equal(safe("///"), "___");
});

test("the same name twice gives the same segment, so the uniquify option decides", () => {
    assert.equal(safe("a.txt"), safe("a.txt"));
});
