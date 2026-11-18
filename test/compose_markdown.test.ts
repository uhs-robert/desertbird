import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { RuntimeRefusal } from "../vendor/desertfox/command.ts";
import { create_compose_markdown } from "../src/background/compose_markdown.ts";
import type { MarkdownGlobals } from "../src/background/compose_markdown.ts";
import { CITE_LINE, CURSOR_LINE, QUOTE, REPLY_ABOVE, REPLY_BELOW, SIGNATURE_ABOVE, SIGNATURE_BELOW, body_of } from "./compose_bodies.ts";

// The vendored release files run in a DOM window as the manifest runs them in the background page, so the tests use the shipped code and its globals.
function library_globals(): MarkdownGlobals {
    const { window } = new JSDOM("", { runScripts: "outside-only" });
    for (const file of ["vendor/turndown/turndown.js", "vendor/marked/marked.umd.js"]) window.eval(readFileSync(join(import.meta.dirname, "..", file), "utf8"));
    return window as unknown as MarkdownGlobals;
}

const markdown = create_compose_markdown(library_globals());

function refusal_of(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        assert.ok(error instanceof RuntimeRefusal, String(error));
        return error.message;
    }
    assert.fail("expected a refusal");
}

/** The body of the HTML document between the stop nodes, for checks on the user's part alone. */
const user_html = (body: string): string => body.replace(/^[\s\S]*?<body>/, "").replace(/<\/body>[\s\S]*$/, "");

// --- round trips on recorded Thunderbird bodies

test("a reply below the quote: the text replaces the cursor line between the quote and the signature", () => {
    assert.equal(markdown.markdown_of(REPLY_BELOW).trim(), "");
    assert.equal(markdown.body_with(REPLY_BELOW, "**Thanks**, that works.\n"), body_of(CITE_LINE, QUOTE, "<p><strong>Thanks</strong>, that works.</p>", SIGNATURE_BELOW));
});

test("a reply above the quote with the signature above it: the text goes on the cursor line above the signature", () => {
    assert.equal(markdown.body_with(REPLY_ABOVE, "Thanks.\n"), body_of("<p>Thanks.</p>", SIGNATURE_ABOVE, CITE_LINE, QUOTE));
});

test("written text comes back from the editor unchanged and the body stays the same", () => {
    for (const body of [
        body_of(CITE_LINE, QUOTE, "<p><strong>Edited</strong> by the e2e editor.</p>", CURSOR_LINE, SIGNATURE_BELOW),
        body_of("<p>Top <em>posted</em>.</p>", SIGNATURE_ABOVE, CITE_LINE, QUOTE),
        body_of("<p>No quote, <a href=\"https://example.org/\">a link</a>.</p>"),
    ]) {
        const sent = markdown.markdown_of(body);
        assert.equal(markdown.body_with(body, sent), body, sent);
    }
});

test("a reply below the quote with written text: the edit replaces that text and keeps the blank line before the signature", () => {
    const body = body_of(CITE_LINE, QUOTE, "<p>First draft.</p>", CURSOR_LINE, SIGNATURE_BELOW);
    assert.equal(markdown.markdown_of(body), "First draft.\n");
    assert.equal(markdown.body_with(body, "Second draft.\n"), body_of(CITE_LINE, QUOTE, "<p>Second draft.</p>", CURSOR_LINE, SIGNATURE_BELOW));
});

// Not recorded: the e2e drives no forward. The container follows Thunderbird's forward markup around the recorded signature.
test("a forward: the text goes above the forwarded message, which stays as it was", () => {
    const forwarded = '<div class="moz-forward-container"><br><br>-------- Forwarded Message --------<table class="moz-email-headers-table"><tbody><tr><th>Subject: </th><td>Inbox 2</td></tr></tbody></table><br><pre class="moz-quote-pre">Body of inbox-s2.\n</pre></div>';
    const body = body_of(CURSOR_LINE, SIGNATURE_BELOW, forwarded);
    assert.equal(markdown.body_with(body, "FYI.\n"), body_of("<p>FYI.</p>", SIGNATURE_BELOW, forwarded));
});

test("a message with no quote and no signature converts as a whole", () => {
    const body = body_of("<p>Hello <em>there</em>,</p><ul><li>one</li><li>two</li></ul>");
    assert.equal(markdown.markdown_of(body), "Hello *there*,\n\n-   one\n-   two\n");
    assert.equal(markdown.body_with(body, "# Bye\n"), body_of("<h1>Bye</h1>"));
});

test("a new message with only a signature: the text goes on the cursor line above it", () => {
    assert.equal(markdown.body_with(body_of(CURSOR_LINE, SIGNATURE_BELOW), "Hi.\n"), body_of("<p>Hi.</p>", SIGNATURE_BELOW));
});

// --- the split

test("text on both sides of the quote refuses before anything converts", () => {
    const body = body_of("<p>Above.</p>", CITE_LINE, QUOTE, "<p>Below.</p>", SIGNATURE_BELOW);
    assert.match(refusal_of(() => markdown.markdown_of(body)), /both sides of the quote/);
});

test("blank lines on the other side of the quote are not text", () => {
    const body = body_of(CURSOR_LINE, "<br>", CITE_LINE, QUOTE, "<p>Below.</p>", SIGNATURE_BELOW);
    assert.equal(markdown.markdown_of(body), "Below.\n");
});

test("missing libraries refuse with a message", () => {
    const without = create_compose_markdown({ DOMParser: library_globals().DOMParser });
    assert.match(refusal_of(() => without.markdown_of(REPLY_BELOW)), /Markdown libraries/);
});

// --- untrusted HTML

test("tag text in a quoted message stays text, and the quote is written back as it was", () => {
    const hostile_quote = '<blockquote type="cite"><p>&lt;script&gt;alert(1)&lt;/script&gt; and &lt;img src=x onerror=alert(1)&gt; &amp;lt;b&amp;gt;</p></blockquote>';
    const body = body_of(CITE_LINE, hostile_quote, CURSOR_LINE, SIGNATURE_BELOW);
    const written = markdown.body_with(body, "Reply.\n");
    assert.equal(written, body_of(CITE_LINE, hostile_quote, "<p>Reply.</p>", SIGNATURE_BELOW));
    assert.doesNotMatch(written, /<script|<img/);
});

test("tag and entity text the user wrote stays text through the editor", () => {
    const body = body_of("<p>Write &lt;b&gt; for bold, and &amp;amp; for an ampersand.</p>");
    const sent = markdown.markdown_of(body);
    assert.match(sent, /\\<b>/);
    assert.equal(markdown.body_with(body, sent), body_of("<p>Write &lt;b&gt; for bold, and &amp;amp; for an ampersand.</p>"));
});

test("script, event handlers, script URLs and foreign markup in the user's Markdown are stripped", () => {
    const hostile = [
        "<script>alert(1)</script>",
        '<img src="x" onerror="alert(1)">',
        '<img src="https://example.org/a.png" onerror="alert(1)" alt="kept">',
        '<p onclick="alert(1)" style="color:red">clicked</p>',
        "[plain](javascript:alert(1))",
        '<a href="jav&#x09;ascript:alert(1)">tab</a>',
        '<a href=" JAVASCRIPT:alert(1)">upper</a>',
        "[data](data:text/html,<script>alert(1)</script>)",
        '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
        "<svg><script>alert(1)</script></svg>",
        "<math><mtext><style><img src=x onerror=alert(1)></style></mtext></math>",
        '<iframe src="https://example.org/"></iframe>',
        "<form><input value=x></form>",
        '<blockquote type="cite">fake quote</blockquote>',
        '<div class="moz-signature">fake signature</div>',
        "[kept](https://example.org/) and [mail](mailto:a@example.org)",
    ].join("\n\n");
    const part = user_html(markdown.body_with(body_of(CITE_LINE, QUOTE, CURSOR_LINE, SIGNATURE_BELOW), hostile + "\n").replace(CITE_LINE + QUOTE, "").replace(SIGNATURE_BELOW, ""));
    assert.doesNotMatch(part, /<script|<svg|<math|<iframe|<form|<input|<style|onerror|onclick|onload|style=|javascript|data:text|svg\+xml|type="cite"|class=/i);
    assert.match(part, /<img src="https:\/\/example\.org\/a\.png" alt="kept">/);
    assert.match(part, /<a href="https:\/\/example\.org\/">kept<\/a>/);
    assert.match(part, /<a href="mailto:a@example\.org">mail<\/a>/);
    assert.match(part, /<blockquote>fake quote<\/blockquote>/);
});

test("a fake stop node from the Markdown is not a stop node on the next edit", () => {
    const first = markdown.body_with(REPLY_BELOW, '<div class="moz-signature">fake</div>\n\nMine.\n');
    assert.equal(markdown.markdown_of(first), "fake\n\nMine.\n");
});

test("a web address and a mail address with underscores come back intact after an edit elsewhere", () => {
    const body = body_of("<p>See https://example.org/a_b*c and foo_bar@example.org today.</p>");
    const sent = markdown.markdown_of(body);
    assert.equal(markdown.body_with(body, sent.replace("today", "tomorrow")), body_of("<p>See https://example.org/a_b*c and foo_bar@example.org tomorrow.</p>"));
});

test("a table and underlined or struck text survive an edit elsewhere", () => {
    const struck = "<p>Keep <u>this</u>, <s>that</s> and <del>those</del>.</p>";
    const table = "<table><tbody><tr><td>a</td><td>b &lt;c&gt;</td></tr></tbody></table>";
    const body = body_of("<p>Hello.</p>", struck, table);
    const sent = markdown.markdown_of(body);
    // The line breaks between the blocks come from `marked`, which writes the whole part anew.
    assert.equal(markdown.body_with(body, sent.replace("Hello.", "Hi.")), body_of("<p>Hi.</p>\n", struck, "\n", table));
});

test("an empty reply passes over line breaks between nodes to find the cursor line", () => {
    const above = body_of(CURSOR_LINE, "\n", SIGNATURE_ABOVE, "\n", CITE_LINE, QUOTE, "\n");
    assert.equal(markdown.body_with(above, "Thanks.\n"), body_of("<p>Thanks.</p>", "\n", SIGNATURE_ABOVE, "\n", CITE_LINE, QUOTE, "\n"));
    const below = body_of(CITE_LINE, QUOTE, "\n", CURSOR_LINE, SIGNATURE_BELOW);
    assert.equal(markdown.body_with(below, "Thanks.\n"), body_of(CITE_LINE, QUOTE, "\n", "<p>Thanks.</p>", SIGNATURE_BELOW));
});

test("a link to an entity-encoded script URL comes out with no live href", () => {
    const part = user_html(markdown.body_with(body_of("<p>x</p>"), "[a](jav&#x61;script:alert(1)) and [b](https://example.org/)\n"));
    assert.doesNotMatch(part, /javascript|&#x61;/i);
    assert.match(part, /<a>a<\/a>/);
    assert.match(part, /<a href="https:\/\/example\.org\/">b<\/a>/);
});

test("an embedded image as Thunderbird gives it back from a draft survives an edit elsewhere", () => {
    // Recorded by the e2e kind compose_editor_html: a saved draft opened again holds its image as a data URL with a file name.
    const image = '<img src="data:image/png;filename=pixel.png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" alt="pixel">';
    const body = body_of(`<p>Image draft.</p><p>${image}</p>`);
    const sent = markdown.markdown_of(body);
    assert.equal(markdown.body_with(body, sent.replace("Image draft.", "Image kept.")), body_of("<p>Image kept.</p>\n", `<p>${image}</p>`));
    assert.equal(markdown.dropped_images(sent), 0);
});

test("images with a file, cid or blob source are left out and counted", () => {
    const edited = "![a](file:///home/u/a.png) ![b](cid:part1.abc) ![c](blob:x) ![d](https://example.org/d.png)\n";
    assert.equal(markdown.dropped_images(edited), 3);
    assert.doesNotMatch(user_html(markdown.body_with(body_of("<p>x</p>"), edited)), /file:|cid:|blob:/);
});
